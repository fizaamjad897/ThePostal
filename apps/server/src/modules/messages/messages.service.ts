import { randomUUID } from 'node:crypto';
import { Types, type FilterQuery } from 'mongoose';
import type {
  ComposeMessage,
  ListMessagesQuery,
  Message,
  PaginatedMessages,
  PatchMessageInput,
} from '@postal/shared';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { BadRequestError, NotFoundError, PayloadTooLargeError } from '../../lib/errors.js';
import { eventBus } from '../../lib/events.js';
import { messagesAccepted } from '../../lib/metrics.js';
import { decodeCursor, encodeCursor } from '../../lib/pagination.js';
import { MessageModel, type Message as MessageDoc } from '../../models/message.model.js';
import { getDeliveryQueue } from '../../queue/index.js';
import { domainOf } from '../../smtp/resolver.js';
import { toMessageDto } from './messages.mapper.js';

/**
 * Accept a message for delivery.
 *
 * The message is persisted before it is queued, and the HTTP response returns as
 * soon as it is durable. That ordering is what makes acceptance meaningful: a
 * 202 promises the message will be delivered or bounced, not that it already
 * has been. Delivering synchronously would tie the request to a remote server's
 * latency and lose the message entirely if the client disconnected.
 */
export async function submitMessage(
  ownerId: string,
  senderEmail: string,
  input: ComposeMessage,
): Promise<Message> {
  const attachments = input.attachments.map((a) => {
    const content = Buffer.from(a.content, 'base64');
    return {
      filename: a.filename,
      contentType: a.contentType,
      sizeBytes: content.byteLength,
      content,
    };
  });

  const totalBytes =
    Buffer.byteLength(input.body, 'utf8') + attachments.reduce((sum, a) => sum + a.sizeBytes, 0);

  if (totalBytes > env.SMTP_MAX_MESSAGE_BYTES) {
    throw new PayloadTooLargeError(
      `Message is ${totalBytes} bytes; the limit is ${env.SMTP_MAX_MESSAGE_BYTES}`,
    );
  }

  const recipients = [...new Set([...input.to, ...input.cc, ...input.bcc])];

  // Without a smart host each transaction targets one domain's MX, so a
  // multi-domain message would need splitting into several. Rejecting it up
  // front is honest; silently delivering to only one domain is not.
  if (!env.SMTP_RELAY_HOST) {
    const domains = new Set(recipients.map(domainOf));
    if (domains.size > 1) {
      throw new BadRequestError(
        'Direct-to-MX delivery handles one recipient domain per message. ' +
          `This message spans ${domains.size} (${[...domains].join(', ')}). ` +
          'Send them separately, or configure SMTP_RELAY_HOST.',
      );
    }
  }

  const message = await MessageModel.create({
    owner: new Types.ObjectId(ownerId),
    messageId: `<${randomUUID()}@${env.MAIL_DOMAIN}>`,
    folder: 'sent',
    status: 'queued',
    from: senderEmail,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    body: input.body,
    html: input.html,
    attachments,
    attemptCount: 0,
    read: true, // The sender has, by definition, read their own message.
    attempts: input.clientTrace
      ? [
          {
            // Attempt 0 is a placeholder carrying only the browser's timings, so
            // the client-side view of the request can be compared against the
            // server's view of the SMTP transaction on the same trace.
            attempt: 1,
            startedAt: new Date(),
            finishedAt: new Date(),
            status: 'queued',
            responseCode: null,
            responseText: null,
            error: null,
            trace: {
              remoteHost: null,
              remoteAddress: null,
              remotePort: null,
              mxPriority: null,
              tlsProtocol: null,
              tlsCipher: null,
              totalMs: 0,
              phases: [],
              messageBytes: totalBytes,
              throughputKbps: null,
              client: {
                dnsMs: input.clientTrace.dnsMs ?? null,
                tcpMs: input.clientTrace.tcpMs ?? null,
                tlsMs: input.clientTrace.tlsMs ?? null,
                ttfbMs: input.clientTrace.ttfbMs ?? null,
                connectionType: input.clientTrace.connectionType ?? null,
                downlinkMbps: input.clientTrace.downlinkMbps ?? null,
                rttMs: input.clientTrace.rttMs ?? null,
              },
            },
          },
        ]
      : [],
  });

  await getDeliveryQueue().enqueue({ messageId: message.messageId, attempt: 1 });

  messagesAccepted.labels('api').inc();
  logger.info(
    { messageId: message.messageId, owner: ownerId, recipients: recipients.length, bytes: totalBytes },
    'Message accepted for delivery',
  );
  eventBus.publish('message.queued', {
    id: message._id.toString(),
    messageId: message.messageId,
    owner: ownerId,
    subject: message.subject,
  });

  return toMessageDto(message);
}

