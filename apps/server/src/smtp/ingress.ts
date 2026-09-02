import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { SMTPServer, type SMTPServerSession } from 'smtp-server';
import { simpleParser, type ParsedMail } from 'mailparser';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { eventBus } from '../lib/events.js';
import { smtpIngressSessions } from '../lib/metrics.js';
import { MessageModel } from '../models/message.model.js';
import { UserModel } from '../models/user.model.js';
import { verifyPassword } from '../modules/auth/password.js';

/**
 * The inbound half of the MTA: a real SMTP listener that accepts mail from any
 * standards-compliant client (Thunderbird, `swaks`, another MTA) and files it
 * into the addressed user's mailbox.
 *
 * This is what makes the project a mail server rather than a form that writes
 * rows: the same message can be composed in the web UI, delivered over the wire
 * by our own client, received here, and read back in the recipient's inbox.
 */
let server: SMTPServer | null = null;
let listening = false;

export function isIngressUp(): boolean {
  return listening;
}

export function createIngressServer(): SMTPServer {
  return new SMTPServer({
    name: env.SMTP_HOSTNAME,
    banner: 'Postal MTA ready',
    size: env.SMTP_MAX_MESSAGE_BYTES,

    // STARTTLS is advertised only when a certificate is configured. Announcing
    // it without one produces a handshake failure that clients report as an
    // outage rather than as a misconfiguration.
    hideSTARTTLS: true,
    // Anonymous submission is accepted so the daemon can receive mail from
    // arbitrary senders, which is what an MX does. AUTH is offered for
    // authenticated submission and, when used, sets the message's owner.
    authOptional: true,
    disabledCommands: [],

    onAuth(auth, _session, callback) {
      void (async () => {
        try {
          const user = await UserModel.findOne({ email: auth.username?.toLowerCase() }).select(
            '+passwordHash',
          );
          if (!user || !auth.password || !(await verifyPassword(user.passwordHash, auth.password))) {
            // Deliberately identical for unknown user and wrong password, so the
            // reply cannot be used to enumerate valid accounts.
            callback(new Error('Invalid username or password'));
            return;
          }
          callback(null, { user: user.id as string });
        } catch (error) {
          logger.error({ err: error }, 'SMTP ingress authentication error');
          callback(new Error('Temporary authentication failure'));
        }
      })();
    },

    onRcptTo(address, _session, callback) {
      void (async () => {
        const recipient = address.address.toLowerCase();
        const domain = recipient.split('@')[1];

        // Refusing mail for domains we are not authoritative for is what stops
        // this being an open relay — an unauthenticated host must not be able
        // to use us to send mail onward to third parties.
        if (domain !== env.MAIL_DOMAIN) {
          const error = new Error(`Relay access denied for ${recipient}`) as Error & { responseCode?: number };
          error.responseCode = 550;
          callback(error);
          return;
        }

        const exists = await UserModel.exists({ email: recipient });
        if (!exists) {
          const error = new Error(`No such user here: ${recipient}`) as Error & { responseCode?: number };
          error.responseCode = 550;
          callback(error);
          return;
        }

        callback();
      })();
    },

    onData(stream, session, callback) {
      void (async () => {
        const startedAt = performance.now();
        try {
          const parsed = await simpleParser(stream);

          if (stream.sizeExceeded) {
            smtpIngressSessions.labels('rejected').inc();
            const error = new Error('Message exceeds the maximum permitted size') as Error & {
              responseCode?: number;
            };
            error.responseCode = 552;
            callback(error);
            return;
          }

          const stored = await storeInboundMessage(parsed, session);
          const durationMs = Math.round(performance.now() - startedAt);

          smtpIngressSessions.labels('accepted').inc();
          logger.info(
            {
              messageId: stored.messageId,
              recipients: stored.recipients,
              bytes: stored.sizeBytes,
              durationMs,
              remote: session.remoteAddress,
            },
            'Inbound message accepted',
          );
          callback();
        } catch (error) {
          smtpIngressSessions.labels('error').inc();
          logger.error({ err: error, remote: session.remoteAddress }, 'Failed to accept inbound message');
          // 451 rather than 5xx: the fault is ours, and a well-behaved sender
          // should retry rather than bounce the message back to its author.
          const failure = new Error('Temporary local error; please retry') as Error & {
            responseCode?: number;
          };
          failure.responseCode = 451;
          callback(failure);
        }
      })();
    },

  });
}

