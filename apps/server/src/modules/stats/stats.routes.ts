import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { apiErrorSchema, statsSummarySchema } from '@postal/shared';
import { getStatsSummary } from './stats.service.js';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.requireAuth);

  route.get(
    '/summary',
    {
      schema: {
        tags: ['stats'],
        summary: 'Delivery analytics and SMTP phase timings for the caller',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          // Capped at 30 days: the aggregation scans the window, and an unbounded
          // range would let one request walk the entire collection.
          windowHours: z.coerce.number().int().min(1).max(720).default(24),
        }),
        response: { 200: statsSummarySchema, 401: apiErrorSchema },
      },
    },
    async (request) => getStatsSummary(request.user!.id, request.query.windowHours),
  );
}
