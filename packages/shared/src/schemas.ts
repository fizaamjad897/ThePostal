import { z } from 'zod';
import {
  MAILBOX_FOLDER,
  MESSAGE_STATUS,
  SMTP_PHASE,
  USER_ROLE,
  EVENT_TYPE,
} from './enums.js';

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'must be a 24-character hex ObjectId');

export const emailAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('must be a valid email address');

/**
 * Passwords are checked for length and character classes only. We deliberately
 * do not cap complexity beyond this: length is the property that matters, and
 * aggressive composition rules push people toward weaker, patterned secrets.
 */
export const passwordSchema = z
  .string()
  .min(12, 'must be at least 12 characters')
  .max(128, 'must be at most 128 characters')
  .refine((v) => /[a-z]/.test(v), 'must contain a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'must contain an uppercase letter')
  .refine((v) => /\d/.test(v), 'must contain a digit');

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

export const registerSchema = z.object({
  email: emailAddressSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(80).optional(),
});

export const loginSchema = z.object({
  email: emailAddressSchema,
  password: z.string().min(1, 'password is required'),
});

export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(USER_ROLE),
  createdAt: z.string(),
});

export const authResultSchema = z.object({
  user: publicUserSchema,
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

export const attachmentInputSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(128).default('application/octet-stream'),
  /** Base64 payload. Size is enforced against the decoded byte length. */
  content: z.string().min(1),
});

const recipientList = z
  .array(emailAddressSchema)
  .max(50, 'at most 50 recipients per field');

export const composeMessageSchema = z
  .object({
    to: recipientList.min(1, 'at least one recipient is required'),
    cc: recipientList.default([]),
    bcc: recipientList.default([]),
    subject: z.string().trim().min(1, 'subject is required').max(255),
    body: z.string().min(1, 'body is required').max(1_000_000),
    /** When true the body is treated as HTML and a plaintext part is derived. */
    html: z.boolean().default(false),
    attachments: z.array(attachmentInputSchema).max(10).default([]),
    /** Optional client-side timings, merged into the message's network trace. */
    clientTrace: z
      .object({
        dnsMs: z.number().nonnegative().optional(),
        tcpMs: z.number().nonnegative().optional(),
        tlsMs: z.number().nonnegative().optional(),
        ttfbMs: z.number().nonnegative().optional(),
        connectionType: z.string().max(32).optional(),
        downlinkMbps: z.number().nonnegative().optional(),
        rttMs: z.number().nonnegative().optional(),
      })
      .optional(),
  })
  .strict();

export const smtpPhaseTimingSchema = z.object({
  phase: z.enum(SMTP_PHASE),
  durationMs: z.number().nonnegative(),
});

export const networkTraceSchema = z.object({
  /** MX host the message was actually delivered to. */
  remoteHost: z.string().nullable(),
  remoteAddress: z.string().nullable(),
  remotePort: z.number().int().nullable(),
  mxPriority: z.number().int().nullable(),
  tlsProtocol: z.string().nullable(),
  tlsCipher: z.string().nullable(),
  /** Sum of every phase below — total wall time of the SMTP transaction. */
  totalMs: z.number().nonnegative(),
  phases: z.array(smtpPhaseTimingSchema),
  messageBytes: z.number().int().nonnegative(),
  /** Effective application-layer throughput for the DATA phase. */
  throughputKbps: z.number().nonnegative().nullable(),
  client: z
    .object({
      dnsMs: z.number().nonnegative().nullable(),
      tcpMs: z.number().nonnegative().nullable(),
      tlsMs: z.number().nonnegative().nullable(),
      ttfbMs: z.number().nonnegative().nullable(),
      connectionType: z.string().nullable(),
      downlinkMbps: z.number().nonnegative().nullable(),
      rttMs: z.number().nonnegative().nullable(),
    })
    .nullable(),
});

