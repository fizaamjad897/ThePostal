import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { BullDeliveryQueue } from './bullmq.driver.js';
import { MemoryDeliveryQueue } from './memory.driver.js';
import type { DeliveryQueue } from './types.js';

let instance: DeliveryQueue | null = null;

/**
 * Select a queue driver from configuration. Redis when it is configured,
 * in-process otherwise — the choice is logged at boot so the durability
 * trade-off is never a surprise in an incident.
 */
export function getDeliveryQueue(): DeliveryQueue {
  if (instance) return instance;

  if (env.REDIS_URL) {
    instance = new BullDeliveryQueue(env.REDIS_URL);
    logger.info('Delivery queue: BullMQ (durable, Redis-backed)');
  } else {
    instance = new MemoryDeliveryQueue();
    logger.warn(
      'Delivery queue: in-process (jobs are lost on restart). Set REDIS_URL for durable delivery.',
    );
  }

  return instance;
}

export async function closeDeliveryQueue(): Promise<void> {
  await instance?.close();
  instance = null;
}

export type { DeliveryJob, DeliveryQueue, QueueCounts } from './types.js';
