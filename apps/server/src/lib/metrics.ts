import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from '@prometheus-io/client';
import type { SmtpPhase } from '@postal/shared';

/**
 * A dedicated registry rather than the global default, so tests can build an
 * isolated instance and metrics from other libraries cannot bleed in.
 */
export const registry = new Registry();
registry.setDefaultLabels({ service: 'postal-server' });
collectDefaultMetrics({ register: registry, prefix: 'postal_' });

/**
 * Buckets are tuned for SMTP rather than HTTP: a same-datacentre relay settles
 * in single-digit milliseconds, while a cold connection to a remote MX with a
 * TLS handshake routinely lands in the hundreds. The default HTTP buckets top
 * out too early to show the tail we care about.
 */
const SMTP_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000];

export const httpRequestDuration = new Histogram({
  name: 'postal_http_request_duration_ms',
  help: 'HTTP request duration in milliseconds.',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500],
  registers: [registry],
});

export const messagesAccepted = new Counter({
  name: 'postal_messages_accepted_total',
  help: 'Messages accepted for delivery by the API or SMTP ingress.',
  labelNames: ['source'] as const,
  registers: [registry],
});

export const messagesDelivered = new Counter({
  name: 'postal_messages_delivered_total',
  help: 'Delivery attempts by terminal outcome.',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const deliveryDuration = new Histogram({
  name: 'postal_smtp_transaction_duration_ms',
  help: 'Wall time of a complete outbound SMTP transaction.',
  labelNames: ['outcome'] as const,
  buckets: SMTP_BUCKETS,
  registers: [registry],
});

export const smtpPhaseDuration = new Histogram({
  name: 'postal_smtp_phase_duration_ms',
  help: 'Duration of an individual phase of the SMTP transaction.',
  labelNames: ['phase'] as const,
  buckets: SMTP_BUCKETS,
  registers: [registry],
});

export const smtpReplyCodes = new Counter({
  name: 'postal_smtp_reply_codes_total',
  help: 'SMTP reply codes observed from remote servers, bucketed by class.',
  labelNames: ['class', 'code'] as const,
  registers: [registry],
});

export const queueDepth = new Gauge({
  name: 'postal_queue_depth',
  help: 'Messages currently in the delivery queue, by queue state.',
  labelNames: ['state'] as const,
  registers: [registry],
});

export const smtpIngressSessions = new Counter({
  name: 'postal_smtp_ingress_sessions_total',
  help: 'Inbound SMTP sessions, by outcome.',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const activeSseClients = new Gauge({
  name: 'postal_sse_clients_active',
  help: 'Dashboard clients currently subscribed to the event stream.',
  registers: [registry],
});

/** Record one phase timing on both the per-phase and reply-code metrics. */
export function observePhase(phase: SmtpPhase, durationMs: number): void {
  smtpPhaseDuration.labels(phase).observe(durationMs);
}

export function observeReplyCode(code: number): void {
  smtpReplyCodes.labels(`${Math.floor(code / 100)}xx`, String(code)).inc();
}
