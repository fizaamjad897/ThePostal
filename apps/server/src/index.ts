import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { buildApp } from './app.js';
import { connectToDatabase, disconnectFromDatabase } from './db/connection.js';
import { closeDeliveryQueue, getDeliveryQueue } from './queue/index.js';
import {
  processDeliveryJob,
  startRetrySweeper,
  stopRetrySweeper,
  sweepDeferredMessages,
} from './queue/delivery.worker.js';
import { startIngress, stopIngress } from './smtp/ingress.js';

/**
 * Process entrypoint. Three long-lived subsystems run in one process: the HTTP
 * API, the SMTP ingress listener, and the delivery worker.
 *
 * They are co-located deliberately — a single `npm start` brings up a complete,
 * working mail server, which matters for a project meant to be cloned and run.
 * Each is independently startable, so splitting the worker onto its own node is
 * a deployment change rather than a rewrite.
 */
async function main(): Promise<void> {
  await connectToDatabase();

  const queue = getDeliveryQueue();
  await queue.consume(processDeliveryJob, env.DELIVERY_CONCURRENCY);

  // A restart leaves deferred mail with a past `nextRetryAt` and no queue entry.
  // Sweeping once at boot recovers it immediately rather than after the first
  // scheduled interval.
  await sweepDeferredMessages();
  startRetrySweeper();

  await startIngress();

  const app = await buildApp();
  await app.listen({ host: env.HOST, port: env.PORT });

  logger.info(
    {
      api: `http://${env.HOST}:${env.PORT}`,
      docs: `http://${env.HOST}:${env.PORT}/docs`,
      smtp: env.SMTP_INGRESS_ENABLED ? `smtp://${env.HOST}:${env.SMTP_INGRESS_PORT}` : 'disabled',
      relay: env.SMTP_RELAY_HOST ? `${env.SMTP_RELAY_HOST}:${env.SMTP_RELAY_PORT}` : 'direct-to-MX',
      queue: queue.driver,
    },
    'Postal is up',
  );

  installShutdownHandlers(app);
}

/**
 * Graceful shutdown. Order matters: stop accepting new work first, then drain,
 * then release connections. Closing MongoDB while a delivery is mid-flight would
 * lose the attempt record for a message that was actually sent.
 */
function installShutdownHandlers(app: Awaited<ReturnType<typeof buildApp>>): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return; // A second Ctrl-C must not race the first.
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    const timeout = setTimeout(() => {
      logger.error('Graceful shutdown timed out after 15s; forcing exit');
      process.exit(1);
    }, 15_000);
    timeout.unref();

    void (async () => {
      try {
        stopRetrySweeper();
        await stopIngress();
        await app.close();
        await closeDeliveryQueue();
        await disconnectFromDatabase();
        clearTimeout(timeout);
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      }
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // An unhandled rejection leaves the process in an unknown state. Logging and
  // exiting lets the supervisor restart cleanly instead of limping on.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start');
  process.exit(1);
});
