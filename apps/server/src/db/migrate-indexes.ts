/**
 * Apply every index declared on the models.
 *
 * Mongoose builds indexes automatically in development, but that is switched off
 * in production (`autoIndex: false` in connection.ts): an index build is a
 * blocking, potentially very slow operation, and having every booting instance
 * race to start one is how a deploy turns into an outage.
 *
 * So indexes are applied deliberately, by this script, as a release step that
 * runs before the new version starts serving. That matters for more than
 * performance — the unique indexes on `email`, `mailbox` and `messageId` are
 * what actually enforce those constraints. The application checks for duplicates
 * first, but two concurrent registrations can both pass that check; the index is
 * the only thing that stops both from being written.
 *
 * `syncIndexes` also drops indexes that are no longer declared, so a removed
 * index does not linger and cost write throughput forever.
 */
import mongoose from 'mongoose';
import { logger } from '../config/logger.js';
import { connectToDatabase, disconnectFromDatabase } from './connection.js';

// Importing the models is what registers them on the mongoose instance; without
// this the loop below has nothing to iterate over.
import '../models/user.model.js';
import '../models/message.model.js';
import '../models/refresh-token.model.js';

async function migrate(): Promise<void> {
  await connectToDatabase();

  for (const [name, model] of Object.entries(mongoose.models)) {
    const dropped = await model.syncIndexes();
    // `listIndexes` is typed loosely by the driver; only the name is read here.
    const indexes = (await model.listIndexes()) as { name?: string }[];

    logger.info(
      { model: name, indexes: indexes.map((index) => index.name ?? '(unnamed)'), dropped },
      'Indexes synchronised',
    );
  }
}

migrate()
  .then(() => disconnectFromDatabase())
  .then(() => {
    logger.info('Index migration complete');
    process.exit(0);
  })
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'Index migration failed');
    process.exit(1);
  });
