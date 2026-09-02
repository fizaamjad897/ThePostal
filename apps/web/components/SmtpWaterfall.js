import React from 'react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';

/**
 * Renders an SMTP transaction as a proportional waterfall.
 *
 * A table of numbers makes you do the comparison yourself. Laid out to scale,
 * the answer to "what made this send slow" is immediate — a wide TLS band and a
 * wide DATA band mean completely different things, and the eye separates them
 * faster than it reads two figures.
 */
const PHASE_META = {
  dns: { label: 'DNS', color: '#8B5CF6', hint: 'Resolving the recipient domain’s MX records' },
  tcp: { label: 'TCP', color: '#6366F1', hint: 'Opening the connection to the mail server' },
  tls: { label: 'TLS', color: '#0EA5E9', hint: 'STARTTLS upgrade and certificate handshake' },
  greeting: { label: 'Banner', color: '#14B8A6', hint: 'Waiting for the server’s 220 greeting' },
  ehlo: { label: 'EHLO', color: '#22C55E', hint: 'Capability negotiation' },
  auth: { label: 'AUTH', color: '#84CC16', hint: 'Authenticating to the relay' },
  mailFrom: { label: 'MAIL', color: '#EAB308', hint: 'Declaring the envelope sender' },
  rcptTo: { label: 'RCPT', color: '#F97316', hint: 'Declaring each envelope recipient' },
  data: { label: 'DATA', color: '#EF4444', hint: 'Transferring the message body' },
  quit: { label: 'QUIT', color: '#94A3B8', hint: 'Closing the session' },
};

export default function SmtpWaterfall({ phases = [], totalMs = 0 }) {
  const measured = phases.filter((phase) => phase.durationMs > 0);

  if (measured.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: '#6B7280' }}>
        No transaction was recorded for this message.
      </Typography>
    );
  }

  // Bars are scaled against the summed phases rather than `totalMs`, so they
  // always fill the track. Total wall time includes gaps between phases, which
  // would otherwise leave a misleading empty tail.
  const scale = measured.reduce((sum, phase) => sum + phase.durationMs, 0) || 1;

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: 'flex',
          height: 28,
          borderRadius: 1.5,
          overflow: 'hidden',
          bgcolor: '#F1F5F9',
        }}
      >
        {measured.map((phase) => {
          const meta = PHASE_META[phase.phase] ?? { label: phase.phase, color: '#94A3B8', hint: '' };
          const share = (phase.durationMs / scale) * 100;

          return (
            <Tooltip
              key={phase.phase}
              arrow
              title={`${meta.label} — ${phase.durationMs.toFixed(1)} ms (${share.toFixed(1)}%)${
                meta.hint ? ` · ${meta.hint}` : ''
              }`}
            >
              <Box
                sx={{
                  width: `${share}%`,
                  bgcolor: meta.color,
                  transition: 'filter 0.2s ease',
                  '&:hover': { filter: 'brightness(1.15)' },
                  // A sub-percent phase would otherwise be invisible and
                  // un-hoverable, so every phase keeps a minimum hit area.
                  minWidth: 3,
                }}
              />
            </Tooltip>
          );
        })}
      </Box>

      <Stack direction="row" flexWrap="wrap" sx={{ gap: 1.5 }}>
        {measured.map((phase) => {
          const meta = PHASE_META[phase.phase] ?? { label: phase.phase, color: '#94A3B8' };
          return (
            <Stack key={phase.phase} direction="row" alignItems="center" spacing={0.75}>
              <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: meta.color }} />
              <Typography variant="caption" sx={{ color: '#475569' }}>
                {meta.label}{' '}
                <Box component="span" sx={{ fontWeight: 700, color: '#1E293B' }}>
                  {phase.durationMs.toFixed(1)} ms
                </Box>
              </Typography>
            </Stack>
          );
        })}
      </Stack>

      <Typography variant="caption" sx={{ color: '#64748B' }}>
        Total transaction time {totalMs.toFixed(1)} ms
      </Typography>
    </Stack>
  );
}
