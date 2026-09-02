import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import type { NetworkTrace, SmtpPhase } from '@postal/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { SmtpDeliveryError } from '../lib/errors.js';
import { deliveryDuration, messagesDelivered } from '../lib/metrics.js';
import { SmtpClient, type SmtpSendResult } from './client.js';
import { domainOf, resolveMx, type MxTarget } from './resolver.js';
import { SmtpTranscript, type TranscriptLine } from './transcript.js';

export interface OutboundMessage {
  messageId: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  html: boolean;
  attachments: { filename: string; contentType: string; content: Buffer }[];
  clientTrace?: NetworkTrace['client'];
}

export interface DeliveryResult {
  responseCode: number | null;
  responseText: string | null;
  acceptedRecipients: string[];
  rejectedRecipients: string[];
  trace: NetworkTrace;
  transcript: TranscriptLine[];
}

/**
 * Build the RFC 5322 message.
 *
 * MIME assembly is genuinely intricate — header folding, encoding selection,
 * multipart boundaries — and getting it wrong produces mail that renders as
 * garbage in some clients and fine in others. Nodemailer's composer is used for
 * exactly this and nothing else; the wire protocol below is ours.
 */
export async function composeMime(message: OutboundMessage): Promise<Buffer> {
  const composer = new MailComposer({
    messageId: message.messageId,
    from: message.from,
    to: message.to,
    cc: message.cc.length ? message.cc : undefined,
    // Bcc is intentionally omitted from the headers. Recipients come from the
    // SMTP envelope (RCPT TO), so blind copies stay blind — writing them into
    // the message would disclose them to every recipient.
    subject: message.subject,
    text: message.html ? undefined : message.body,
    html: message.html ? message.body : undefined,
    attachments: message.attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: a.content,
    })),
    date: new Date(),
  });

  return composer.compile().build();
}

/** Envelope recipients: everyone the message actually goes to, deduplicated. */
export function envelopeRecipients(message: OutboundMessage): string[] {
  return [...new Set([...message.to, ...message.cc, ...message.bcc].map((a) => a.toLowerCase()))];
}

/**
 * Deliver one message and return a full network trace.
 *
 * Routing has two modes. With `SMTP_RELAY_HOST` set every message goes to that
 * smart host, which is how a submission agent behaves and how the project runs
 * offline against Mailpit. Without it, the recipient domain's MX records are
 * resolved and tried in priority order — direct-to-MX, as a real MTA does.
 */
export async function deliverMessage(message: OutboundMessage): Promise<DeliveryResult> {
  const transcript = new SmtpTranscript();
  const recipients = envelopeRecipients(message);

  if (recipients.length === 0) {
    throw new SmtpDeliveryError('Message has no recipients', { permanent: true });
  }

  const raw = await composeMime(message);
  const { targets, mxPriority, dnsMs } = await routeFor(recipients, transcript);

  let lastError: unknown = null;

  // Try each MX in priority order. A transient failure at one host is not a
  // failure of the domain — RFC 5321 §5.1 requires trying the next target
  // before deferring the message.
  for (const target of targets) {
    const client = new SmtpClient({
      host: target.host,
      port: target.port,
      clientHostname: env.SMTP_HOSTNAME,
      transcript,
      tlsPolicy: env.SMTP_TLS_POLICY,
      rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED,
      connectTimeoutMs: env.SMTP_CONNECT_TIMEOUT_MS,
      commandTimeoutMs: env.SMTP_COMMAND_TIMEOUT_MS,
      auth: target.auth,
    });

    try {
      await client.connect();
      await client.ehlo();
      await client.startTls();
      await client.authenticate();

      const result = await client.send({ from: message.from, to: recipients }, raw);
      await client.quit();

      const trace = buildTrace(transcript, result, {
        host: target.host,
        mxPriority,
        dnsMs,
        clientTrace: message.clientTrace ?? null,
      });

      messagesDelivered.labels('sent').inc();
      deliveryDuration.labels('sent').observe(trace.totalMs);

      return {
        responseCode: result.reply.code,
        responseText: result.reply.text,
        acceptedRecipients: result.acceptedRecipients,
        rejectedRecipients: result.rejectedRecipients.map((r) => r.address),
        trace,
        transcript: transcript.transcript,
      };
    } catch (error) {
      client.destroy();
      lastError = error;

      // A permanent rejection is the domain's answer, not this host's — trying
      // a secondary MX would get the same 5xx and waste an attempt.
      if (error instanceof SmtpDeliveryError && error.permanent) break;

      logger.warn(
        { err: error, host: target.host, messageId: message.messageId },
        'Delivery target failed, trying next MX',
      );
    }
  }

  const outcome =
    lastError instanceof SmtpDeliveryError && lastError.permanent ? 'failed' : 'deferred';
  messagesDelivered.labels(outcome).inc();
  deliveryDuration.labels(outcome).observe(transcript.totalMs);

  throw lastError instanceof Error
    ? lastError
    : new SmtpDeliveryError('Delivery failed for an unknown reason', { permanent: false });
}

interface Route {
  targets: { host: string; port: number; auth?: { user: string; pass: string } }[];
  mxPriority: number | null;
  dnsMs: number;
}

async function routeFor(recipients: string[], transcript: SmtpTranscript): Promise<Route> {
  if (env.SMTP_RELAY_HOST) {
    const auth =
      env.SMTP_RELAY_USER && env.SMTP_RELAY_PASS
        ? { user: env.SMTP_RELAY_USER, pass: env.SMTP_RELAY_PASS }
        : undefined;
    return {
      targets: [{ host: env.SMTP_RELAY_HOST, port: env.SMTP_RELAY_PORT, auth }],
      mxPriority: null,
      dnsMs: 0,
    };
  }

  // Direct-to-MX delivery handles one domain per transaction. Splitting a
  // multi-domain message into one job per domain happens in the queue layer,
  // so by the time we get here every recipient shares a domain.
  const domains = new Set(recipients.map(domainOf));
  if (domains.size > 1) {
    throw new SmtpDeliveryError(
      `A direct-to-MX transaction cannot span domains (${[...domains].join(', ')})`,
      { permanent: true },
    );
  }

  const domain = [...domains][0]!;
  transcript.begin('dns');
  const lookup = await resolveMx(domain);
  transcript.end('dns');

  const ordered: MxTarget[] = lookup.targets;
  return {
    targets: ordered.map((t) => ({ host: t.host, port: 25 })),
    mxPriority: ordered[0]?.priority ?? null,
    dnsMs: lookup.lookupMs,
  };
}

function buildTrace(
  transcript: SmtpTranscript,
  result: SmtpSendResult,
  context: {
    host: string;
    mxPriority: number | null;
    dnsMs: number;
    clientTrace: NetworkTrace['client'];
  },
): NetworkTrace {
  const phases = transcript.phases;
  // Guarantee a stable phase ordering for the UI waterfall regardless of which
  // phases actually ran (STARTTLS and AUTH are both conditional).
  const order: SmtpPhase[] = ['dns', 'tcp', 'tls', 'greeting', 'ehlo', 'auth', 'mailFrom', 'rcptTo', 'data', 'quit'];
  phases.sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase));

  return {
    remoteHost: context.host,
    remoteAddress: result.remoteAddress,
    remotePort: result.remotePort,
    mxPriority: context.mxPriority,
    tlsProtocol: result.tlsProtocol,
    tlsCipher: result.tlsCipher,
    totalMs: transcript.totalMs,
    phases,
    messageBytes: result.messageBytes,
    throughputKbps: result.throughputKbps,
    client: context.clientTrace,
  };
}
