/**
 * Browser-side API client.
 *
 * Two rules drive the design:
 *
 *  1. The access token lives in memory only. Putting it in localStorage would
 *     make it readable by any injected script; keeping it in a module variable
 *     means an XSS has to be executing at the right moment to steal it, and it
 *     dies with the tab.
 *  2. Session continuity comes from the refresh cookie, which is httpOnly and
 *     therefore unreadable by JavaScript at all. On a cold load the client asks
 *     for a new access token instead of restoring one.
 */

let accessToken = null;
/** De-duplicates concurrent refreshes so a burst of 401s triggers one call. */
let refreshInFlight = null;

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

async function parse(response) {
  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'Server returned a malformed response');
  }
}

async function raw(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const response = await fetch(path, {
    method,
    // Sends the refresh cookie on the auth routes it is scoped to.
    credentials: 'include',
    signal,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parse(response);

  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.message ?? `Request failed with status ${response.status}`,
      error.details,
    );
  }

  return payload;
}

/** Exchange the refresh cookie for a new access token. */
async function refreshSession() {
  refreshInFlight ??= raw('/api/v1/auth/refresh', { method: 'POST' })
    .then((result) => {
      accessToken = result.accessToken;
      return result;
    })
    .catch((error) => {
      accessToken = null;
      throw error;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

/**
 * Perform a request, transparently refreshing an expired access token once.
 *
 * Retrying exactly once is deliberate: if the refreshed token is also rejected
 * the session is genuinely over, and retrying again would loop.
 */
export async function api(path, options = {}) {
  try {
    return await raw(path, options);
  } catch (error) {
    const isExpired = error instanceof ApiError && error.status === 401;
    const isAuthRoute = path.startsWith('/api/v1/auth/');

    if (!isExpired || isAuthRoute || options._retried) throw error;

    await refreshSession();
    return raw(path, { ...options, _retried: true });
  }
}

/* ------------------------------------------------------------------ *
 * Endpoints
 * ------------------------------------------------------------------ */

export const auth = {
  register: (payload) => api('/api/v1/auth/register', { method: 'POST', body: payload }),
  login: (payload) => api('/api/v1/auth/login', { method: 'POST', body: payload }),
  logout: () => api('/api/v1/auth/logout', { method: 'POST' }),
  me: () => api('/api/v1/auth/me'),
  restore: refreshSession,
};

export const messages = {
  list: (params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
    return api(`/api/v1/messages?${query.toString()}`);
  },
  get: (id) => api(`/api/v1/messages/${id}`),
  send: (payload) => api('/api/v1/messages', { method: 'POST', body: payload }),
  patch: (id, payload) => api(`/api/v1/messages/${id}`, { method: 'PATCH', body: payload }),
  retry: (id) => api(`/api/v1/messages/${id}/retry`, { method: 'POST' }),
  remove: (id) => api(`/api/v1/messages/${id}`, { method: 'DELETE' }),
};

export const stats = {
  summary: (windowHours = 24) => api(`/api/v1/stats/summary?windowHours=${windowHours}`),
};

export const system = {
  readiness: () => fetch('/readyz').then((r) => r.json()),
};

/**
 * Subscribe to the live event stream.
 *
 * `EventSource` cannot set an Authorization header, so the token goes in the
 * query string — which the API accepts for this endpoint only.
 */
export function subscribeToEvents(onEvent) {
  if (!accessToken) return () => {};

  const source = new EventSource(
    `/api/v1/events/stream?access_token=${encodeURIComponent(accessToken)}`,
  );

  const forward = (event) => {
    try {
      onEvent(JSON.parse(event.data));
    } catch {
      // A malformed frame is not worth tearing the stream down for.
    }
  };

  for (const type of [
    'message.queued',
    'message.sending',
    'message.sent',
    'message.deferred',
    'message.failed',
    'message.received',
    'metrics.tick',
  ]) {
    source.addEventListener(type, forward);
  }

  return () => source.close();
}
