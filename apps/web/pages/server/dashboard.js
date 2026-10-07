import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Grid,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Speed,
  CheckCircle,
  Inventory2,
  Warning,
  Bolt,
  Storage as StorageIcon,
  Dns,
  Memory,
} from '@mui/icons-material';
import { stats as statsApi, system, subscribeToEvents } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth-context';
import TopBar from '../../components/TopBar';
import SmtpWaterfall from '../../components/SmtpWaterfall';

const WINDOWS = [
  { value: 1, label: 'Last hour' },
  { value: 24, label: 'Last 24 hours' },
  { value: 168, label: 'Last 7 days' },
  { value: 720, label: 'Last 30 days' },
];

export default function ServerDashboard() {
  const { isReady } = useRequireAuth();

  const [windowHours, setWindowHours] = useState(24);
  const [summary, setSummary] = useState(null);
  const [health, setHealth] = useState(null);
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!isReady) return;
    try {
      const [nextSummary, nextHealth] = await Promise.all([
        statsApi.summary(windowHours),
        system.readiness().catch(() => null),
      ]);
      setSummary(nextSummary);
      setHealth(nextHealth);
      setError(null);
    } catch (caught) {
      setError(caught.message ?? 'Could not load telemetry');
    }
  }, [isReady, windowHours]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The event stream drives both the activity feed and a refresh of the
   * aggregates. Queue-depth ticks update the header in place without a refetch;
   * anything else changed a message, so the summary is re-read.
   */
  useEffect(() => {
    if (!isReady) return undefined;

    return subscribeToEvents((event) => {
      if (event.type === 'metrics.tick') {
        setHealth((current) => (current ? { ...current, queue: event.payload.queue } : current));
        return;
      }

      // Bounded so a long-lived tab cannot grow the list without limit.
      setFeed((current) => [{ ...event, key: `${event.at}-${Math.random()}` }, ...current].slice(0, 25));
      void load();
    });
  }, [isReady, load]);

  if (!isReady || (!summary && !error)) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  const totals = summary?.totals ?? {};
  const deliveryRate = summary ? Math.round(summary.deliveryRate * 1000) / 10 : 0;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <TopBar />

      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={2}
          sx={{ mb: 4 }}
        >
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700, color: 'text.primary' }}>
              Delivery telemetry
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Measured from your own SMTP transactions — not simulated.
            </Typography>
          </Box>

          <TextField
            select
            size="small"
            value={windowHours}
            onChange={(event) => setWindowHours(Number(event.target.value))}
            sx={{ minWidth: 180, bgcolor: '#fff' }}
          >
            {WINDOWS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <Grid container spacing={2.5} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} lg={3}>
            <MetricCard
              Icon={CheckCircle}
              label="Delivery rate"
              value={`${deliveryRate}%`}
              caption={`${totals.sent ?? 0} delivered · ${totals.failed ?? 0} failed`}
              progress={deliveryRate}
            />
          </Grid>
          <Grid item xs={12} sm={6} lg={3}>
            <MetricCard
              Icon={Speed}
              label="Median transaction"
              value={summary?.latency.p50Ms != null ? `${summary.latency.p50Ms} ms` : '—'}
              caption={
                summary?.latency.p95Ms != null
                  ? `p95 ${summary.latency.p95Ms} ms · p99 ${summary.latency.p99Ms ?? '—'} ms`
                  : 'No completed transactions yet'
              }
            />
          </Grid>
          <Grid item xs={12} sm={6} lg={3}>
            <MetricCard
              Icon={Inventory2}
              label="In flight"
              value={String((totals.queued ?? 0) + (totals.deferred ?? 0))}
              caption={`${totals.queued ?? 0} queued · ${totals.deferred ?? 0} awaiting retry`}
            />
          </Grid>
          <Grid item xs={12} sm={6} lg={3}>
            <MetricCard
              Icon={Bolt}
              label="Received"
              value={String(totals.received ?? 0)}
              caption="Inbound over the SMTP listener"
            />
          </Grid>
        </Grid>

        <Grid container spacing={3}>
          <Grid item xs={12} lg={7}>
            <Card sx={{ borderRadius: 3, height: '100%' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                  Where the time goes
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
                  Mean duration of each SMTP phase across every delivered message in this window.
                </Typography>

                <SmtpWaterfall
                  phases={Object.entries(summary?.phaseBreakdownMs ?? {}).map(([phase, durationMs]) => ({
                    phase,
                    durationMs,
                  }))}
                  totalMs={Object.values(summary?.phaseBreakdownMs ?? {}).reduce((a, b) => a + b, 0)}
                />

                <Divider sx={{ my: 3 }} />

                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
                  Volume over time
                </Typography>
                <ThroughputChart series={summary?.throughput ?? []} />
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} lg={5}>
            <Stack spacing={3}>
              <Card sx={{ borderRadius: 3 }}>
                <CardContent sx={{ p: 3 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                    Server health
                  </Typography>

                  {health ? (
                    <Stack spacing={1.5}>
                      <HealthRow Icon={StorageIcon} label="MongoDB" state={health.components.mongo} />
                      <HealthRow Icon={Inventory2} label="Delivery queue" state={health.components.queue} />
                      <HealthRow Icon={Dns} label="SMTP ingress" state={health.components.smtpIngress} />
                      <Divider />
                      <Stack direction="row" flexWrap="wrap" sx={{ gap: 1 }}>
                        <Chip size="small" label={`waiting ${health.queue.waiting}`} />
                        <Chip size="small" label={`active ${health.queue.active}`} />
                        <Chip size="small" label={`delayed ${health.queue.delayed}`} />
                        <Chip
                          size="small"
                          color={health.queue.failed > 0 ? 'error' : 'default'}
                          label={`failed ${health.queue.failed}`}
                        />
                      </Stack>
                      <Divider />
                      <Stack direction="row" alignItems="center" spacing={1.5}>
                        <Memory sx={{ fontSize: 18, color: 'text.disabled' }} />
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {health.process.rssMb} MB RSS · event loop lag{' '}
                          {health.process.eventLoopDelayMs} ms · up{' '}
                          {formatUptime(health.uptimeSeconds)}
                        </Typography>
                      </Stack>
                    </Stack>
                  ) : (
                    <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                      Health endpoint unreachable.
                    </Typography>
                  )}
                </CardContent>
              </Card>

              <Card sx={{ borderRadius: 3 }}>
                <CardContent sx={{ p: 3 }}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: 'success.main',
                        animation: 'pulse 2s ease-in-out infinite',
                        '@keyframes pulse': {
                          '0%, 100%': { opacity: 1 },
                          '50%': { opacity: 0.3 },
                        },
                      }}
                    />
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      Live activity
                    </Typography>
                  </Stack>

                  {feed.length === 0 ? (
                    <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                      Connected. Events appear here as messages move through the queue.
                    </Typography>
                  ) : (
                    <Stack spacing={1} sx={{ maxHeight: 320, overflowY: 'auto' }}>
                      {feed.map((event) => (
                        <Stack key={event.key} direction="row" spacing={1.5} alignItems="baseline">
                          <Typography
                            variant="caption"
                            sx={{ color: 'text.disabled', fontFamily: 'monospace', flexShrink: 0 }}
                          >
                            {new Date(event.at).toLocaleTimeString()}
                          </Typography>
                          <Typography variant="body2" sx={{ color: 'text.primary' }}>
                            {describeEvent(event)}
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            </Stack>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

function MetricCard({ Icon, label, value, caption, progress }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2.25 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.75 }}>
          <Icon sx={{ fontSize: 15, color: 'text.disabled' }} />
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 550 }}>
            {label}
          </Typography>
        </Stack>

        <Typography
          className="mono tnum"
          sx={{
            fontFamily: 'var(--mono)',
            fontSize: '1.75rem',
            fontWeight: 600,
            letterSpacing: '-0.03em',
            lineHeight: 1,
            mb: 0.75,
          }}
        >
          {value}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
          {caption}
        </Typography>

        {progress != null && (
          <LinearProgress
            variant="determinate"
            value={Math.min(100, Math.max(0, progress))}
            sx={{ mt: 1.75, height: 4, '& .MuiLinearProgress-bar': { bgcolor: 'primary.main' } }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function HealthRow({ Icon, label, state }) {
  const up = state === 'up';
  return (
    <Stack direction="row" alignItems="center" spacing={1.5}>
      <Icon sx={{ fontSize: 18, color: 'text.disabled' }} />
      <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
        {label}
      </Typography>
      <Chip
        size="small"
        color={up ? 'success' : 'error'}
        variant="outlined"
        icon={up ? <CheckCircle sx={{ fontSize: 14 }} /> : <Warning sx={{ fontSize: 14 }} />}
        label={up ? 'up' : 'down'}
      />
    </Stack>
  );
}

/**
 * A compact bar chart drawn with layout boxes rather than a charting library.
 * The series is at most a few dozen points and needs no axes, interaction or
 * scales — pulling in a chart dependency for it would cost far more bytes than
 * the feature is worth.
 */
function ThroughputChart({ series }) {
  if (series.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'text.disabled' }}>
        No messages in this window yet.
      </Typography>
    );
  }

  const peak = Math.max(...series.map((point) => point.sent + point.failed), 1);

  return (
    <Stack direction="row" alignItems="flex-end" spacing={0.5} sx={{ height: 120 }}>
      {series.map((point) => {
        const total = point.sent + point.failed;
        return (
          <Tooltip
            key={point.bucket}
            arrow
            title={`${new Date(point.bucket).toLocaleString()} — ${point.sent} delivered, ${point.failed} failed`}
          >
            <Stack
              justifyContent="flex-end"
              sx={{ flex: 1, height: '100%', minWidth: 6, cursor: 'default' }}
            >
              <Box
                sx={{
                  height: `${(point.failed / peak) * 100}%`,
                  bgcolor: 'error.main',
                  borderRadius: '2px 2px 0 0',
                }}
              />
              <Box
                sx={{
                  height: `${(point.sent / peak) * 100}%`,
                  bgcolor: 'success.main',
                  borderRadius: total === point.sent ? '2px 2px 0 0' : 0,
                }}
              />
            </Stack>
          </Tooltip>
        );
      })}
    </Stack>
  );
}

function describeEvent(event) {
  const subject = event.payload?.subject ? ` “${event.payload.subject}”` : '';

  switch (event.type) {
    case 'message.queued':
      return `Queued${subject}`;
    case 'message.sending':
      return `Opening SMTP session (attempt ${event.payload?.attempt ?? 1})`;
    case 'message.sent':
      return `Delivered in ${event.payload?.trace?.totalMs?.toFixed(0) ?? '?'} ms via ${
        event.payload?.trace?.remoteHost ?? 'relay'
      }`;
    case 'message.deferred':
      return `Deferred — ${event.payload?.error ?? 'transient failure'}`;
    case 'message.failed':
      return `Failed — ${event.payload?.error ?? 'permanent rejection'}`;
    case 'message.received':
      return `Received from ${event.payload?.from ?? 'unknown'}${subject}`;
    default:
      return event.type;
  }
}

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
