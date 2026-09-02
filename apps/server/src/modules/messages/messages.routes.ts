import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  apiErrorSchema,
  composeMessageSchema,
  listMessagesQuerySchema,
  messageSchema,
  objectIdSchema,
  paginatedMessagesSchema,
  patchMessageSchema,
} from '@postal/shared';
import * as messagesService from './messages.service.js';

const errors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  404: apiErrorSchema,
  413: apiErrorSchema,
  429: apiErrorSchema,
};

const paramsSchema = z.object({ id: objectIdSchema });

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // Every route in this module is per-user; none is reachable anonymously.
  app.addHook('preHandler', app.requireAuth);

  route.post(
    '/',
    {
      schema: {
        tags: ['messages'],
        summary: 'Submit a message for delivery',
        description:
          'Persists the message, queues it, and returns immediately with status `queued`. ' +
          'Delivery happens asynchronously; subscribe to `/api/v1/events/stream` or poll the ' +
          'message to observe the SMTP transaction and its network trace.',
        security: [{ bearerAuth: [] }],
        body: composeMessageSchema,
        response: { 202: messageSchema, ...errors },
      },
    },
    async (request, reply) => {
      const message = await messagesService.submitMessage(
        request.user!.id,
        request.user!.email,
        request.body,
      );
      // 202, not 201: the message is accepted for delivery, and whether it is
      // ultimately delivered is not yet known.
      return reply.status(202).send(message);
    },
  );

  route.get(
    '/',
    {
      schema: {
        tags: ['messages'],
        summary: 'List messages in a mailbox folder',
        description: 'Keyset-paginated. Pass the previous response\'s `nextCursor` to continue.',
        security: [{ bearerAuth: [] }],
        querystring: listMessagesQuerySchema,
        response: { 200: paginatedMessagesSchema, ...errors },
      },
    },
    async (request) => messagesService.listMessages(request.user!.id, request.query),
  );

  route.get(
    '/:id',
    {
      schema: {
        tags: ['messages'],
        summary: 'Read one message, including its body and delivery attempts',
        security: [{ bearerAuth: [] }],
        params: paramsSchema,
        response: { 200: messageSchema, ...errors },
      },
    },
    async (request) => messagesService.getMessage(request.user!.id, request.params.id),
  );

  route.patch(
    '/:id',
    {
      schema: {
        tags: ['messages'],
        summary: 'Update mailbox state (read, starred, folder)',
        security: [{ bearerAuth: [] }],
        params: paramsSchema,
        body: patchMessageSchema,
        response: { 200: messageSchema, ...errors },
      },
    },
    async (request) => messagesService.patchMessage(request.user!.id, request.params.id, request.body),
  );

  route.post(
    '/:id/retry',
    {
      schema: {
        tags: ['messages'],
        summary: 'Re-queue a failed or deferred message',
        security: [{ bearerAuth: [] }],
        params: paramsSchema,
        response: { 202: messageSchema, ...errors },
      },
    },
    async (request, reply) => {
      const message = await messagesService.retryMessage(request.user!.id, request.params.id);
      return reply.status(202).send(message);
    },
  );

  route.delete(
    '/:id',
    {
      schema: {
        tags: ['messages'],
        summary: 'Delete a message',
        security: [{ bearerAuth: [] }],
        params: paramsSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      await messagesService.deleteMessage(request.user!.id, request.params.id);
      return reply.status(204).send(null);
    },
  );
}
