import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import type { SMTPServer } from 'smtp-server';
import { buildApp } from '../src/app.js';
import { MessageModel } from '../src/models/message.model.js';
import { getDeliveryQueue, closeDeliveryQueue } from '../src/queue/index.js';
import { processDeliveryJob } from '../src/queue/delivery.worker.js';
import { createIngressServer } from '../src/smtp/ingress.js';
import { SmtpClient } from '../src/smtp/client.js';
import { SmtpTranscript } from '../src/smtp/transcript.js';
import { composeMime } from '../src/smtp/delivery.js';
import { clearDatabase, startTestDatabase, stopTestDatabase } from './helpers/database.js';
import { startSmtpSink, type SmtpSink } from './helpers/smtp-sink.js';

/**
 * End-to-end coverage of the whole system with nothing stubbed: the HTTP API,
 * the delivery queue and worker, our own SMTP client, and the inbound SMTP
 * daemon, all running against a real MongoDB and a real SMTP peer.
 *
 * The unit tests prove each piece behaves; this proves they are wired together —
 * which is where the interesting bugs actually live.
 */

let app: FastifyInstance;
let sink: SmtpSink;
let ingress: SMTPServer;
let ingressPort: number;

const RELAY_PORT = 31025; // Matches SMTP_RELAY_PORT in vitest.config.ts.

beforeAll(async () => {
  await startTestDatabase();

  sink = await startSmtpSink(RELAY_PORT);
  app = (await buildApp()) as unknown as FastifyInstance;
  await app.ready();

  // The worker is started by hand so tests can drive delivery deterministically
  // rather than racing a background poller.
  await getDeliveryQueue().consume(processDeliveryJob, 2);

  // Port 0 lets the OS pick a free port, so the suite cannot collide with
  // anything already listening on the developer's machine.
  ingress = createIngressServer();
  await new Promise<void>((resolve, reject) => {
    ingress.once('error', reject);
    ingress.listen(0, '127.0.0.1', () => {
      ingress.off('error', reject);
      ingressPort = (ingress.server.address() as AddressInfo).port;
      resolve();
    });
  });
  ingress.on('error', () => {});
});

afterAll(async () => {
  await new Promise<void>((resolve) => ingress.close(() => resolve()));
  await closeDeliveryQueue();
  await app.close();
  await sink.close();
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

/**
 * Wait for a message to reach a terminal state. Delivery is asynchronous by
 * design, so a test that asserts immediately after submitting would be asserting
 * on the queued state, not on the outcome.
 */
async function waitForStatus(
  messageId: string,
  statuses: string[],
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const message = await MessageModel.findById(messageId).lean();
    if (message && statuses.includes(message.status)) return message;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const last = await MessageModel.findById(messageId).lean();
  throw new Error(`Timed out waiting for ${statuses.join('/')}; status was "${last?.status}"`);
}

describe('submit → queue → deliver', () => {
  it('carries a message from the API to a real SMTP peer', async () => {
    const token = await signUp('sender@postal.test');

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        to: ['peer@example.net'],
        subject: 'End-to-end delivery',
        body: 'This travelled over a real SMTP connection.',
      },
    });

    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().status).toBe('queued');

    const delivered = await waitForStatus(accepted.json().id, ['sent']);

    // The message reached the peer...
    const received = sink.received.at(-1);
    expect(received?.to).toEqual(['peer@example.net']);
    expect(received?.raw).toContain('Subject: End-to-end delivery');
    expect(received?.raw).toContain('This travelled over a real SMTP connection.');

    // ...and the attempt was recorded with a usable trace.
    const attempts = delivered.attempts as { status: string; responseCode: number; trace: { totalMs: number; phases: unknown[] } }[];
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.responseCode).toBe(250);
    expect(attempts[0]!.trace.totalMs).toBeGreaterThan(0);
    expect(attempts[0]!.trace.phases.length).toBeGreaterThanOrEqual(6);
  });

  it('defers and schedules a retry when the peer returns 4xx', async () => {
    const token = await signUp('sender@postal.test');
    sink.failNextWith(451, 'Greylisted, try again later');

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { to: ['peer@example.net'], subject: 'Greylist test', body: 'Retry me.' },
    });

    const deferred = await waitForStatus(accepted.json().id, ['deferred', 'sent']);

    // The retry may already have succeeded by the time we look — the sink only
    // fails once — so either outcome is valid. What must hold is that the 451
    // was recorded as a deferral rather than a bounce.
    const attempts = deferred.attempts as { status: string; responseCode: number | null }[];
    expect(attempts[0]!.status).toBe('deferred');
    expect(attempts[0]!.responseCode).toBe(451);
    expect(deferred.status).not.toBe('failed');
  });

  it('fails without retrying when the peer returns 5xx', async () => {
    const token = await signUp('sender@postal.test');
    sink.failNextWith(550, 'Recipient address rejected');

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { to: ['peer@example.net'], subject: 'Bounce test', body: 'Reject me.' },
    });

    const failed = await waitForStatus(accepted.json().id, ['failed']);

    expect(failed.attemptCount).toBe(1);
    expect(failed.nextRetryAt).toBeNull();
    expect(String(failed.lastError)).toContain('550');
  });

  it('surfaces the delivery trace through the API', async () => {
    const token = await signUp('sender@postal.test');

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        to: ['peer@example.net'],
        subject: 'Trace exposure',
        body: 'x'.repeat(2048),
        clientTrace: { dnsMs: 4.2, tcpMs: 11.7, connectionType: '4g' },
      },
    });

    await waitForStatus(accepted.json().id, ['sent']);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/messages/${accepted.json().id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const trace = detail.json().attempts.at(-1).trace;
    expect(trace.remoteHost).toBe('127.0.0.1');
    expect(trace.messageBytes).toBeGreaterThan(2048);
    expect(trace.phases.map((p: { phase: string }) => p.phase)).toContain('data');
    // The browser's measurements are carried through alongside the server's.
    expect(trace.client.dnsMs).toBe(4.2);
    expect(trace.client.connectionType).toBe('4g');
  });

  it('reports the delivery in the analytics summary', async () => {
    const token = await signUp('sender@postal.test');

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { to: ['peer@example.net'], subject: 'Counted', body: 'Count me.' },
    });
    await waitForStatus(accepted.json().id, ['sent']);

    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/stats/summary?windowHours=1',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(summary.statusCode).toBe(200);
    expect(summary.json().totals.sent).toBe(1);
    expect(summary.json().deliveryRate).toBe(1);
    // The aggregation reads real timings out of the embedded attempt documents.
    expect(summary.json().latency.p50Ms).toBeGreaterThan(0);
    expect(summary.json().phaseBreakdownMs.data).toBeGreaterThan(0);
  });
});

