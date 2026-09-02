import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  ArrowBack,
  Replay as ReplayIcon,
  Lock as LockIcon,
  Dns as DnsIcon,
  Straighten,
} from '@mui/icons-material';
import { messages as messagesApi, subscribeToEvents } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth-context';
import TopBar from '../../components/TopBar';
import StatusChip from '../../components/StatusChip';
import SmtpWaterfall from '../../components/SmtpWaterfall';

export default function MessageDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { isReady } = useRequireAuth();

  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isReady || typeof id !== 'string') return;
    try {
      const result = await messagesApi.get(id);
      setMessage(result);
      setError(null);

      // Opening a message is what marks it read; doing it here rather than in
      // the list means a glance at the inbox does not clear the badge.
      if (!result.read) await messagesApi.patch(id, { read: true });
    } catch (caught) {
      setError(caught.message ?? 'Could not load the message');
    }
  }, [id, isReady]);

  useEffect(() => {
    void load();
  }, [load]);

  // A queued message settles asynchronously, so the page follows it live.
  useEffect(() => {
    if (!isReady || !message) return undefined;
    if (message.status === 'sent' || message.status === 'failed') return undefined;

    return subscribeToEvents((event) => {
      if (event.type === 'metrics.tick') return;
      if (event.payload?.id === message.id) void load();
    });
  }, [isReady, message, load]);

  const retry = async () => {
    setBusy(true);
    try {
      setMessage(await messagesApi.retry(message.id));
    } catch (caught) {
      setError(caught.message ?? 'Could not re-queue the message');
    } finally {
      setBusy(false);
    }
  };

  if (!isReady || (!message && !error)) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  // Attempts are recorded newest-last; the most recent one carries the trace
  // that matters.
  const lastAttempt = message?.attempts?.[message.attempts.length - 1] ?? null;
  const trace = lastAttempt?.trace ?? null;
  const canRetry = message && (message.status === 'failed' || message.status === 'deferred');

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#F8FAFC' }}>
      <TopBar />

      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Button startIcon={<ArrowBack />} onClick={() => router.back()} sx={{ mb: 2 }}>
          Back
        </Button>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {message && (
          <Grid container spacing={3}>
            <Grid item xs={12} md={7}>
              <Card sx={{ borderRadius: 3, height: '100%' }}>
                <CardContent sx={{ p: { xs: 2.5, sm: 4 } }}>
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
                    <Typography variant="h5" sx={{ fontWeight: 700, color: '#0F172A' }}>
                      {message.subject}
                    </Typography>
                    <StatusChip status={message.status} size="medium" />
                  </Stack>

                  <Stack spacing={0.5} sx={{ mt: 2, mb: 3 }}>
                    <AddressLine label="From" value={message.from} />
                    <AddressLine label="To" value={message.to.join(', ')} />
                    {message.cc.length > 0 && <AddressLine label="Cc" value={message.cc.join(', ')} />}
                    {message.bcc.length > 0 && <AddressLine label="Bcc" value={message.bcc.join(', ')} />}
                    <AddressLine label="Date" value={new Date(message.createdAt).toLocaleString()} />
                    <AddressLine label="Message-ID" value={message.messageId} mono />
                  </Stack>

                  <Divider sx={{ mb: 3 }} />

                  {message.html ? (
                    // Rendered as source rather than injected: displaying
                    // attacker-authored HTML is exactly how a mail client gets
                    // itself compromised.
                    <Paper
                      variant="outlined"
                      sx={{ p: 2, bgcolor: '#0F172A', overflowX: 'auto', borderRadius: 2 }}
                    >
                      <Typography
                        component="pre"
                        sx={{ m: 0, color: '#E2E8F0', fontFamily: 'monospace', fontSize: 13 }}
                      >
                        {message.body}
                      </Typography>
                    </Paper>
                  ) : (
                    <Typography
                      component="pre"
                      sx={{
                        m: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontFamily: 'inherit',
                        color: '#334155',
                        lineHeight: 1.7,
                      }}
                    >
                      {message.body}
                    </Typography>
                  )}

                  {message.attachments.length > 0 && (
                    <Stack direction="row" flexWrap="wrap" sx={{ gap: 1, mt: 3 }}>
                      {message.attachments.map((file) => (
                        <Chip
                          key={file.filename}
                          label={`${file.filename} · ${formatBytes(file.sizeBytes)}`}
                          variant="outlined"
                        />
                      ))}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={5}>
              <Stack spacing={3}>
                <Card sx={{ borderRadius: 3 }}>
                  <CardContent sx={{ p: 3 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                      SMTP transaction
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
                      Time spent in each phase of the delivery conversation.
                    </Typography>

                    <SmtpWaterfall phases={trace?.phases ?? []} totalMs={trace?.totalMs ?? 0} />

                    {trace && (
                      <Stack spacing={1.5} sx={{ mt: 3 }}>
                        <Divider />
                        <Fact
                          Icon={DnsIcon}
                          label="Peer"
                          value={`${trace.remoteHost ?? '—'}${
                            trace.remoteAddress ? ` (${trace.remoteAddress}:${trace.remotePort})` : ''
                          }`}
                        />
                        <Fact
                          Icon={LockIcon}
                          label="Transport"
                          value={
                            trace.tlsProtocol
                              ? `${trace.tlsProtocol} · ${trace.tlsCipher}`
                              : 'Cleartext (no STARTTLS)'
                          }
                        />
                        <Fact
                          Icon={Straighten}
                          label="Payload"
                          value={`${formatBytes(trace.messageBytes)}${
                            trace.throughputKbps ? ` at ${trace.throughputKbps.toFixed(0)} kbps` : ''
                          }`}
                        />
                      </Stack>
                    )}
                  </CardContent>
                </Card>

                {message.attempts.length > 0 && (
                  <Card sx={{ borderRadius: 3 }}>
                    <CardContent sx={{ p: 3 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                          Delivery attempts
                        </Typography>
                        {canRetry && (
                          <Button
                            size="small"
                            startIcon={<ReplayIcon />}
                            onClick={retry}
                            disabled={busy}
                          >
                            Retry now
                          </Button>
                        )}
                      </Stack>

                      <Stack spacing={2}>
                        {[...message.attempts].reverse().map((attempt) => (
                          <Box key={attempt.attempt}>
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                Attempt {attempt.attempt}
                              </Typography>
                              <StatusChip status={attempt.status} />
                            </Stack>
                            <Typography variant="caption" sx={{ display: 'block', color: '#64748B' }}>
                              {new Date(attempt.startedAt).toLocaleString()}
                            </Typography>
                            {attempt.responseCode && (
                              <Typography
                                variant="body2"
                                sx={{ fontFamily: 'monospace', fontSize: 12, color: '#334155', mt: 0.5 }}
                              >
                                {attempt.responseCode} {attempt.responseText}
                              </Typography>
                            )}
                            {attempt.error && (
                              <Typography variant="body2" sx={{ color: '#B91C1C', mt: 0.5 }}>
                                {attempt.error}
                              </Typography>
                            )}
                          </Box>
                        ))}
                      </Stack>

                      {message.nextRetryAt && (
                        <Alert severity="info" sx={{ mt: 2 }}>
                          Next attempt scheduled for {new Date(message.nextRetryAt).toLocaleTimeString()}.
                        </Alert>
                      )}
                    </CardContent>
                  </Card>
                )}

                {trace?.client && (
                  <Card sx={{ borderRadius: 3 }}>
                    <CardContent sx={{ p: 3 }}>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                        Client-side path
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#64748B', mb: 2 }}>
                        The browser&rsquo;s link to this server &mdash; the other half of the journey.
                      </Typography>
                      <Stack spacing={1}>
                        <Fact label="DNS" value={formatMs(trace.client.dnsMs)} />
                        <Fact label="TCP" value={formatMs(trace.client.tcpMs)} />
                        <Fact label="TLS" value={formatMs(trace.client.tlsMs)} />
                        <Fact label="TTFB" value={formatMs(trace.client.ttfbMs)} />
                        <Fact label="Link" value={trace.client.connectionType ?? '—'} />
                        <Fact
                          label="Estimated RTT"
                          value={trace.client.rttMs != null ? `${trace.client.rttMs} ms` : '—'}
                        />
                      </Stack>
                    </CardContent>
                  </Card>
                )}
              </Stack>
            </Grid>
          </Grid>
        )}
      </Container>
    </Box>
  );
}

function AddressLine({ label, value, mono = false }) {
  return (
    <Stack direction="row" spacing={1}>
      <Typography variant="body2" sx={{ color: '#94A3B8', minWidth: 90, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: '#334155',
          wordBreak: 'break-word',
          ...(mono ? { fontFamily: 'monospace', fontSize: 12 } : {}),
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function Fact({ Icon, label, value }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.5}>
      {Icon && <Icon sx={{ fontSize: 18, color: '#94A3B8' }} />}
      <Typography variant="body2" sx={{ color: '#94A3B8', minWidth: 96 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ color: '#334155', fontWeight: 500, wordBreak: 'break-word' }}>
        {value}
      </Typography>
    </Stack>
  );
}

function formatMs(value) {
  return value == null ? '—' : `${value.toFixed(1)} ms`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
