import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { env, isProduction } from './config/env.js';
import { logger } from './config/logger.js';
import { httpRequestDuration } from './lib/metrics.js';
import { authPlugin } from './plugins/auth.plugin.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { securityPlugin } from './plugins/security.js';
import { swaggerPlugin } from './plugins/swagger.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { eventRoutes } from './modules/events/events.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { messageRoutes } from './modules/messages/messages.routes.js';
import { statsRoutes } from './modules/stats/stats.routes.js';

/**
 * Build the HTTP application without listening.
 *
 * Keeping construction separate from binding a port is what makes the API
 * testable: `app.inject()` exercises the full plugin and route stack in-process,
 * with no socket and no port to allocate, so tests can run in parallel.
 */
export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    // Trusting the proxy is what makes `request.ip` the real client rather than
    // the load balancer — which the rate limiter keys on. Only safe because the
    // deployment terminates TLS at a proxy we control.
    trustProxy: isProduction,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    bodyLimit: env.SMTP_MAX_MESSAGE_BYTES + 1024 * 1024, // Headroom for base64 expansion.
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<ZodTypeProvider>();

  // One set of Zod schemas drives request validation, response serialisation and
  // the OpenAPI document, so the three can never disagree.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandlerPlugin);
  await app.register(securityPlugin);
  await app.register(authPlugin);
  await app.register(swaggerPlugin);

  app.addHook('onResponse', (request, reply, done) => {
    httpRequestDuration
      .labels(
        request.method,
        // The route pattern, not the URL: labelling with `/messages/<id>` would
        // create one time series per message and blow up cardinality.
        request.routeOptions.url ?? 'unmatched',
        String(reply.statusCode),
      )
      .observe(reply.elapsedTime);
    done();
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(messageRoutes, { prefix: '/api/v1/messages' });
  await app.register(statsRoutes, { prefix: '/api/v1/stats' });
  await app.register(eventRoutes, { prefix: '/api/v1/events' });

  return app;
}
