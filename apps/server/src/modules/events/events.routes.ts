import type { FastifyInstance } from 'fastify';
import { eventBus } from '../../lib/events.js';
import { activeSseClients, queueDepth } from '../../lib/metrics.js';
import { getDeliveryQueue } from '../../queue/index.js';

/** Interval between keep-alive comments. Below most proxy idle timeouts. */
const HEARTBEAT_MS = 25_000;
/** Interval between queue-depth pushes to connected dashboards. */
const METRICS_TICK_MS = 5_000;

/**
 * Server-sent events feeding the live dashboards.
 *
 * SSE rather than WebSockets: the traffic is entirely server-to-client, and SSE
 * gets automatic reconnection, plain HTTP semantics, and no second protocol to
 * proxy or secure. A WebSocket would only pay off if the browser needed to push.
 */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/stream',
    {
      preHandler: [app.requireAuth],
      schema: {
        tags: ['events'],
        summary: 'Subscribe to live delivery events (text/event-stream)',
        description:
          'EventSource cannot set an Authorization header, so this endpoint also accepts ' +
          'the access token as an `access_token` query parameter.',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Nginx buffers proxied responses by default, which holds events until
        // the buffer fills and makes a live stream arrive in batches.
        'x-accel-buffering': 'no',
      });

      activeSseClients.inc();
      const userId = request.user!.id;

      const write = (event: { type: string; at: string; payload?: unknown }): void => {
        // A slow or dead client must not accumulate an unbounded write buffer.
        if (reply.raw.writableEnded) return;
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      const unsubscribe = eventBus.subscribe((event) => {
        const payload = event.payload as { owner?: string } | null;
        // Events carrying an owner are private to that user; unowned events
        // (queue depth, for instance) are broadcast.
        if (payload?.owner && payload.owner !== userId) return;
        write(event);
      });

      const heartbeat = setInterval(() => {
        if (!reply.raw.writableEnded) reply.raw.write(': keep-alive\n\n');
      }, HEARTBEAT_MS);

      const metricsTick = setInterval(() => {
        void (async () => {
          const counts = await getDeliveryQueue().counts();
          for (const [state, value] of Object.entries(counts) as [string, number][]) {
            queueDepth.labels(state).set(value);
          }
          write({ type: 'metrics.tick', at: new Date().toISOString(), payload: { queue: counts } });
        })();
      }, METRICS_TICK_MS);

      const cleanup = (): void => {
        clearInterval(heartbeat);
        clearInterval(metricsTick);
        unsubscribe();
        activeSseClients.dec();
      };

      request.raw.on('close', cleanup);
      request.raw.on('error', cleanup);

      // Returning would end the response; the handler stays open until the
      // client disconnects.
      return reply;
    },
  );
}
