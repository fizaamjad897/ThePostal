import type { LoginInput, PublicUser, RegisterInput } from '@postal/shared';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ConflictError, UnauthorizedError } from '../../lib/errors.js';
import { RefreshTokenModel } from '../../models/refresh-token.model.js';
import { UserModel, type UserDocument } from '../../models/user.model.js';
import { hashPassword, verifyPassword } from './password.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from './tokens.js';

/** Lock an account after this many consecutive failures, for this long. */
const MAX_FAILED_ATTEMPTS = 8;
const LOCK_DURATION_MS = 15 * 60 * 1000;

export interface SessionContext {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export interface IssuedSession {
  user: PublicUser;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

export function toPublicUser(user: UserDocument): PublicUser {
  return {
    id: user.id as string,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: (user.createdAt).toISOString(),
  };
}

export async function register(input: RegisterInput, context: SessionContext): Promise<IssuedSession> {
  const existing = await UserModel.exists({ email: input.email });
  if (existing) throw new ConflictError('An account with that email already exists');

  const mailbox = input.email.split('@')[0]!;
  const passwordHash = await hashPassword(input.password);

  let user: UserDocument;
  try {
    user = await UserModel.create({
      email: input.email,
      passwordHash,
      displayName: input.displayName?.trim() || mailbox,
      // Mailbox is the local part, disambiguated if two people register the same
      // local part from different domains (alice@a.com and alice@b.com).
      mailbox: (await UserModel.exists({ mailbox })) ? `${mailbox}.${Date.now().toString(36)}` : mailbox,
    });
  } catch (error) {
    // The unique index is the real guard; the check above only produces a nicer
    // message. A concurrent registration lands here instead of a 500.
    if (isDuplicateKeyError(error)) throw new ConflictError('An account with that email already exists');
    throw error;
  }

  logger.info({ userId: user.id, email: user.email }, 'User registered');
  return issueSession(user, context);
}

export async function login(input: LoginInput, context: SessionContext): Promise<IssuedSession> {
  const user = await UserModel.findOne({ email: input.email }).select('+passwordHash');

  if (!user) {
    // Hash a dummy value so a request for an unknown address costs the same as
    // one for a known address. Without this, response time alone enumerates
    // which accounts exist.
    await verifyPassword(
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$3Nm5ZG5rZ2tZSGVsbG9Xb3JsZERlY295SGFzaA',
      input.password,
    );
    throw new UnauthorizedError('Invalid email or password');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const seconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    throw new UnauthorizedError(`Account is temporarily locked. Try again in ${seconds}s.`);
  }

  const valid = await verifyPassword(user.passwordHash, input.password);

  if (!valid) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
      user.failedLoginAttempts = 0;
      logger.warn({ userId: user.id, email: user.email }, 'Account locked after repeated failures');
    }
    await user.save();
    throw new UnauthorizedError('Invalid email or password');
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  return issueSession(user, context);
}

/**
 * Exchange a refresh token for a new pair, rotating the old one.
 *
 * Reuse detection: if a token that has already been exchanged is presented
 * again, it has almost certainly been stolen — the legitimate client would be
 * holding its successor. The entire family is revoked, which logs the attacker
 * and the victim out together and forces a fresh authentication.
 */
export async function refresh(token: string, context: SessionContext): Promise<IssuedSession> {
  const stored = await RefreshTokenModel.findOne({ tokenHash: hashRefreshToken(token) });

  if (!stored) throw new UnauthorizedError('Refresh token is not recognised');

  if (stored.revokedAt || stored.replacedBy) {
    await RefreshTokenModel.updateMany(
      { family: stored.family, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    logger.warn(
      { userId: stored.user.toString(), family: stored.family },
      'Refresh token reuse detected; session family revoked',
    );
    throw new UnauthorizedError('Refresh token has already been used');
  }

  if (stored.expiresAt <= new Date()) throw new UnauthorizedError('Refresh token has expired');

  const user = await UserModel.findById(stored.user);
  if (!user) throw new UnauthorizedError('Account no longer exists');

  const next = generateRefreshToken();
  stored.replacedBy = next.hash;
  stored.revokedAt = new Date();
  await stored.save();

  await RefreshTokenModel.create({
    user: user._id,
    tokenHash: next.hash,
    family: stored.family, // Rotation keeps the lineage, so reuse stays detectable.
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000),
    userAgent: context.userAgent ?? null,
    ip: context.ip ?? null,
  });

  const access = await signAccessToken({ userId: user.id as string, email: user.email, role: user.role });

  return {
    user: toPublicUser(user),
    accessToken: access.token,
    expiresIn: access.expiresIn,
    refreshToken: next.token,
  };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  // Revoke the family rather than the single token: logging out should end the
  // session everywhere it was rotated to, not just the tab that asked.
  const stored = await RefreshTokenModel.findOne({ tokenHash: hashRefreshToken(token) });
  if (!stored) return;
  await RefreshTokenModel.updateMany(
    { family: stored.family, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

async function issueSession(user: UserDocument, context: SessionContext): Promise<IssuedSession> {
  const access = await signAccessToken({ userId: user.id as string, email: user.email, role: user.role });
  const refreshToken = generateRefreshToken();

  await RefreshTokenModel.create({
    user: user._id,
    tokenHash: refreshToken.hash,
    family: refreshToken.family,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000),
    userAgent: context.userAgent ?? null,
    ip: context.ip ?? null,
  });

  return {
    user: toPublicUser(user),
    accessToken: access.token,
    expiresIn: access.expiresIn,
    refreshToken: refreshToken.token,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}
