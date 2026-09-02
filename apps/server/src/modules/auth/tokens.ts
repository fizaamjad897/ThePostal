import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { UserRole } from '@postal/shared';
import { env } from '../../config/env.js';
import { UnauthorizedError } from '../../lib/errors.js';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'postal';
const AUDIENCE = 'postal-api';

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  email: string;
  role: UserRole;
}

/**
 * Signed with HS256. An asymmetric algorithm would be the right call the moment
 * a second service needs to verify these without holding the signing key; with
 * one issuer and one verifier, a shared secret is the simpler correct choice.
 */
export async function signAccessToken(claims: {
  userId: string;
  email: string;
  role: UserRole;
}): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = env.ACCESS_TOKEN_TTL_SECONDS;

  const token = await new SignJWT({ email: claims.email, role: claims.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(`${expiresIn}s`)
    .sign(secret);

  return { token, expiresIn };
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'], // Pinned: an unpinned verifier accepts `alg: none`.
      clockTolerance: 5,
    });
    return payload as AccessTokenClaims;
  } catch {
    // The specific jose failure (bad signature, expired, wrong audience) is
    // deliberately not surfaced: it would tell an attacker which part to fix.
    throw new UnauthorizedError('Access token is invalid or has expired');
  }
}

/**
 * Refresh tokens are opaque random strings, not JWTs. They are checked against
 * the database on every use, which is what makes immediate revocation possible —
 * a self-contained JWT stays valid until it expires no matter what the server
 * decides in the meantime.
 */
export function generateRefreshToken(): { token: string; hash: string; family: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: hashRefreshToken(token), family: randomUUID() };
}

/**
 * SHA-256 rather than Argon2 here: the token is 384 bits of CSPRNG output, so
 * there is no low-entropy secret to slow a brute force against. The hash exists
 * only so a database dump is not a set of live sessions, and a fast digest keeps
 * the lookup indexable.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
