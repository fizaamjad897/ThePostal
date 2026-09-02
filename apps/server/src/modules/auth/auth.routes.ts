import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  apiErrorSchema,
  authResultSchema,
  loginSchema,
  publicUserSchema,
  registerSchema,
} from '@postal/shared';
import { env } from '../../config/env.js';
import { UnauthorizedError } from '../../lib/errors.js';
import { UserModel } from '../../models/user.model.js';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from '../../plugins/security.js';
import * as authService from './auth.service.js';

const errors = { 400: apiErrorSchema, 401: apiErrorSchema, 409: apiErrorSchema, 429: apiErrorSchema };

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // Credential endpoints get their own, much tighter budget than the global
  // limit — they are the ones worth brute-forcing.
  const authRateLimit = {
    rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' },
  };

  route.post(
    '/register',
    {
      config: authRateLimit,
      schema: {
        tags: ['auth'],
        summary: 'Create an account and open a session',
        body: registerSchema,
        response: { 201: authResultSchema, ...errors },
      },
    },
    async (request, reply) => {
      const session = await authService.register(request.body, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      reply.setCookie(REFRESH_COOKIE_NAME, session.refreshToken, refreshCookieOptions);
      return reply.status(201).send({
        user: session.user,
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
      });
    },
  );

  route.post(
    '/login',
    {
      config: authRateLimit,
      schema: {
        tags: ['auth'],
        summary: 'Exchange credentials for an access token',
        body: loginSchema,
        response: { 200: authResultSchema, ...errors },
      },
    },
    async (request, reply) => {
      const session = await authService.login(request.body, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      reply.setCookie(REFRESH_COOKIE_NAME, session.refreshToken, refreshCookieOptions);
      return reply.send({
        user: session.user,
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
      });
    },
  );

  route.post(
    '/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Rotate the refresh cookie for a new access token',
        description:
          'Reads the signed `postal_refresh` cookie. The presented token is revoked and ' +
          'replaced; presenting an already-rotated token revokes the whole session family.',
        response: { 200: authResultSchema, ...errors },
      },
    },
    async (request, reply) => {
      const token = readRefreshCookie(request.unsignCookie.bind(request), request.cookies[REFRESH_COOKIE_NAME]);
      const session = await authService.refresh(token, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      reply.setCookie(REFRESH_COOKIE_NAME, session.refreshToken, refreshCookieOptions);
      return reply.send({
        user: session.user,
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
      });
    },
  );

  route.post(
    '/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke the current session family',
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const raw = request.cookies[REFRESH_COOKIE_NAME];
      const unsigned = raw ? request.unsignCookie(raw) : null;
      await authService.logout(unsigned?.valid ? (unsigned.value ?? undefined) : undefined);
      reply.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
      return reply.status(204).send(null);
    },
  );

  route.get(
    '/me',
    {
      preHandler: [app.requireAuth],
      schema: {
        tags: ['auth'],
        summary: 'Return the authenticated account',
        security: [{ bearerAuth: [] }],
        response: { 200: publicUserSchema, ...errors },
      },
    },
    async (request) => {
      const user = await UserModel.findById(request.user!.id);
      if (!user) throw new UnauthorizedError('Account no longer exists');
      return authService.toPublicUser(user);
    },
  );
}

/**
 * The cookie is signed, so a tampered value must be rejected rather than passed
 * to the database as a lookup key.
 */
function readRefreshCookie(
  unsign: (value: string) => { valid: boolean; value: string | null },
  raw: string | undefined,
): string {
  if (!raw) throw new UnauthorizedError('No refresh cookie present');
  const result = unsign(raw);
  if (!result.valid || !result.value) throw new UnauthorizedError('Refresh cookie signature is invalid');
  return result.value;
}
