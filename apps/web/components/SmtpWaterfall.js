import React from 'react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';

/**
 * An SMTP transaction, laid out to scale.
 *
 * A table of durations makes the reader do the comparison. Drawn in proportion,
 * the answer to "what made this slow" is immediate — and the phases that
 * dominate are the only ones that take the signal colour, so the eye lands on
 * them before it reads a single number.
 */
const LABELS = {
  dns: 'DNS',
  tcp: 'TCP',
  tls: 'TLS',
  greeting: 'Banner',
  ehlo: 'EHLO',
  auth: 'AUTH',
  mailFrom: 'MAIL FROM',
  rcptTo: 'RCPT TO',
  data: 'DATA',
  quit: 'QUIT',
};

const HINTS = {
  dns: 'Resolving the recipient domain’s MX records',
  tcp: 'Opening the connection to the mail server',
  tls: 'STARTTLS upgrade and certificate handshake',
  greeting: 'Waiting for the server’s 220 greeting',
  ehlo: 'Capability negotiation',
  auth: 'Authenticating to the relay',
  mailFrom: 'Declaring the envelope sender',
  rcptTo: 'Declaring each envelope recipient',
  data: 'Transferring the message body',
  quit: 'Closing the session',
};

export default function SmtpWaterfall({ phases = [], totalMs = 0, dense = false }) {
  const measured = phases.filter((p) => p.durationMs > 0);

  if (measured.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        No transaction has been recorded for this message yet.
      </Typography>
    );
  }

  const sum = measured.reduce((acc, p) => acc + p.durationMs, 0) || 1;
  const peak = Math.max(...measured.map((p) => p.durationMs));
  // A phase worth noticing is one taking a fifth or more of the transaction.
  const significant = (ms) => ms / sum >= 0.2;

  return (
    <Box>
      <Stack spacing={0}>
        {measured.map((p) => {
          const label = LABELS[p.phase] ?? p.phase;
          const share = (p.durationMs / sum) * 100;
          const lead = significant(p.durationMs);

          return (
            <Tooltip
              key={p.phase}
              arrow
              placement="top"
              title={`${share.toFixed(1)}% of the transaction${HINTS[p.phase] ? ` · ${HINTS[p.phase]}` : ''}`}
            >
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: dense ? '72px 1fr 58px' : '88px 1fr 68px',
                  alignItems: 'center',
                  gap: 1.5,
                  py: dense ? 0.4 : 0.6,
                  cursor: 'default',
                  '&:hover .bar': { opacity: 0.78 },
                }}
              >
                <Typography
                  className="mono"
                  sx={{
                    fontFamily: 'var(--mono)',
                    fontSize: dense ? '0.6875rem' : '0.75rem',
                    color: lead ? 'text.primary' : 'text.secondary',
                    fontWeight: lead ? 600 : 400,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {label}
                </Typography>

                <Box sx={{ position: 'relative', height: dense ? 8 : 10, bgcolor: 'grey.100', borderRadius: 0.5 }}>
                  <Box
                    className="bar"
                    sx={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${Math.max((p.durationMs / peak) * 100, 1.5)}%`,
                      bgcolor: lead ? 'secondary.main' : 'grey.400',
                      borderRadius: 0.5,
                      transition: 'opacity 120ms ease',
                    }}
                  />
                </Box>

                <Typography
                  className="mono tnum"
                  sx={{
                    fontFamily: 'var(--mono)',
                    fontSize: dense ? '0.6875rem' : '0.75rem',
                    textAlign: 'right',
                    color: lead ? 'text.primary' : 'text.secondary',
                    fontWeight: lead ? 600 : 400,
                  }}
                >
                  {p.durationMs.toFixed(1)}
                </Typography>
              </Box>
            </Tooltip>
          );
        })}
      </Stack>

      <Stack
        direction="row"
        justifyContent="space-between"
        sx={{ mt: 1.5, pt: 1.25, borderTop: '1px solid', borderColor: 'divider' }}
      >
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Total transaction
        </Typography>
        <Typography
          className="mono tnum"
          sx={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', fontWeight: 600 }}
        >
          {totalMs.toFixed(1)} ms
        </Typography>
      </Stack>
    </Box>
  );
}
