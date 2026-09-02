import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { RefreshTokenModel } from '../src/models/refresh-token.model.js';
import { UserModel } from '../src/models/user.model.js';
import { clearDatabase, startTestDatabase, stopTestDatabase } from './helpers/database.js';

let app: FastifyInstance;

const credentials = { email: 'fiza@postal.test', password: 'CorrectHorse123' };

beforeAll(async () => {
  await startTestDatabase();
  app = (await buildApp()) as unknown as FastifyInstance;
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await stopTestDatabase();
});

afterEach(async () => {
  await clearDatabase();
});

async function register(overrides: Partial<typeof credentials> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { ...credentials, ...overrides },
  });
}

/** Pull the refresh cookie out of a Set-Cookie header for reuse in a request. */
function refreshCookie(response: Awaited<ReturnType<typeof register>>): string {
  const cookie = response.cookies.find((c) => c.name === 'postal_refresh');
  if (!cookie) throw new Error('Response did not set a refresh cookie');
  return `postal_refresh=${cookie.value}`;
}

describe('POST /api/v1/auth/register', () => {
  it('creates an account and opens a session', async () => {
    const response = await register();
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.user.email).toBe(credentials.email);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(response.cookies.some((c) => c.name === 'postal_refresh')).toBe(true);
  });

  it('never returns the password hash', async () => {
    const response = await register();
    expect(JSON.stringify(response.json())).not.toContain('argon2');
    expect(response.json().user).not.toHaveProperty('passwordHash');
  });

  it('stores the password as an Argon2id digest, not in the clear', async () => {
    await register();
    const user = await UserModel.findOne({ email: credentials.email }).select('+passwordHash');

    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user?.passwordHash).not.toContain(credentials.password);
  });

  it('rejects a duplicate email with 409', async () => {
    await register();
    const response = await register();
    expect(response.statusCode).toBe(409);
  });

  it('rejects a password that is too short', async () => {
    const response = await register({ password: 'Short1' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('accepts correct credentials', async () => {
    await register();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: credentials,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe(credentials.email);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    await register();

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { ...credentials, password: 'WrongPassword123' },
    });
    const unknownUser = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@postal.test', password: 'WrongPassword123' },
    });

    // Distinguishing the two would turn the login form into an account
    // enumeration oracle.
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.json().error.message).toBe(unknownUser.json().error.message);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const registered = await register();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: refreshCookie(registered) },
    });

    expect(response.statusCode).toBe(200);
    expect(refreshCookie(response)).not.toBe(refreshCookie(registered));
  });

  it('revokes the whole session family when a rotated token is replayed', async () => {
    const registered = await register();
    const original = refreshCookie(registered);

    await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: original } });

    // Replaying the already-exchanged token is the signature of a stolen
    // cookie: the legitimate client would be holding its successor.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: original },
    });

    expect(replay.statusCode).toBe(401);

    const live = await RefreshTokenModel.countDocuments({ revokedAt: null });
    expect(live).toBe(0);
  });

  it('rejects a tampered cookie signature', async () => {
    const registered = await register();
    const tampered = refreshCookie(registered).replace(/.$/, 'x');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: tampered },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the authenticated account', async () => {
    const registered = await register();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${registered.json().accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().email).toBe(credentials.email);
  });

  it('rejects a request with no token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a token signed with a different secret', async () => {
    // A forged token with a valid structure but the wrong signature.
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdHRhY2tlciIsImVtYWlsIjoiYUBiLmMiLCJyb2xlIjoiYWRtaW4ifQ.notavalidsignature';

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${forged}` },
    });

    expect(response.statusCode).toBe(401);
  });
});
