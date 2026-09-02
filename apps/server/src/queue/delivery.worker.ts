import type { MessageStatus, NetworkTrace } from '@postal/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { eventBus } from '../lib/events.js';
import { SmtpDeliveryError } from '../lib/errors.js';
import { MessageModel } from '../models/message.model.js';
import { deliverMessage, type OutboundMessage } from '../smtp/delivery.js';
import { getDeliveryQueue } from './index.js';
import type { DeliveryJob } from './types.js';

/** Retry ceiling. Beyond an hour, backoff stops being useful and just delays the bounce. */
const MAX_BACKOFF_MS = 60 * 60 * 1000;

/**
 * Exponential backoff with full jitter.
 *
 * Jitter matters more than it looks: without it, a relay outage causes every
 * message deferred in the same window to retry at the same instant, and the
 * recovering server is hit by the entire backlog at once. Randomising across the
 * whole interval spreads that thundering herd.
 */
export function backoffFor(attempt: number): number {
  const exponential = Math.min(env.DELIVERY_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return Math.round(Math.random() * exponential);
}

/**
 * Process one delivery job: load the message, attempt an SMTP transaction,
 * record the attempt, and decide whether to retry, bounce, or finish.
 *
 * The function never throws for a delivery failure — a failed delivery is a
 * normal outcome that the message's own status records. It only throws if the
 * database is unreachable, which is a genuine infrastructure fault the queue
 * should surface.
 */
export async function processDeliveryJob(job: DeliveryJob): Promise<void> {
  const message = await MessageModel.findOne({ messageId: job.messageId }).select('+attachments.content');

  if (!message) {
    logger.warn({ messageId: job.messageId }, 'Delivery job references a message that no longer exists');
    return;
  }

  // Guard against a duplicate job for a message that has already settled — a
  // sweeper re-queue racing an in-flight attempt, for instance.
  if (message.status === 'sent' || message.status === 'failed') {
    logger.debug({ messageId: job.messageId, status: message.status }, 'Skipping settled message');
    return;
  }

  const startedAt = new Date();
  message.status = 'sending';
  message.attemptCount = job.attempt;
  await message.save();
  eventBus.publish('message.sending', {
    id: message._id.toString(),
    messageId: message.messageId,
    attempt: job.attempt,
  });

  const outbound: OutboundMessage = {
    messageId: message.messageId,
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    body: message.body,
    html: message.html,
    attachments: message.attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: Buffer.from(a.content),
    })),
    clientTrace: normaliseClientTrace(message.attempts[0]?.trace?.client),
  };

  try {
    const result = await deliverMessage(outbound);

    message.attempts.push({
      attempt: job.attempt,
      startedAt,
      finishedAt: new Date(),
      status: 'sent',
      responseCode: result.responseCode,
      responseText: result.responseText,
      error: null,
      trace: result.trace,
    });
    message.status = 'sent';
    message.nextRetryAt = null;
    message.lastError = null;
    await message.save();

    logger.info(
      {
        messageId: message.messageId,
        attempt: job.attempt,
        totalMs: result.trace.totalMs,
        host: result.trace.remoteHost,
      },
      'Message delivered',
    );
    eventBus.publish('message.sent', {
      id: message._id.toString(),
      messageId: message.messageId,
      trace: result.trace,
    });
  } catch (error) {
    const smtpError =
      error instanceof SmtpDeliveryError
        ? error
        : new SmtpDeliveryError(error instanceof Error ? error.message : String(error), {
            permanent: false,
            cause: error,
          });

    const exhausted = job.attempt >= env.DELIVERY_MAX_ATTEMPTS;
    const status: MessageStatus = smtpError.permanent || exhausted ? 'failed' : 'deferred';

    message.attempts.push({
      attempt: job.attempt,
      startedAt,
      finishedAt: new Date(),
      status,
      responseCode: smtpError.responseCode,
      responseText: smtpError.responseText,
      error: smtpError.message,
      trace: null,
    });
    message.status = status;
    message.lastError = smtpError.message;

    if (status === 'deferred') {
      const delayMs = backoffFor(job.attempt);
      message.nextRetryAt = new Date(Date.now() + delayMs);
      await message.save();

      await getDeliveryQueue().enqueue(
        { messageId: message.messageId, attempt: job.attempt + 1 },
        { delayMs },
      );

      logger.warn(
        { messageId: message.messageId, attempt: job.attempt, delayMs, err: smtpError.message },
        'Delivery deferred; retry scheduled',
      );
      eventBus.publish('message.deferred', {
        id: message._id.toString(),
        messageId: message.messageId,
        attempt: job.attempt,
        nextRetryAt: message.nextRetryAt.toISOString(),
        error: smtpError.message,
      });
      return;
    }

    message.nextRetryAt = null;
    await message.save();

    logger.error(
      {
        messageId: message.messageId,
        attempt: job.attempt,
        permanent: smtpError.permanent,
        exhausted,
        err: smtpError.message,
      },
      'Delivery failed permanently',
    );
    eventBus.publish('message.failed', {
      id: message._id.toString(),
      messageId: message.messageId,
      error: smtpError.message,
      responseCode: smtpError.responseCode,
    });
  }
}

/**
 * Re-enqueue messages whose retry time has passed but which are not in the
 * queue — the case after a restart, or after the in-process driver lost its
 * timers. Persisted `nextRetryAt` is the source of truth; the queue is only a
 * scheduling cache, so this sweep is what makes retries survive a crash.
 */
export async function sweepDeferredMessages(): Promise<number> {
  const due = await MessageModel.find({
    status: 'deferred',
    nextRetryAt: { $lte: new Date() },
  })
    .select('messageId attemptCount')
    .limit(200)
    .lean();

  const queue = getDeliveryQueue();
  for (const message of due) {
    await queue.enqueue({ messageId: message.messageId, attempt: (message.attemptCount ?? 0) + 1 });
  }

  if (due.length > 0) logger.info({ count: due.length }, 'Re-enqueued deferred messages');
  return due.length;
}

let sweepTimer: NodeJS.Timeout | null = null;

export function startRetrySweeper(intervalMs = 30_000): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void sweepDeferredMessages().catch((error: unknown) => {
      logger.error({ err: error }, 'Retry sweep failed');
    });
  }, intervalMs);
  sweepTimer.unref();
}

export function stopRetrySweeper(): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}

/**
 * Mongoose types every optional subdocument field as `T | undefined`, while the
 * API contract uses `T | null` throughout. Normalising once here keeps the
 * `undefined`/`null` distinction from leaking into the delivery path.
 */
function normaliseClientTrace(
  client: { [K in keyof NonNullable<NetworkTrace['client']>]?: NonNullable<NetworkTrace['client']>[K] | undefined } | null | undefined,
): NetworkTrace['client'] {
  if (!client) return null;
  return {
    dnsMs: client.dnsMs ?? null,
    tcpMs: client.tcpMs ?? null,
    tlsMs: client.tlsMs ?? null,
    ttfbMs: client.ttfbMs ?? null,
    connectionType: client.connectionType ?? null,
    downlinkMbps: client.downlinkMbps ?? null,
    rttMs: client.rttMs ?? null,
  };
}
