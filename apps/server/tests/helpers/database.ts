import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectToDatabase, disconnectFromDatabase } from '../../src/db/connection.js';

let memoryServer: MongoMemoryServer | null = null;

/**
 * Tests run against a real MongoDB started in-process rather than a mocked
 * driver. Aggregation pipelines, unique indexes and TTL behaviour are exactly
 * the parts most likely to be wrong, and a mock would assert nothing about them.
 */
export async function startTestDatabase(): Promise<void> {
  memoryServer = await MongoMemoryServer.create({
    // 7.0 or later: the stats pipeline uses the `$percentile` accumulator.
    binary: { version: '7.0.14' },
  });
  await connectToDatabase(memoryServer.getUri('postal-test'));
  // Indexes are not built automatically in every environment, and the
  // uniqueness assertions depend on them existing.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}

export async function stopTestDatabase(): Promise<void> {
  await disconnectFromDatabase();
  await memoryServer?.stop();
  memoryServer = null;
}

export async function clearDatabase(): Promise<void> {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
