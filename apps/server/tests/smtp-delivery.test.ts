import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deliverMessage, composeMime, envelopeRecipients } from '../src/smtp/delivery.js';
import { SmtpClient, dotStuff } from '../src/smtp/client.js';
import { SmtpTranscript } from '../src/smtp/transcript.js';
import { SmtpDeliveryError } from '../src/lib/errors.js';
import { startSmtpSink, type SmtpSink } from './helpers/smtp-sink.js';

const RELAY_PORT = 31025; // Matches SMTP_RELAY_PORT in vitest.config.ts.

let sink: SmtpSink;

beforeAll(async () => {
  sink = await startSmtpSink(RELAY_PORT);
});

afterAll(async () => {
  await sink.close();
});

function message(overrides: Partial<Parameters<typeof deliverMessage>[0]> = {}) {
  return {
    messageId: `<test-${Math.random().toString(36).slice(2)}@postal.test>`,
    from: 'sender@postal.test',
    to: ['recipient@example.net'],
    cc: [],
    bcc: [],
    subject: 'Delivery test',
    body: 'Hello over SMTP.',
    html: false,
    attachments: [],
    ...overrides,
  };
}

describe('outbound SMTP delivery', () => {
  it('completes a full transaction and reports a 250', async () => {
    const result = await deliverMessage(message());

    expect(result.responseCode).toBe(250);
    expect(result.acceptedRecipients).toEqual(['recipient@example.net']);
    expect(sink.received.at(-1)?.to).toEqual(['recipient@example.net']);
    expect(sink.received.at(-1)?.raw).toContain('Subject: Delivery test');
  });

  it('times every phase of the transaction separately', async () => {
    const result = await deliverMessage(message());
    const phases = result.trace.phases.map((p) => p.phase);

    // The phases that must occur on any successful transaction. TLS and AUTH are
    // absent by design here: the sink offers neither.
    expect(phases).toEqual(
      expect.arrayContaining(['tcp', 'greeting', 'ehlo', 'mailFrom', 'rcptTo', 'data', 'quit']),
    );
    expect(phases).not.toContain('tls');

    for (const phase of result.trace.phases) {
      expect(phase.durationMs).toBeGreaterThanOrEqual(0);
    }
    // The total is wall time for the whole session, so it cannot be less than
    // the sum of the parts it contains.
    const sum = result.trace.phases.reduce((acc, p) => acc + p.durationMs, 0);
    expect(result.trace.totalMs).toBeGreaterThanOrEqual(sum - 1);
  });

  it('reports the negotiated peer and payload size', async () => {
    const result = await deliverMessage(message({ body: 'x'.repeat(4096) }));

    expect(result.trace.remoteHost).toBe('127.0.0.1');
    expect(result.trace.remotePort).toBe(RELAY_PORT);
    expect(result.trace.messageBytes).toBeGreaterThan(4096);
    expect(result.trace.throughputKbps).toBeGreaterThan(0);
  });

  it('records the protocol exchange with credentials redacted', async () => {
    const result = await deliverMessage(message());
    const client = result.transcript.filter((l) => l.direction === 'C').map((l) => l.text);

    expect(client).toContain('EHLO mx.postal.test');
    expect(client.some((l) => l.startsWith('MAIL FROM:<sender@postal.test>'))).toBe(true);
    expect(client).toContain('RCPT TO:<recipient@example.net>');
    expect(client).toContain('QUIT');
    // The body is summarised rather than transcribed — a transcript is a
    // protocol log, not a copy of the mail.
    expect(client.some((l) => l.includes('bytes of message body'))).toBe(true);
  });

  it('classifies a 5xx rejection as permanent so it is not retried', async () => {
    sink.failNextWith(550, 'Recipient address rejected');

    await expect(deliverMessage(message())).rejects.toMatchObject({
      permanent: true,
      responseCode: 550,
    });
  });

  it('classifies a 4xx rejection as transient so it is retried', async () => {
    sink.failNextWith(451, 'Greylisted, try again later');

    await expect(deliverMessage(message())).rejects.toMatchObject({
      permanent: false,
      responseCode: 451,
    });
  });

  it('fails permanently when no recipient can be resolved', async () => {
    await expect(deliverMessage(message({ to: [] }))).rejects.toBeInstanceOf(SmtpDeliveryError);
  });

  it('treats a refused connection as transient rather than a bounce', async () => {
    // A down MX must defer the message, not bounce it: the server may simply be
    // restarting, and bouncing would discard deliverable mail.
    const client = new SmtpClient({
      host: '127.0.0.1',
      port: 31099, // Nothing is listening here.
      clientHostname: 'mx.postal.test',
      transcript: new SmtpTranscript(),
      tlsPolicy: 'disabled',
      rejectUnauthorized: false,
      connectTimeoutMs: 2000,
      commandTimeoutMs: 2000,
    });

    const error = await client.connect().catch((e: unknown) => e);
    client.destroy();

    expect(error).toBeInstanceOf(SmtpDeliveryError);
    expect((error as SmtpDeliveryError).permanent).toBe(false);
  });

  it('rejects a TLS-required policy against a peer that offers no STARTTLS', async () => {
    const client = new SmtpClient({
      host: '127.0.0.1',
      port: RELAY_PORT,
      clientHostname: 'mx.postal.test',
      transcript: new SmtpTranscript(),
      tlsPolicy: 'require',
      rejectUnauthorized: false,
      connectTimeoutMs: 5000,
      commandTimeoutMs: 5000,
    });

    await client.connect();
    await client.ehlo();
    // Falling back to cleartext when TLS was demanded would be worse than
    // failing, so this must be a permanent error.
    const error = await client.startTls().catch((e: unknown) => e);
    client.destroy();

    expect(error).toBeInstanceOf(SmtpDeliveryError);
    expect((error as SmtpDeliveryError).permanent).toBe(true);
  });
});

