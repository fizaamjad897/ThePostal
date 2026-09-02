import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { env, isProduction, isTest } from '../config/env.js';

/**
 * Transport-level hardening, applied before any route is registered.
 */
export const securityPlugin = fp(async function security(app: FastifyInstance) {
  await app.register(helmet, {
    // The API serves JSON and the Swagger UI; it renders no first-party HTML of
    // its own, so a restrictive CSP costs nothing and blocks injected scripts in
    // the docs page.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Swagger UI inlines its bootstrap.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: isProduction ? { maxAge: 15_552_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    // Credentialed requests cannot use a wildcard origin, so the allow-list is
    // explicit and comes from configuration rather than reflecting the caller.
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86_400,
  });

  await app.register(cookie, {
    secret: env.JWT_SECRET, // Signs the refresh cookie against tampering.
    parseOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.COOKIE_SECURE,
      path: '/api/v1/auth',
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    // Tests would otherwise fail intermittently once a suite exceeds the window.
    enableDraftSpec: true,
    allowList: () => isTest,
    keyGenerator: (request) => {
      // Authenticated callers are limited per account, so one user on a shared
      // NAT cannot exhaust the budget for everyone behind that address.
      return request.user?.id ?? request.ip;
    },
    errorResponseBuilder: (_request, context) => ({
      error: {
        code: 'RATE_LIMITED',
        message: `Rate limit exceeded. Retry in ${context.after}.`,
      },
    }),
  });
});

/** Cookie options for the refresh token, kept in one place. */
export const refreshCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.COOKIE_SECURE,
  // Scoped to the auth routes: no other endpoint needs it, so no other endpoint
  // receives it, and an XSS on an unrelated path cannot exfiltrate it via fetch.
  path: '/api/v1/auth',
  maxAge: env.REFRESH_TOKEN_TTL_SECONDS,
  signed: true,
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
};

export const REFRESH_COOKIE_NAME = 'postal_refresh';
