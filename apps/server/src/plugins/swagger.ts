import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/**
 * OpenAPI derived from the same Zod schemas that validate requests at runtime.
 *
 * Hand-written API docs drift the moment a field is added. Generating the spec
 * from the validators means the documentation cannot disagree with the
 * behaviour — if the schema changes, so does the published contract.
 */
export const swaggerPlugin = fp(async function swaggerDocs(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Postal API',
        version: '1.0.0',
        description:
          'HTTP control plane for the Postal mail transfer agent. Submits mail for ' +
          'delivery, reads mailboxes, and exposes per-transaction SMTP network telemetry.',
      },
      servers: [{ url: '/', description: 'Current host' }],
      tags: [
        { name: 'auth', description: 'Registration, login and session rotation' },
        { name: 'messages', description: 'Mail submission and mailbox access' },
        { name: 'stats', description: 'Delivery analytics and network telemetry' },
        { name: 'system', description: 'Health, readiness and Prometheus metrics' },
        { name: 'events', description: 'Server-sent event stream' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true, persistAuthorization: true },
  });
});
