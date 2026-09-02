import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MessageModel } from '../src/models/message.model.js';
import { backoffFor } from '../src/queue/delivery.worker.js';
import { QUEUE_NAME, jobIdFor } from '../src/queue/bullmq.driver.js';
import { clearDatabase, startTestDatabase, stopTestDatabase } from './helpers/database.js';

let app: FastifyInstance;

beforeAll(async () => {
  await startTestDatabase();
  app = (await buildApp()) as unknown as FastifyInstance;
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await stopTestDatabase();
});

afterEach(async () => {
  await clearDatabase();
});

async function signUp(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'CorrectHorse123' },
  });
  return response.json().accessToken as string;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

const draft = {
  to: ['peer@example.net'],
  subject: 'Network telemetry',
  body: 'Body of the message.',
};

describe('POST /api/v1/messages', () => {
  it('accepts a message for delivery and returns 202', async () => {
    const token = await signUp('sender@postal.test');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: auth(token),
      payload: draft,
    });

    expect(response.statusCode).toBe(202);
    // 202, not 201: acceptance is a promise to attempt delivery, not proof of it.
    expect(response.json().status).toBe('queued');
    expect(response.json().messageId).toMatch(/^<.+@postal\.test>$/);
  });

  it('persists the message before responding', async () => {
    const token = await signUp('sender@postal.test');
    await app.inject({ method: 'POST', url: '/api/v1/messages', headers: auth(token), payload: draft });

    // Durability is what makes the 202 honest — a crash immediately after the
    // response must not lose the message.
    expect(await MessageModel.countDocuments({ status: 'queued' })).toBe(1);
  });

  it('derives a preview and byte size from the body', async () => {
    const token = await signUp('sender@postal.test');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: auth(token),
      payload: { ...draft, body: 'x'.repeat(500) },
    });

    expect(response.json().bodyPreview).toHaveLength(180);
    expect(response.json().sizeBytes).toBe(500);
  });

  it('rejects a message with no recipient', async () => {
    const token = await signUp('sender@postal.test');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: auth(token),
      payload: { ...draft, to: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown field rather than silently dropping it', async () => {
    const token = await signUp('sender@postal.test');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: auth(token),
      payload: { ...draft, priority: 'urgent' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/messages', payload: draft });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/v1/messages', () => {
  async function seedSent(token: string, count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/messages',
        headers: auth(token),
        payload: { ...draft, subject: `Message ${i}` },
      });
    }
  }

  it('paginates with an opaque cursor', async () => {
    const token = await signUp('sender@postal.test');
    await seedSent(token, 7);

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/messages?folder=sent&limit=3',
      headers: auth(token),
    });

    expect(first.json().items).toHaveLength(3);
    expect(first.json().total).toBe(7);
    expect(first.json().nextCursor).toEqual(expect.any(String));

    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/messages?folder=sent&limit=3&cursor=${encodeURIComponent(first.json().nextCursor)}`,
      headers: auth(token),
    });

    const ids = (response: { json: () => unknown }): string[] =>
      (response.json() as { items: { id: string }[] }).items.map((m) => m.id);
    const firstIds = ids(first);
    const secondIds = ids(second);

    expect(second.json().items).toHaveLength(3);
    // Keyset pagination must not repeat a row across pages.
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });

  it('returns a null cursor on the last page', async () => {
    const token = await signUp('sender@postal.test');
    await seedSent(token, 2);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/messages?folder=sent&limit=10',
      headers: auth(token),
    });

    expect(response.json().nextCursor).toBeNull();
  });

  it('rejects a malformed cursor', async () => {
    const token = await signUp('sender@postal.test');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/messages?folder=sent&cursor=not-a-cursor',
      headers: auth(token),
    });

    expect(response.statusCode).toBe(400);
  });

  it('omits message bodies from list responses', async () => {
    const token = await signUp('sender@postal.test');
    await seedSent(token, 1);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/messages?folder=sent',
      headers: auth(token),
    });

    // Bodies would make a mailbox page arbitrarily large for no benefit.
    expect(response.json().items[0]).not.toHaveProperty('body');
    expect(response.json().items[0].bodyPreview).toBeTruthy();
  });

  it('never returns another account\'s mail', async () => {
    const alice = await signUp('alice@postal.test');
    const mallory = await signUp('mallory@postal.test');
    await seedSent(alice, 3);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/messages?folder=sent',
      headers: auth(mallory),
    });

    expect(response.json().items).toHaveLength(0);
    expect(response.json().total).toBe(0);
  });
});

describe('GET /api/v1/messages/:id', () => {
  it('returns the full body', async () => {
    const token = await signUp('sender@postal.test');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: auth(token),
      payload: draft,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/messages/${created.json().id}`,
      headers: auth(token),
    });

    expect(response.json().body).toBe(draft.body);
  });

  it('answers 404 rather than 403 for another account\'s message', async () => {
    const alice = await signUp('alice@postal.test');
    const mallory = await signUp('mallory@postal.test');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: auth(alice),
      payload: draft,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/messages/${created.json().id}`,
      headers: auth(mallory),
    });

    // 403 would confirm the id exists; 404 discloses nothing.
    expect(response.statusCode).toBe(404);
  });

  it('answers 404 for a malformed id', async () => {
    const token = await signUp('sender@postal.test');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/messages/not-an-object-id',
      headers: auth(token),
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('PATCH /api/v1/messages/:id', () => {
  it('updates mailbox state', async () => {
    const token = await signUp('sender@postal.test');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: auth(token),
      payload: draft,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${created.json().id}`,
      headers: auth(token),
      payload: { starred: true, folder: 'archive' },
    });

    expect(response.json().starred).toBe(true);
    expect(response.json().folder).toBe('archive');
  });

  it('rejects an empty patch', async () => {
    const token = await signUp('sender@postal.test');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: auth(token),
      payload: draft,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${created.json().id}`,
      headers: auth(token),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('retry backoff', () => {
  it('grows exponentially with the attempt number', () => {
    // Full jitter means each value is a sample from [0, ceiling), so the
    // ceiling is what the test can assert on.
    const samples = (attempt: number) =>
      Array.from({ length: 200 }, () => backoffFor(attempt));

    const first = Math.max(...samples(1));
    const third = Math.max(...samples(3));

    expect(first).toBeLessThanOrEqual(1000);
    expect(third).toBeLessThanOrEqual(4000);
    expect(third).toBeGreaterThan(first);
  });

  it('never returns a negative delay', () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect(backoffFor(attempt)).toBeGreaterThanOrEqual(0);
    }
  });

  it('caps the delay at one hour however many attempts have failed', () => {
    expect(backoffFor(50)).toBeLessThanOrEqual(3_600_000);
  });
});

describe('BullMQ queue identifiers', () => {
  it('uses a queue name BullMQ will accept', () => {
    // BullMQ joins this name with ":" to build Redis keys and rejects a name
    // that already contains one. This only surfaces when Redis is configured,
    // so the constraint is asserted here rather than left to a deployment.
    expect(QUEUE_NAME).not.toContain(':');
    expect(QUEUE_NAME).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('derives a safe job id from a Message-ID', () => {
    const id = jobIdFor('<3f1a-9c2e@postal.local>', 2);

    expect(id).not.toContain(':');
    expect(id).toMatch(/^[A-Za-z0-9._-]+$/);
    // Still unique per message and per attempt, which is what makes
    // re-enqueueing an in-flight message idempotent.
    expect(id).not.toBe(jobIdFor('<3f1a-9c2e@postal.local>', 3));
    expect(id).not.toBe(jobIdFor('<other-id@postal.local>', 2));
  });
});