export const deliveryAttemptSchema = z.object({
  attempt: z.number().int().positive(),
  startedAt: z.string(),
  finishedAt: z.string(),
  status: z.enum(MESSAGE_STATUS),
  /** Raw SMTP reply code, e.g. 250, 421, 550. */
  responseCode: z.number().int().nullable(),
  responseText: z.string().nullable(),
  error: z.string().nullable(),
  trace: networkTraceSchema.nullable(),
});

export const messageSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  folder: z.enum(MAILBOX_FOLDER),
  status: z.enum(MESSAGE_STATUS),
  from: z.string(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  bcc: z.array(z.string()),
  subject: z.string(),
  bodyPreview: z.string(),
  body: z.string().optional(),
  html: z.boolean(),
  sizeBytes: z.number().int().nonnegative(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        contentType: z.string(),
        sizeBytes: z.number().int().nonnegative(),
      }),
    )
    .default([]),
  attempts: z.array(deliveryAttemptSchema).default([]),
  attemptCount: z.number().int().nonnegative(),
  nextRetryAt: z.string().nullable(),
  lastError: z.string().nullable(),
  read: z.boolean(),
  starred: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const listMessagesQuerySchema = z.object({
  folder: z.enum(MAILBOX_FOLDER).default('inbox'),
  status: z.enum(MESSAGE_STATUS).optional(),
  q: z.string().trim().max(200).optional(),
  starred: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

export const paginatedMessagesSchema = z.object({
  items: z.array(messageSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});

export const patchMessageSchema = z
  .object({
    read: z.boolean().optional(),
    starred: z.boolean().optional(),
    folder: z.enum(MAILBOX_FOLDER).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'at least one field is required');

/* ------------------------------------------------------------------ *
 * Analytics & realtime
 * ------------------------------------------------------------------ */

export const statsSummarySchema = z.object({
  totals: z.object({
    queued: z.number().int().nonnegative(),
    sent: z.number().int().nonnegative(),
    deferred: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    received: z.number().int().nonnegative(),
  }),
  deliveryRate: z.number().min(0).max(1),
  latency: z.object({
    p50Ms: z.number().nonnegative().nullable(),
    p95Ms: z.number().nonnegative().nullable(),
    p99Ms: z.number().nonnegative().nullable(),
  }),
  /** Mean duration per SMTP phase across the window — powers the waterfall. */
  phaseBreakdownMs: z.record(z.enum(SMTP_PHASE), z.number().nonnegative()),
  throughput: z.array(
    z.object({
      bucket: z.string(),
      sent: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
  ),
  windowHours: z.number().int().positive(),
});

export const serverHealthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSeconds: z.number().nonnegative(),
  version: z.string(),
  components: z.object({
    mongo: z.enum(['up', 'down']),
    queue: z.enum(['up', 'down']),
    smtpIngress: z.enum(['up', 'down']),
  }),
  queue: z.object({
    waiting: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    delayed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  process: z.object({
    rssMb: z.number().nonnegative(),
    heapUsedMb: z.number().nonnegative(),
    eventLoopDelayMs: z.number().nonnegative(),
  }),
});

export const streamEventSchema = z.object({
  type: z.enum(EVENT_TYPE),
  at: z.string(),
  payload: z.unknown(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  requestId: z.string().optional(),
});

/* ------------------------------------------------------------------ *
 * Inferred types
 * ------------------------------------------------------------------ */

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type AuthResult = z.infer<typeof authResultSchema>;
export type ComposeMessageInput = z.input<typeof composeMessageSchema>;
export type ComposeMessage = z.infer<typeof composeMessageSchema>;
export type NetworkTrace = z.infer<typeof networkTraceSchema>;
export type SmtpPhaseTiming = z.infer<typeof smtpPhaseTimingSchema>;
export type DeliveryAttempt = z.infer<typeof deliveryAttemptSchema>;
export type Message = z.infer<typeof messageSchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
export type PaginatedMessages = z.infer<typeof paginatedMessagesSchema>;
export type PatchMessageInput = z.infer<typeof patchMessageSchema>;
export type StatsSummary = z.infer<typeof statsSummarySchema>;
export type ServerHealth = z.infer<typeof serverHealthSchema>;
export type StreamEvent = z.infer<typeof streamEventSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
