import { z } from 'zod';

/**
 * Every configuration value the process reads is declared here and validated
 * once at boot. Nothing else in the codebase touches `process.env` — a missing
 * or malformed variable fails fast with a readable report instead of surfacing
 * as `undefined` deep inside a request handler.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  /* --- HTTP --------------------------------------------------------- */
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Comma-separated origins allowed to send credentialed cross-site requests. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  /* --- Persistence -------------------------------------------------- */
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  /** Optional. When unset the delivery queue falls back to an in-process driver. */
  REDIS_URL: z.string().optional(),

  /* --- Auth --------------------------------------------------------- */
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters of high-entropy secret'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),
  COOKIE_DOMAIN: z.string().optional(),
  /** Send the refresh cookie with `Secure`. Must be true behind HTTPS. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /* --- Mail --------------------------------------------------------- */
  /** Domain this MTA is authoritative for; local delivery targets it. */
  MAIL_DOMAIN: z.string().default('postal.local'),
  /** Hostname announced in the SMTP banner and EHLO. */
  SMTP_HOSTNAME: z.string().default('mx.postal.local'),
  /** Port for the inbound SMTP daemon (submission). */
  SMTP_INGRESS_PORT: z.coerce.number().int().min(1).max(65535).default(2525),
  SMTP_INGRESS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Reject inbound messages larger than this (bytes). */
  SMTP_MAX_MESSAGE_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),

  /**
   * Smart host. When set, every outbound message is relayed here instead of
   * being delivered directly to the recipient's MX. This is what makes the
   * project runnable offline: point it at Mailpit and real SMTP transactions
   * happen end to end without touching the public internet.
   */
  SMTP_RELAY_HOST: z.string().optional(),
  SMTP_RELAY_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_RELAY_USER: z.string().optional(),
  SMTP_RELAY_PASS: z.string().optional(),
  /** `require` fails when the peer offers no STARTTLS; `opportunistic` upgrades if offered. */
  SMTP_TLS_POLICY: z.enum(['disabled', 'opportunistic', 'require']).default('opportunistic'),
  /** Set false only for local relays with self-signed certificates. */
  SMTP_TLS_REJECT_UNAUTHORIZED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /* --- Delivery queue ----------------------------------------------- */
  DELIVERY_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  /** First retry delay; each subsequent retry doubles it (capped at 1 hour). */
  DELIVERY_BACKOFF_MS: z.coerce.number().int().positive().default(15_000),
  SMTP_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  SMTP_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  /* --- Limits ------------------------------------------------------- */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  /** Tighter bucket for auth endpoints, which are the credential-stuffing target. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const report = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // Thrown before the logger exists, so this writes straight to stderr.
    throw new Error(`Invalid environment configuration:\n${report}\n`);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
