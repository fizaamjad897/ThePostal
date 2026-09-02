import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { MAILBOX_FOLDER, MESSAGE_STATUS, SMTP_PHASE } from '@postal/shared';

const phaseTimingSchema = new Schema(
  {
    phase: { type: String, enum: SMTP_PHASE, required: true },
    durationMs: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

/**
 * Everything measurable about one SMTP transaction. This is the payload the
 * network dashboard renders as a waterfall, so each field maps to a distinct
 * observable moment on the wire rather than to a derived aggregate.
 */
const networkTraceSchema = new Schema(
  {
    remoteHost: { type: String, default: null },
    remoteAddress: { type: String, default: null },
    remotePort: { type: Number, default: null },
    mxPriority: { type: Number, default: null },
    tlsProtocol: { type: String, default: null },
    tlsCipher: { type: String, default: null },
    totalMs: { type: Number, required: true, min: 0 },
    phases: { type: [phaseTimingSchema], default: [] },
    messageBytes: { type: Number, default: 0, min: 0 },
    throughputKbps: { type: Number, default: null },
    /** Browser-side timings supplied by the composer, kept for comparison. */
    client: {
      type: new Schema(
        {
          dnsMs: { type: Number, default: null },
          tcpMs: { type: Number, default: null },
          tlsMs: { type: Number, default: null },
          ttfbMs: { type: Number, default: null },
          connectionType: { type: String, default: null },
          downlinkMbps: { type: Number, default: null },
          rttMs: { type: Number, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { _id: false },
);

const deliveryAttemptSchema = new Schema(
  {
    attempt: { type: Number, required: true, min: 1 },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, required: true },
    status: { type: String, enum: MESSAGE_STATUS, required: true },
    responseCode: { type: Number, default: null },
    responseText: { type: String, default: null },
    error: { type: String, default: null },
    trace: { type: networkTraceSchema, default: null },
  },
  { _id: false },
);

const attachmentSchema = new Schema(
  {
    filename: { type: String, required: true, maxlength: 255 },
    contentType: { type: String, required: true, maxlength: 128 },
    sizeBytes: { type: Number, required: true, min: 0 },
    /**
     * Attachments live inline. That is a deliberate scope choice for a
     * self-hosted MTA with a 25 MB ceiling; a deployment expecting large mail
     * would swap this for an object-store key and stream the body instead.
     */
    content: { type: Buffer, required: true, select: false },
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** RFC 5322 Message-ID, generated at accept time and used for correlation. */
    messageId: { type: String, required: true, unique: true },
    folder: { type: String, enum: MAILBOX_FOLDER, required: true, default: 'sent' },
    status: { type: String, enum: MESSAGE_STATUS, required: true, default: 'queued' },

    from: { type: String, required: true, lowercase: true, trim: true },
    to: { type: [String], required: true, default: [] },
    cc: { type: [String], default: [] },
    bcc: { type: [String], default: [] },
    subject: { type: String, required: true, maxlength: 255 },
    body: { type: String, required: true },
    /** First ~180 characters, denormalised so list views never load full bodies. */
    bodyPreview: { type: String, default: '' },
    html: { type: Boolean, default: false },
    sizeBytes: { type: Number, default: 0, min: 0 },
    attachments: { type: [attachmentSchema], default: [] },

    attempts: { type: [deliveryAttemptSchema], default: [] },
    attemptCount: { type: Number, default: 0, min: 0 },
    nextRetryAt: { type: Date, default: null },
    lastError: { type: String, default: null },

    read: { type: Boolean, default: false },
    starred: { type: Boolean, default: false },
  },
  { timestamps: true },
);

/*
 * Index strategy. Every mailbox read is scoped to one owner, so `owner` leads
 * each compound index; `createdAt: -1` matches the keyset pagination sort and
 * lets Mongo satisfy both the filter and the ordering from one index.
 */
messageSchema.index({ owner: 1, folder: 1, createdAt: -1 });
messageSchema.index({ owner: 1, status: 1, createdAt: -1 });
messageSchema.index({ owner: 1, starred: 1, createdAt: -1 });
// Drives the retry sweeper, which scans only messages actually awaiting a retry.
messageSchema.index({ status: 1, nextRetryAt: 1 });
// Full-text search over the fields a user would search a mailbox by. Weighted so
// a subject hit outranks a body hit for the same term.
messageSchema.index(
  { subject: 'text', body: 'text', from: 'text', to: 'text' },
  { weights: { subject: 10, from: 5, to: 5, body: 1 }, name: 'message_search_idx' },
);

/** Keep the denormalised preview and size in step with the body on every write. */
messageSchema.pre('save', function syncDerivedFields(next) {
  if (this.isModified('body')) {
    const plain = this.html ? this.body.replace(/<[^>]*>/g, ' ') : this.body;
    this.bodyPreview = plain.replace(/\s+/g, ' ').trim().slice(0, 180);
  }
  if (this.isModified('body') || this.isModified('attachments')) {
    const attachmentBytes = this.attachments.reduce((sum, a) => sum + (a.sizeBytes ?? 0), 0);
    this.sizeBytes = Buffer.byteLength(this.body, 'utf8') + attachmentBytes;
  }
  next();
});

export type Message = InferSchemaType<typeof messageSchema>;
export type MessageDocument = HydratedDocument<Message>;

export const MessageModel = model('Message', messageSchema);
