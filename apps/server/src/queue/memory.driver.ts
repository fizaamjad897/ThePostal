import { logger } from '../config/logger.js';
import type { DeliveryJob, DeliveryQueue, JobHandler, QueueCounts } from './types.js';

/**
 * A single-process delivery queue.
 *
 * This exists so the project starts with nothing but MongoDB running — a
 * reviewer cloning the repo should not need Redis to watch mail flow. It honours
 * the same contract as the BullMQ driver, including delayed retries and bounded
 * concurrency, but it is explicitly not durable: jobs live in memory and a
 * restart loses whatever was in flight.
 *
 * The retry sweeper compensates. Because every queued message is also persisted
 * with a `nextRetryAt`, a restart re-enqueues anything the crash dropped, so the
 * durability gap is bounded by the sweep interval rather than being unbounded.
 */
export class MemoryDeliveryQueue implements DeliveryQueue {
  readonly driver = 'memory' as const;

  private readonly waiting: DeliveryJob[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private handler: JobHandler | null = null;
  private concurrency = 1;
  private active = 0;
  private failed = 0;
  private closed = false;

  async enqueue(job: DeliveryJob, options: { delayMs?: number } = {}): Promise<void> {
    if (this.closed) return;
    const delay = options.delayMs ?? 0;

    if (delay > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.waiting.push(job);
        this.drain();
      }, delay);
      // Do not hold the event loop open purely to wait on a retry; a shutdown
      // should not be blocked for the length of the backoff.
      timer.unref();
      this.timers.add(timer);
      return;
    }

    this.waiting.push(job);
    this.drain();
  }

  async consume(handler: JobHandler, concurrency: number): Promise<void> {
    this.handler = handler;
    this.concurrency = Math.max(1, concurrency);
    this.drain();
  }

  private drain(): void {
    if (!this.handler || this.closed) return;

    while (this.active < this.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift()!;
      this.active += 1;

      void this.handler(job)
        .catch((error: unknown) => {
          this.failed += 1;
          // The handler owns retry scheduling; a throw that reaches here is a
          // bug in the handler rather than a delivery failure, so it is logged
          // loudly instead of being silently re-queued.
          logger.error({ err: error, job }, 'Delivery handler threw; job dropped');
        })
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }

  async counts(): Promise<QueueCounts> {
    return {
      waiting: this.waiting.length,
      active: this.active,
      delayed: this.timers.size,
      failed: this.failed,
    };
  }

  isHealthy(): boolean {
    return !this.closed;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.waiting.length = 0;
  }
}