export async function listMessages(
  ownerId: string,
  query: ListMessagesQuery,
): Promise<PaginatedMessages> {
  const filter: FilterQuery<MessageDoc> = {
    owner: new Types.ObjectId(ownerId),
    folder: query.folder,
  };

  if (query.status) filter.status = query.status;
  if (query.starred !== undefined) filter.starred = query.starred;
  if (query.q) filter.$text = { $search: query.q };

  // Keyset pagination: page 2 is "everything older than the last item of page
  // 1", which stays correct when new mail arrives between requests. Offsets
  // would shift every row down and repeat an item on the next page.
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    filter.$or = [
      { createdAt: { $lt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), _id: { $lt: new Types.ObjectId(cursor.id) } },
    ];
  }

  const [documents, total] = await Promise.all([
    MessageModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1) // One extra row tells us whether another page exists.
      .lean(),
    MessageModel.countDocuments({ owner: filter.owner, folder: query.folder }),
  ]);

  const hasMore = documents.length > query.limit;
  const page = hasMore ? documents.slice(0, query.limit) : documents;
  const last = page[page.length - 1];

  return {
    items: page.map((doc) => toMessageDto(doc as never)),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            createdAt: new Date(last.createdAt).toISOString(),
            id: last._id.toString(),
          })
        : null,
    total,
  };
}

export async function getMessage(ownerId: string, messageId: string): Promise<Message> {
  const document = await MessageModel.findOne({
    _id: toObjectId(messageId),
    // Ownership is part of the query, not a check after the fact — there is no
    // code path that can load another user's message and forget to compare.
    owner: new Types.ObjectId(ownerId),
  });

  if (!document) throw new NotFoundError('Message');
  return toMessageDto(document, { includeBody: true });
}

export async function patchMessage(
  ownerId: string,
  messageId: string,
  patch: PatchMessageInput,
): Promise<Message> {
  const document = await MessageModel.findOneAndUpdate(
    { _id: toObjectId(messageId), owner: new Types.ObjectId(ownerId) },
    { $set: patch },
    { new: true },
  );

  if (!document) throw new NotFoundError('Message');
  return toMessageDto(document, { includeBody: true });
}

export async function deleteMessage(ownerId: string, messageId: string): Promise<void> {
  const result = await MessageModel.deleteOne({
    _id: toObjectId(messageId),
    owner: new Types.ObjectId(ownerId),
  });
  if (result.deletedCount === 0) throw new NotFoundError('Message');
}

/** Re-queue a failed message for another delivery attempt. */
export async function retryMessage(ownerId: string, messageId: string): Promise<Message> {
  const document = await MessageModel.findOne({
    _id: toObjectId(messageId),
    owner: new Types.ObjectId(ownerId),
  });

  if (!document) throw new NotFoundError('Message');
  if (document.status !== 'failed' && document.status !== 'deferred') {
    throw new BadRequestError(`Only failed or deferred messages can be retried (status: ${document.status})`);
  }

  document.status = 'queued';
  document.nextRetryAt = null;
  document.lastError = null;
  await document.save();

  await getDeliveryQueue().enqueue({
    messageId: document.messageId,
    attempt: document.attemptCount + 1,
  });

  eventBus.publish('message.queued', {
    id: document._id.toString(),
    messageId: document.messageId,
    retry: true,
  });
  return toMessageDto(document, { includeBody: true });
}

function toObjectId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw new NotFoundError('Message');
  return new Types.ObjectId(value);
}
