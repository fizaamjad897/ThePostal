import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '@postal/shared';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
  interface FastifyInstance {
    /** Route guard: `preHandler: [app.requireAuth]`. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      ...roles: UserRole[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Bearer-token authentication.
 *
 * The access token is read from the Authorization header, not from a cookie:
 * only the refresh token is a cookie, and keeping the short-lived credential out
 * of automatic browser attachment removes CSRF as a concern for every mutating
 * endpoint. The one exception is the SSE stream, which cannot set headers from
 * `EventSource` and therefore accepts the token as a query parameter.
 */
export const authPlugin = fp(async function auth(app: FastifyInstance) {
  app.decorateRequest('user', undefined);

  app.decorate('requireAuth', async function requireAuth(request: FastifyRequest) {
    const token = extractToken(request);
    if (!token) throw new UnauthorizedError('Missing bearer token');

    const claims = await verifyAccessToken(token);
    request.user = { id: claims.sub, email: claims.email, role: claims.role };
  });

  app.decorate('requireRole', function requireRole(...roles: UserRole[]) {
    return async function guard(request: FastifyRequest, reply: FastifyReply) {
      if (!request.user) await app.requireAuth(request, reply);
      if (!request.user || !roles.includes(request.user.role)) {
        throw new ForbiddenError(`This endpoint requires one of: ${roles.join(', ')}`);
      }
    };
  });
});

function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();

  // EventSource cannot send an Authorization header, so the stream endpoint
  // passes the token in the query string instead.
  const query = request.query as { access_token?: unknown } | undefined;
  if (typeof query?.access_token === 'string' && query.access_token.length > 0) {
    return query.access_token;
  }

  return null;
}
