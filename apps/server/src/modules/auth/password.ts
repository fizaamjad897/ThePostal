import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * Argon2id parameters, following the OWASP Password Storage Cheat Sheet's
 * second recommended configuration: 19 MiB of memory, 2 iterations, 1 lane.
 *
 * Argon2id over bcrypt because it is memory-hard — the cost to an attacker with
 * GPUs scales with memory, which they cannot trade away, whereas bcrypt's work
 * factor is compute-only and parallelises cheaply.
 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, OPTIONS);
}

export async function verifyPassword(digest: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(digest, plaintext, OPTIONS);
  } catch {
    // A malformed or truncated digest must read as "wrong password", never as a
    // crash that a caller might mistake for a successful comparison.
    return false;
  }
}
