# Deploying Postal

Backend on an AWS EC2 instance, frontend on Vercel, MongoDB on Atlas's free tier.

**Why this shape.** Postal is not a stateless API — it runs an SMTP listener, a
delivery worker and a retry sweeper, all of which must stay alive. That rules out
serverless and any host that sleeps an idle service. It needs a real VM. The
databases are pushed to managed tiers because a 1 GB box cannot comfortably run
MongoDB, Redis, Node and a mail sink at once, and because those free tiers are
permanent while EC2 credits are not.

Budget about 45 minutes.

---

## Before you start

You need:

- A **domain** with editable DNS. Caddy provisions TLS certificates
  automatically, but Let's Encrypt will not issue one for a bare IP address. A
  subdomain of a domain you already own is fine.
- An **AWS account**. Accounts created after 15 July 2025 get $200 in credits
  over 6 months rather than the old 12-month free tier — see
  [Cost and teardown](#7-cost-and-teardown).
- A **GitHub account** with this repository pushed to it.

---

## 1. Push to GitHub

From the project root:

```bash
git remote add origin https://github.com/<you>/postal.git
git branch -M main
git push -u origin main
```

Confirm `.env`, `.env.production` and `node_modules/` are **not** in the push —
they are gitignored, but check before the repo is public:

```bash
git ls-files | grep -E '^\.env|node_modules' || echo "clean"
```

---

## 2. Create the managed data stores

**MongoDB Atlas** — free M0 tier, permanent.

1. Create a cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas) and
   pick the free **M0** shared tier.
2. Database Access → add a user, and note the password.
3. Network Access → add your EC2 instance's public IP once you have it. Use
   `0.0.0.0/0` only if you must; it means any host with the password can connect.
4. Copy the connection string. It looks like
   `mongodb+srv://user:pass@cluster.xxxxx.mongodb.net/postal`.

**Redis** — nothing to set up. It runs as a container in the production stack.

A hosted Redis free tier does not fit this workload: a BullMQ worker issues
roughly 130 commands a minute while completely idle, which is about 5.7 million
a month against a typical 500,000 allowance. Redis itself needs about 9 MB
resident, so running it next to the app is both free and faster than crossing
the network for every queue operation.

---

## 3. Launch the EC2 instance

1. EC2 → Launch instance.
2. **AMI:** Ubuntu Server 24.04 LTS. **Type:** `t3.micro`.
3. **Key pair:** create one and download the `.pem`.
4. **Security group** — inbound rules:

   | Port | Source | Why |
   | --- | --- | --- |
   | 22 | Your IP only | SSH. Never `0.0.0.0/0` |
   | 80 | `0.0.0.0/0` | Let's Encrypt HTTP challenge |
   | 443 | `0.0.0.0/0` | The API over HTTPS |
   | 2525 | `0.0.0.0/0` | Inbound SMTP. Omit if you set `SMTP_INGRESS_ENABLED=false` |

5. Launch, then **allocate an Elastic IP and associate it** — without one the
   public IP changes on every stop/start and your DNS breaks.

> **Outbound port 25 is blocked on EC2 by default.** This does not affect you:
> Postal relays through Mailpit (or a provider on 587), never port 25 directly.

---

## 4. Point DNS at the instance

At your DNS provider, create **A records** pointing at the Elastic IP:

```
postal-api    A    <elastic-ip>
postal-mail   A    <elastic-ip>      # optional, for the Mailpit UI
```

Wait for propagation before step 6 — Caddy's certificate request fails if the
record does not yet resolve. Check with `dig +short postal-api.yourdomain.com`.

---

## 5. Prepare the server

```bash
chmod 400 ~/Downloads/your-key.pem
ssh -i ~/Downloads/your-key.pem ubuntu@<elastic-ip>
```

Install Docker:

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu
```

**Add swap.** A `t3.micro` has 1 GB of RAM, and the TypeScript build will run out
without it:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Log out and back in so the `docker` group applies.

---

## 6. Deploy

```bash
git clone https://github.com/<you>/postal.git
cd postal
cp .env.production.example .env.production
```

Generate the two secrets:

```bash
openssl rand -base64 48      # JWT_SECRET — copy the whole line
```

`MAILPIT_UI_AUTH` is just `user:password` — pick any password. It guards the demo
mail sink, not anything sensitive.

Edit `.env.production` (`nano .env.production`) and set:

| Variable | Value |
| --- | --- |
| `API_DOMAIN` | `postal-api.yourdomain.com` |
| `MAIL_UI_DOMAIN` | `postal-mail.yourdomain.com`, or blank |
| `MAILPIT_UI_AUTH` | `demo:<any password you choose>` |
| `JWT_SECRET` | The random string from above |
| `MONGODB_URI` | Your Atlas connection string |
| `REDIS_URL` | Leave as `redis://redis:6379` |
| `CORS_ORIGINS` | `https://your-app.vercel.app` |

Bring it up:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

**Apply the database indexes.** This is a required release step — in production
`autoIndex` is off, and the unique indexes on `email`, `mailbox` and `messageId`
are what enforce those constraints:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec server node apps/server/dist/db/migrate-indexes.js
```

Optionally seed demo data:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec server node apps/server/dist/db/seed.js
```

Verify:

```bash
curl https://postal-api.yourdomain.com/healthz
curl https://postal-api.yourdomain.com/readyz
```

`readyz` should report `mongo: up` and `queue: up`. The API docs are at
`https://postal-api.yourdomain.com/docs`.

---

## 7. Deploy the frontend to Vercel

1. Import the repository at [vercel.com/new](https://vercel.com/new).
2. Set **Root Directory** to `apps/web`.
3. Add an environment variable:

   ```
   API_PROXY_TARGET = https://postal-api.yourdomain.com
   ```

4. Deploy, then go back and set `CORS_ORIGINS` on the server to the Vercel URL
   and restart: `docker compose --env-file .env.production -f docker-compose.prod.yml up -d`.

> **Do not point the browser directly at the API.** `next.config.mjs` proxies
> `/api/*` through the Vercel origin on purpose. The refresh cookie is
> `sameSite=lax`, which browsers will not send on a cross-site request — bypass
> the proxy and login appears to work while session refresh silently fails.

---

## 8. Cost and teardown

Set a **billing alarm before you do anything else**: AWS Billing → Budgets →
create a zero-spend budget. An orphaned Elastic IP or EBS volume bills quietly.

Running costs once credits are exhausted, roughly:

| Item | Approximate |
| --- | --- |
| `t3.micro` | ~$7.50/mo |
| Public IPv4 | ~$3.60/mo |
| Atlas M0, Vercel | $0 |

To tear down: terminate the instance, **release the Elastic IP** (an unassociated
one still bills), and delete the EBS volume.

---

## Updating a deployment

```bash
cd postal && git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec server node apps/server/dist/db/migrate-indexes.js
```

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Caddy cannot get a certificate | DNS not propagated, or port 80 closed in the security group |
| `readyz` reports `mongo: down` | The instance IP is not allow-listed in Atlas Network Access |
| Login works, then 401s a few minutes later | The frontend is bypassing the Vercel proxy — see step 7 |
| Build killed during `docker compose build` | Swap was not added in step 5 |
| Messages stay `queued` | `REDIS_URL` is set but unreachable; check `docker compose logs server` |
