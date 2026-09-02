import mongoose from 'mongoose';
import { env, isProduction } from '../config/env.js';
import { logger } from '../config/logger.js';

// Mongoose exposes `readyState` as a numeric enum; comparing against its own
// members keeps the intent legible and type-safe.
const { connected, disconnected } = mongoose.ConnectionStates;

// Reject writes containing keys the schema does not declare, rather than
// silently dropping them — a typo'd field name should fail loudly.
mongoose.set('strictQuery', true);
if (!isProduction) mongoose.set('debug', false);

let connecting: Promise<typeof mongoose> | null = null;

/**
 * Idempotent connect. Mongoose maintains its own pool and buffers operations
 * issued before the handshake completes, so callers never need to sequence
 * themselves behind this — but awaiting it at boot means a bad URI fails
 * immediately instead of as a timeout on the first request.
 */
export async function connectToDatabase(uri: string = env.MONGODB_URI): Promise<void> {
  if (mongoose.connection.readyState === connected) return;
  if (connecting) {
    await connecting;
    return;
  }

  connecting = mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8_000,
    maxPoolSize: 20,
    minPoolSize: 2,
    retryWrites: true,
    autoIndex: !isProduction, // In production, indexes are applied by migration.
  });

  mongoose.connection.on('error', (error) => {
    logger.error({ err: error }, 'MongoDB connection error');
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });
  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
  });

  try {
    await connecting;
    logger.info({ host: mongoose.connection.host, db: mongoose.connection.name }, 'MongoDB connected');
  } finally {
    connecting = null;
  }
}

export async function disconnectFromDatabase(): Promise<void> {
  if (mongoose.connection.readyState === disconnected) return;
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}

export function isDatabaseUp(): boolean {
  return mongoose.connection.readyState === connected;
}