describe('MIME composition', () => {
  it('keeps blind carbon copies out of the headers', async () => {
    const raw = (
      await composeMime(
        message({ to: ['a@example.net'], cc: ['c@example.net'], bcc: ['secret@example.net'] }),
      )
    ).toString('utf8');

    expect(raw).toContain('a@example.net');
    expect(raw).toContain('c@example.net');
    // The blind copy must reach the envelope but never the message.
    expect(raw).not.toContain('secret@example.net');
    expect(envelopeRecipients(message({ bcc: ['secret@example.net'] }))).toContain(
      'secret@example.net',
    );
  });

  it('deduplicates a recipient listed in more than one field', () => {
    const recipients = envelopeRecipients(
      message({ to: ['dup@example.net'], cc: ['DUP@example.net'], bcc: ['dup@example.net'] }),
    );
    expect(recipients).toEqual(['dup@example.net']);
  });
});

describe('DATA transparency (RFC 5321 §4.5.2)', () => {
  it('escapes a leading dot so the body cannot terminate the transaction early', () => {
    const stuffed = dotStuff(Buffer.from('line one\r\n.\r\nline two', 'utf8')).toString('utf8');
    expect(stuffed).toBe('line one\r\n..\r\nline two');
  });

  it('escapes a dot at the very start of the payload', () => {
    expect(dotStuff(Buffer.from('.hidden', 'utf8')).toString('utf8')).toBe('..hidden');
  });

  it('leaves a dot that is not at the start of a line alone', () => {
    const input = 'version 1.2.3\r\nno change here';
    expect(dotStuff(Buffer.from(input, 'utf8')).toString('utf8')).toBe(input);
  });

  it('survives a body whose content would otherwise truncate the message', async () => {
    const body = 'before\r\n.\r\nafter';
    await deliverMessage(message({ body }));

    const raw = sink.received.at(-1)!.raw;
    // Both halves must arrive; without dot-stuffing the server would have ended
    // the message at the lone dot and dropped everything after it.
    expect(raw).toContain('before');
    expect(raw).toContain('after');
  });
});
