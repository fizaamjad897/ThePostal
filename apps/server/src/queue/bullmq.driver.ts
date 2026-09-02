import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../config/logger.js';
import type { DeliveryJob, DeliveryQueue, JobHandler, QueueCounts } from './types.js';

const QUEUE_NAME = 'postal:delivery';

/**
 * Durable delivery queue backed by Redis.
 *
 * Retry policy lives in the delivery worker rather than in BullMQ's own
 * `attempts`/`backoff` options. That is deliberate: SMTP retry decisions depend
 * on the reply code (4xx defers, 5xx bounces immediately), which BullMQ cannot
 * see. Letting BullMQ retry blindly would keep hammering a permanent rejection.
 */
export class BullDeliveryQueue implements DeliveryQueue {
  readonly driver = 'bullmq' as const;

  private readonly connection: Redis;
  private readonly queue: Queue<DeliveryJob>;
  private worker: Worker<DeliveryJob> | null = null;
  private healthy = false;

  constructor(redisUrl: string) {
    this.connection = new Redis(redisUrl, {
      // BullMQ blocks on Redis and requires unlimited retries per its own docs;
      // the default of 20 makes long-running workers die on a brief blip.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });

    this.connection.on('ready', () => {
      this.healthy = true;
      logger.info('Redis connection ready');
    });
    this.connection.on('error', (error: Error) => {
      this.healthy = false;
      logger.error({ err: error }, 'Redis connection error');
    });
    this.connection.on('close', () => {
      this.healthy = false;
    });

    this.queue = new Queue<DeliveryJob>(QUEUE_NAME, {
      connection: this.connection as unknown as ConnectionOptions,
      defaultJobOptions: {
        // Keep a bounded history: enough to inspect recent failures in the
        // dashboard, not so much that Redis memory grows without limit.
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
        attempts: 1,
      },
    });
  }

  async enqueue(job: DeliveryJob, options: { delayMs?: number } = {}): Promise<void> {
    await this.queue.add('deliver', job, {
      delay: options.delayMs ?? 0,
      // The job id makes enqueueing idempotent per attempt: a sweeper that
      // re-queues a message already in flight is a no-op rather than a
      // duplicate delivery.
      jobId: `${job.messageId}:${job.attempt}`,
    });
  }

  async consume(handler: JobHandler, concurrency: number): Promise<void> {
    this.worker = new Worker<DeliveryJob>(QUEUE_NAME, async (job) => handler(job.data), {
      connection: this.connection as unknown as ConnectionOptions,
      concurrency,
    });

    this.worker.on('failed', (job, error) => {
      logger.error({ err: error, jobId: job?.id, data: job?.data }, 'Delivery job failed');
    });
    this.worker.on('error', (error) => {
      logger.error({ err: error }, 'Delivery worker error');
    });

    await this.worker.waitUntilReady();
    logger.info({ concurrency }, 'BullMQ delivery worker ready');
  }

  async counts(): Promise<QueueCounts> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
    };
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}