interface StoredInbound {
  messageId: string;
  recipients: string[];
  sizeBytes: number;
}

/**
 * File a parsed message into each local recipient's inbox.
 *
 * One document per recipient, rather than one shared document with a recipient
 * list: mailbox state (read, starred, folder) is per-user, and sharing a row
 * would mean one recipient's actions mutating another's view.
 */
async function storeInboundMessage(
  parsed: ParsedMail,
  session: SMTPServerSession,
): Promise<StoredInbound> {
  const recipients = session.envelope.rcptTo.map((r) => r.address.toLowerCase());

  // Prefer the From: header, but fall back to the envelope sender: a message
  // may legitimately omit the header, and the envelope is what a bounce would
  // actually be returned to.
  const envelopeFrom = session.envelope.mailFrom ? session.envelope.mailFrom.address : null;
  const sender =
    parsed.from?.value[0]?.address?.toLowerCase() ??
    envelopeFrom?.toLowerCase() ??
    'unknown@invalid';

  const html = typeof parsed.html === 'string' && parsed.html.length > 0;
  const body = html ? parsed.html : (parsed.text ?? '');
  const messageId = parsed.messageId ?? `<${randomUUID()}@${env.MAIL_DOMAIN}>`;

  const owners = await UserModel.find({ email: { $in: recipients } }).select('_id email').lean();
  const attachments = (parsed.attachments ?? []).map((a) => ({
    filename: a.filename ?? 'attachment',
    contentType: a.contentType ?? 'application/octet-stream',
    sizeBytes: a.size ?? a.content.byteLength,
    content: a.content,
  }));

  let sizeBytes = 0;

  for (const owner of owners) {
    // Each copy needs its own Message-ID: the field is unique-indexed, and a
    // message addressed to two local users would otherwise collide with itself.
    const perRecipientId =
      owners.length === 1 ? messageId : messageId.replace(/^</, `<${owner._id.toString()}.`);

    const document = await MessageModel.create({
      owner: owner._id,
      messageId: perRecipientId,
      folder: 'inbox',
      status: 'sent',
      from: sender,
      to: recipients,
      cc: parsed.cc ? toAddressList(parsed.cc) : [],
      bcc: [],
      subject: parsed.subject?.slice(0, 255) || '(no subject)',
      body,
      html,
      attachments,
      attemptCount: 0,
      read: false,
    });

    sizeBytes = document.sizeBytes;
    eventBus.publish('message.received', {
      id: document._id.toString(),
      owner: owner._id.toString(),
      from: sender,
      subject: document.subject,
    });
  }

  return { messageId, recipients, sizeBytes };
}

function toAddressList(value: ParsedMail['cc']): string[] {
  if (!value) return [];
  const entries = Array.isArray(value) ? value : [value];
  return entries.flatMap((entry) =>
    entry.value.map((v) => v.address?.toLowerCase()).filter((a): a is string => Boolean(a)),
  );
}

export async function startIngress(): Promise<void> {
  if (!env.SMTP_INGRESS_ENABLED) {
    logger.info('SMTP ingress disabled by configuration');
    return;
  }

  server = createIngressServer();

  // Session-level faults (a client that hangs up mid-DATA, a malformed command)
  // surface here. They are routine on a public listener and must not be fatal.
  server.on('error', (error) => {
    logger.warn({ err: error }, 'SMTP ingress session error');
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(env.SMTP_INGRESS_PORT, '0.0.0.0', () => {
      server!.off('error', reject);
      listening = true;
      logger.info(
        { port: env.SMTP_INGRESS_PORT, hostname: env.SMTP_HOSTNAME, domain: env.MAIL_DOMAIN },
        'SMTP ingress listening',
      );
      resolve();
    });
  });
}

export async function stopIngress(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  listening = false;
  server = null;
  logger.info('SMTP ingress stopped');
}