describe('inbound SMTP ingress', () => {
  /** Deliver a message into our own listener using our own client. */
  async function deliverToIngress(to: string, subject: string): Promise<number> {
    const client = new SmtpClient({
      host: '127.0.0.1',
      port: ingressPort,
      clientHostname: 'sender.example.net',
      transcript: new SmtpTranscript(),
      tlsPolicy: 'disabled',
      rejectUnauthorized: false,
      connectTimeoutMs: 5000,
      commandTimeoutMs: 10_000,
    });

    const raw = await composeMime({
      messageId: `<inbound-${Math.random().toString(36).slice(2)}@example.net>`,
      from: 'outsider@example.net',
      to: [to],
      cc: [],
      bcc: [],
      subject,
      body: 'Delivered into the Postal ingress.',
      html: false,
      attachments: [],
    });

    try {
      await client.connect();
      await client.ehlo();
      const result = await client.send({ from: 'outsider@example.net', to: [to] }, raw);
      await client.quit();
      return result.reply.code;
    } finally {
      client.destroy();
    }
  }

  it('accepts mail for a local mailbox and files it into the inbox', async () => {
    const token = await signUp('receiver@postal.test');

    const code = await deliverToIngress('receiver@postal.test', 'Hello from outside');
    expect(code).toBe(250);

    const inbox = await app.inject({
      method: 'GET',
      url: '/api/v1/messages?folder=inbox',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(inbox.json().items).toHaveLength(1);
    expect(inbox.json().items[0].subject).toBe('Hello from outside');
    expect(inbox.json().items[0].from).toBe('outsider@example.net');
    // Inbound mail arrives unread; the sender's own copy would not.
    expect(inbox.json().items[0].read).toBe(false);
  });

  it('refuses mail for a domain it is not authoritative for', async () => {
    // This is the open-relay check: accepting this would let anyone use the
    // server to send mail onward to third parties.
    await expect(deliverToIngress('stranger@elsewhere.example', 'Relay attempt')).rejects.toThrow();
  });

  it('refuses mail for an unknown local address', async () => {
    await expect(deliverToIngress('nobody@postal.test', 'No such user')).rejects.toThrow();
  });
});
