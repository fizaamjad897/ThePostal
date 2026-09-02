import type { DeliveryAttempt, Message } from '@postal/shared';
import type { MessageDocument } from '../../models/message.model.js';

/**
 * Map a persisted message to its API representation.
 *
 * `includeBody` is off by default so list endpoints never serialise full bodies —
 * a mailbox page of 25 messages with 100 KB bodies is 2.5 MB of response that no
 * list view renders.
 */
export function toMessageDto(
  document: MessageDocument | Record<string, unknown>,
  options: { includeBody?: boolean } = {},
): Message {
  const doc = document as unknown as MessageDocument & { _id: { toString(): string } };

  return {
    id: doc._id.toString(),
    messageId: doc.messageId,
    folder: doc.folder,
    status: doc.status,
    from: doc.from,
    to: doc.to ?? [],
    cc: doc.cc ?? [],
    bcc: doc.bcc ?? [],
    subject: doc.subject,
    bodyPreview: doc.bodyPreview ?? '',
    ...(options.includeBody ? { body: doc.body } : {}),
    html: Boolean(doc.html),
    sizeBytes: doc.sizeBytes ?? 0,
    attachments: (doc.attachments ?? []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
    })),
    attempts: (doc.attempts ?? []).map(toAttemptDto),
    attemptCount: doc.attemptCount ?? 0,
    nextRetryAt: doc.nextRetryAt ? new Date(doc.nextRetryAt).toISOString() : null,
    lastError: doc.lastError ?? null,
    read: Boolean(doc.read),
    starred: Boolean(doc.starred),
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

function toAttemptDto(attempt: MessageDocument['attempts'][number]): DeliveryAttempt {
  return {
    attempt: attempt.attempt,
    startedAt: new Date(attempt.startedAt).toISOString(),
    finishedAt: new Date(attempt.finishedAt).toISOString(),
    status: attempt.status,
    responseCode: attempt.responseCode ?? null,
    responseText: attempt.responseText ?? null,
    error: attempt.error ?? null,
    trace: attempt.trace
      ? {
          remoteHost: attempt.trace.remoteHost ?? null,
          remoteAddress: attempt.trace.remoteAddress ?? null,
          remotePort: attempt.trace.remotePort ?? null,
          mxPriority: attempt.trace.mxPriority ?? null,
          tlsProtocol: attempt.trace.tlsProtocol ?? null,
          tlsCipher: attempt.trace.tlsCipher ?? null,
          totalMs: attempt.trace.totalMs,
          phases: (attempt.trace.phases ?? []).map((p) => ({
            phase: p.phase,
            durationMs: p.durationMs,
          })),
          messageBytes: attempt.trace.messageBytes ?? 0,
          throughputKbps: attempt.trace.throughputKbps ?? null,
          client: attempt.trace.client
            ? {
                dnsMs: attempt.trace.client.dnsMs ?? null,
                tcpMs: attempt.trace.client.tcpMs ?? null,
                tlsMs: attempt.trace.client.tlsMs ?? null,
                ttfbMs: attempt.trace.client.ttfbMs ?? null,
                connectionType: attempt.trace.client.connectionType ?? null,
                downlinkMbps: attempt.trace.client.downlinkMbps ?? null,
                rttMs: attempt.trace.client.rttMs ?? null,
              }
            : null,
        }
      : null,
  };
}
