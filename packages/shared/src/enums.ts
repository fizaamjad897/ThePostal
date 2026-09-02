/**
 * Lifecycle of a message inside the MTA.
 *
 * The state machine mirrors how a real mail transfer agent tracks a message:
 * a message is QUEUED the moment the API accepts it, moves to SENDING while a
 * worker holds the SMTP session, and settles as SENT, DEFERRED (a transient
 * 4xx — will be retried) or FAILED (a permanent 5xx, or retries exhausted).
 */
export const MESSAGE_STATUS = [
  'queued',
  'sending',
  'sent',
  'deferred',
  'failed',
] as const;

export type MessageStatus = (typeof MESSAGE_STATUS)[number];

/** A message is terminal when no further delivery attempt will be scheduled. */
export const TERMINAL_STATUSES: readonly MessageStatus[] = ['sent', 'failed'];

export const MAILBOX_FOLDER = ['inbox', 'sent', 'drafts', 'archive'] as const;
export type MailboxFolder = (typeof MAILBOX_FOLDER)[number];

export const USER_ROLE = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLE)[number];

/**
 * Phases of an outbound SMTP transaction that we time individually.
 * Ordered as they occur on the wire, which is also the order the UI renders.
 */
export const SMTP_PHASE = [
  'dns',
  'tcp',
  'tls',
  'greeting',
  'ehlo',
  'auth',
  'mailFrom',
  'rcptTo',
  'data',
  'quit',
] as const;

export type SmtpPhase = (typeof SMTP_PHASE)[number];

/** Server-sent event channels published on `GET /api/v1/events/stream`. */
export const EVENT_TYPE = [
  'message.queued',
  'message.sending',
  'message.sent',
  'message.deferred',
  'message.failed',
  'message.received',
  'metrics.tick',
] as const;

export type EventType = (typeof EVENT_TYPE)[number];
