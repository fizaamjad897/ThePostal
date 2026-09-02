/** One unit of delivery work: a single message bound for a single domain. */
export interface DeliveryJob {
  messageId: string;
  /** Attempt number, 1-based. Carried on the job so retries are self-describing. */
  attempt: number;
}

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

export type JobHandler = (job: DeliveryJob) => Promise<void>;

/**
 * The queue contract, kept deliberately small so both drivers can honour it
 * exactly. Anything richer (priorities, rate limits, job dependencies) would be
 * BullMQ-only and would make the in-memory fallback a lie.
 */
export interface DeliveryQueue {
  readonly driver: 'bullmq' | 'memory';
  enqueue(job: DeliveryJob, options?: { delayMs?: number }): Promise<void>;
  /** Register the worker. Called once at boot. */
  consume(handler: JobHandler, concurrency: number): Promise<void>;
  counts(): Promise<QueueCounts>;
  isHealthy(): boolean;
  close(): Promise<void>;
}
