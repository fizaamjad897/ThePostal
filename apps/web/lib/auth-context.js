import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { auth, setAccessToken } from './api';

const AuthContext = createContext(null);

/**
 * Holds the signed-in account and keeps the access token alive.
 *
 * `status` distinguishes "we have not checked yet" from "checked, not signed
 * in". Without that distinction every guarded page flashes its sign-in redirect
 * on first paint before the session is restored.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

  // On a cold load the access token is gone but the refresh cookie may not be,
  // so the session is restored by asking for a new token rather than by reading
  // one back out of storage.
  useEffect(() => {
    let cancelled = false;

    auth
      .restore()
      .then((session) => {
        if (cancelled) return;
        setUser(session.user);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setStatus('anonymous');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Refresh the access token shortly before it expires.
   *
   * Without this a tab left open goes stale and the next action pays a failed
   * request plus a refresh. Renewing at 80% of the lifetime keeps a comfortable
   * margin for clock skew and a slow network.
   */
  useEffect(() => {
    if (status !== 'authenticated') return undefined;

    const interval = setInterval(
      () => {
        auth.restore().catch(() => {
          setUser(null);
          setStatus('anonymous');
        });
      },
      // The server's default access token lifetime is 15 minutes.
      0.8 * 15 * 60 * 1000,
    );

    return () => clearInterval(interval);
  }, [status]);

  const signIn = useCallback(async (credentials) => {
    const session = await auth.login(credentials);
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');
    return session.user;
  }, []);

  const signUp = useCallback(async (credentials) => {
    const session = await auth.register(credentials);
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');
    return session.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      // Clear local state even if the request failed — the user asked to be
      // signed out, and leaving them apparently signed in is worse than a
      // server-side session that expires on its own.
      setAccessToken(null);
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(
    () => ({ user, status, signIn, signUp, signOut }),
    [user, status, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

/** Redirect to the sign-in page unless a session is present. */
export function useRequireAuth() {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') {
      void router.replace(`/auth?next=${encodeURIComponent(router.asPath)}`);
    }
  }, [status, router]);

  return { user, isReady: status === 'authenticated' };
}
