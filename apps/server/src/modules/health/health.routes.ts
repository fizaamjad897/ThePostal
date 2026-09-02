import { monitorEventLoopDelay } from 'node:perf_hooks';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { serverHealthSchema, type ServerHealth } from '@postal/shared';
import { isDatabaseUp } from '../../db/connection.js';
import { registry } from '../../lib/metrics.js';
import { getDeliveryQueue } from '../../queue/index.js';
import { isIngressUp } from '../../smtp/ingress.js';

const VERSION = process.env.npm_package_version ?? '1.0.0';

/**
 * Event loop delay is sampled continuously rather than measured per request:
 * a histogram started at boot reflects sustained saturation, whereas a one-shot
 * measurement inside a handler mostly reports the scheduler's luck at that
 * instant.
 */
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get(
    '/healthz',
    {
      schema: {
        tags: ['system'],
        summary: 'Liveness probe',
        description: 'Answers as long as the process can serve requests. Never touches dependencies.',
        response: { 200: z.object({ status: z.literal('ok'), version: z.string() }) },
      },
    },
    async () => ({ status: 'ok' as const, version: VERSION }),
  );

  route.get(
    '/readyz',
    {
      schema: {
        tags: ['system'],
        summary: 'Readiness probe',
        description:
          'Reports dependency health. Returns 503 when the database is unreachable, so an ' +
          'orchestrator takes the instance out of rotation instead of sending it traffic.',
        response: { 200: serverHealthSchema, 503: serverHealthSchema },
      },
    },
    async (_request, reply) => {
      const queue = getDeliveryQueue();
      const [counts, memory] = [await queue.counts(), process.memoryUsage()];

      const mongo = isDatabaseUp();
      const queueUp = queue.isHealthy();
      // The database is the only hard dependency: without it nothing can be read
      // or accepted. A degraded queue still lets the API serve mailboxes, so it
      // reports "degraded" rather than failing the probe.
      const ready = mongo;

      // Annotated rather than inferred: without it the branches widen to
      // `string` and stop matching the schema's literal unions.
      const body: ServerHealth = {
        status: mongo && queueUp ? 'ok' : 'degraded',
        uptimeSeconds: Math.round(process.uptime()),
        version: VERSION,
        components: {
          mongo: mongo ? 'up' : 'down',
          queue: queueUp ? 'up' : 'down',
          smtpIngress: isIngressUp() ? 'up' : 'down',
        },
        queue: counts,
        process: {
          rssMb: round(memory.rss / 1024 / 1024),
          heapUsedMb: round(memory.heapUsed / 1024 / 1024),
          eventLoopDelayMs: round(loopDelay.mean / 1e6),
        },
      };

      return reply.status(ready ? 200 : 503).send(body);
    },
  );

  // Served outside the versioned API and outside the Zod type provider: the
  // response is Prometheus text exposition, not JSON.
  app.get('/metrics', { schema: { tags: ['system'], summary: 'Prometheus metrics' } }, async (_request, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
