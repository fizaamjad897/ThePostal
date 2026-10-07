import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Link as MuiLink,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { LockRounded } from '@mui/icons-material';
import { useAuth } from '../lib/auth-context';
import { ApiError } from '../lib/api';
import Wordmark from '../components/Wordmark';

/**
 * Mirrors the server's password policy so the user is told what is wrong before
 * a round trip. The server re-validates regardless — this is a courtesy, not a
 * control.
 */
const PASSWORD_RULES = [
  { test: (v) => v.length >= 12, label: 'At least 12 characters' },
  { test: (v) => /[a-z]/.test(v), label: 'A lowercase letter' },
  { test: (v) => /[A-Z]/.test(v), label: 'An uppercase letter' },
  { test: (v) => /\d/.test(v), label: 'A digit' },
];

export default function AuthPage() {
  const router = useRouter();
  const { signIn, signUp, status } = useAuth();

  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const isSignUp = mode === 'signup';
  const destination = typeof router.query.next === 'string' ? router.query.next : '/client/dashboard';

  // Someone who is already signed in has no business on this page.
  useEffect(() => {
    if (status === 'authenticated') void router.replace(destination);
  }, [status, router, destination]);

  const unmetRules = PASSWORD_RULES.filter((rule) => !rule.test(form.password));
  const canSubmit =
    form.email.includes('@') && form.password.length > 0 && (!isSignUp || unmetRules.length === 0);

  const handleChange = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const payload = { email: form.email.trim(), password: form.password };
      if (isSignUp && form.displayName.trim()) payload.displayName = form.displayName.trim();

      await (isSignUp ? signUp(payload) : signIn(payload));
      await router.replace(destination);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not reach the server. Is the API running?',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        p: 2,
        bgcolor: 'background.default',
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 460, borderRadius: 4 }}>
        <CardContent sx={{ p: { xs: 3, sm: 5 } }}>
          <Stack spacing={1} alignItems="center" sx={{ mb: 4 }}>
            <Wordmark size={26} showText={false} />
            <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary' }}>
              {isSignUp ? 'Create your mailbox' : 'Welcome back'}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>
              {isSignUp
                ? 'Your address becomes a real mailbox on this server.'
                : 'Sign in to send mail and inspect delivery telemetry.'}
            </Typography>
          </Stack>

          {error && (
            <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <Stack spacing={2.5}>
              {isSignUp && (
                <TextField
                  fullWidth
                  label="Display name"
                  placeholder="Optional"
                  value={form.displayName}
                  onChange={handleChange('displayName')}
                  autoComplete="name"
                />
              )}

              <TextField
                fullWidth
                required
                type="email"
                label="Email address"
                value={form.email}
                onChange={handleChange('email')}
                autoComplete="email"
                autoFocus
              />

              <TextField
                fullWidth
                required
                type="password"
                label="Password"
                value={form.password}
                onChange={handleChange('password')}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
              />

              {isSignUp && form.password.length > 0 && unmetRules.length > 0 && (
                <Box sx={{ pl: 0.5 }}>
                  {unmetRules.map((rule) => (
                    <Typography key={rule.label} variant="caption" sx={{ display: 'block', color: 'error.main' }}>
                      • {rule.label}
                    </Typography>
                  ))}
                </Box>
              )}

              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                disabled={!canSubmit || submitting}
                startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : <LockRounded sx={{ fontSize: 17 }} />}
              >
                {submitting ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
              </Button>
            </Stack>
          </form>

          <Divider sx={{ my: 3 }} />

          <Typography variant="body2" sx={{ textAlign: 'center', color: 'text.secondary' }}>
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <MuiLink
              component="button"
              type="button"
              onClick={() => {
                setMode(isSignUp ? 'signin' : 'signup');
                setError(null);
              }}
              sx={{ fontWeight: 600 }}
            >
              {isSignUp ? 'Sign in' : 'Create one'}
            </MuiLink>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
