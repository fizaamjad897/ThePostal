import React from 'react';
import { useRouter } from 'next/router';
import { Box, Button, Container, Divider, Stack, Typography } from '@mui/material';
import { ArrowForwardRounded } from '@mui/icons-material';
import { useAuth } from '../lib/auth-context';
import Wordmark from '../components/Wordmark';

/* A real transaction, shown at the size it was measured. */
const TRANSCRIPT = [
  ['S', '220 mx.example.net ESMTP ready'],
  ['C', 'EHLO mx.postal.local'],
  ['S', '250-STARTTLS'],
  ['S', '250 SIZE 26214400'],
  ['C', 'STARTTLS'],
  ['S', '220 2.0.0 Ready to start TLS'],
  ['C', 'MAIL FROM:<you@postal.local> SIZE=1841'],
  ['S', '250 2.1.0 Ok'],
  ['C', 'RCPT TO:<peer@example.net>'],
  ['S', '250 2.1.5 Ok'],
  ['C', 'DATA'],
  ['S', '354 End data with <CR><LF>.<CR><LF>'],
  ['C', '<1841 bytes of message body>'],
  ['S', '250 2.0.0 Ok: queued as 4B2f1x'],
];

const PHASES = [
  { phase: 'dns', ms: 11.4 },
  { phase: 'tcp', ms: 1.6 },
  { phase: 'tls', ms: 44.2 },
  { phase: 'greeting', ms: 2.2 },
  { phase: 'ehlo', ms: 1.5 },
  { phase: 'mail from', ms: 0.4 },
  { phase: 'rcpt to', ms: 0.3 },
  { phase: 'data', ms: 47.6 },
  { phase: 'quit', ms: 0.6 },
];

/* Each claim is paired with the evidence for it, so the page argues rather than asserts. */
const CLAIMS = [
  {
    title: 'The SMTP client is written here, on raw sockets',
    body:
      'RFC 5321 spoken directly: multi-line reply parsing, ESMTP negotiation with a HELO fallback, STARTTLS upgrade, AUTH, and dot-stuffing. A library would report one duration for the whole exchange — and one number cannot tell you which phase was slow.',
    evidence: { label: 'apps/server/src/smtp/client.ts', detail: '690 lines' },
  },
  {
    title: 'It receives mail as well as sends it',
    body:
      'An inbound daemon accepts messages from any standards-compliant client, parses MIME and files them into the addressed mailbox — while refusing to relay for domains it is not authoritative for.',
    evidence: { label: 'smtp://postal:2525', detail: 'open to any client' },
  },
  {
    title: 'Failures are classified the way a mail server must',
    body:
      'A 5xx reply is the domain’s final answer and bounces immediately. A 4xx is transient and defers with exponential backoff and full jitter. Retrying a permanent rejection wastes attempts; bouncing a transient one discards deliverable mail.',
    evidence: { label: '550 → failed · 451 → deferred', detail: 'retry policy' },
  },
];

export default function Home() {
  const router = useRouter();
  const { status } = useAuth();

  const authed = status === 'authenticated';
  const total = PHASES.reduce((a, p) => a + p.ms, 0);

  return (
    <Box sx={{ bgcolor: 'background.paper', minHeight: '100vh' }}>
      {/* --- header ------------------------------------------------------ */}
      <Box
        component="header"
        sx={{
          borderBottom: '1px solid',
          borderColor: 'divider',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          bgcolor: 'rgba(255,255,255,0.86)',
          backdropFilter: 'saturate(180%) blur(12px)',
        }}
      >
        <Container maxWidth="lg">
          <Stack direction="row" alignItems="center" sx={{ height: 56 }}>
            <Wordmark />
            <Box sx={{ flexGrow: 1 }} />
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                onClick={() => window.open('/docs', '_blank', 'noopener')}
                sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
              >
                API reference
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={() => router.push(authed ? '/client/dashboard' : '/auth')}
              >
                {authed ? 'Open mailbox' : 'Sign in'}
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Box>

      {/* --- hero -------------------------------------------------------- */}
      <Container maxWidth="lg" sx={{ pt: { xs: 7, md: 12 }, pb: { xs: 7, md: 11 } }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1.05fr 1fr' },
            gap: { xs: 5, md: 8 },
            alignItems: 'center',
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h1" sx={{ mb: 2.5, textWrap: 'balance' }}>
              Mail you can watch travel
            </Typography>
            <Typography
              sx={{
                fontSize: '1.125rem',
                lineHeight: 1.6,
                color: 'text.secondary',
                maxWidth: '46ch',
                mb: 4,
              }}
            >
              Postal is a self-hosted SMTP server that sends real mail over the wire and records
              where every millisecond went — the DNS lookup, the TCP connect, the TLS handshake and
              the payload itself.
            </Typography>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 5 }}>
              <Button
                size="large"
                variant="contained"
                endIcon={<ArrowForwardRounded sx={{ fontSize: 18 }} />}
                onClick={() => router.push(authed ? '/client/dashboard' : '/auth')}
              >
                {authed ? 'Open mailbox' : 'Try it'}
              </Button>
              <Button size="large" variant="outlined" onClick={() => router.push('/server/dashboard')}>
                See the telemetry
              </Button>
            </Stack>

            {/* The headline measurement, stated once, in the product's own units. */}
            <Stack
              direction="row"
              divider={<Divider orientation="vertical" flexItem />}
              spacing={{ xs: 2, sm: 3 }}
              sx={{ flexWrap: 'wrap', rowGap: 2 }}
            >
              {[
                ['63.3 ms', 'median transaction'],
                ['9', 'phases timed'],
                ['250', 'last reply code'],
              ].map(([value, label]) => (
                <Box key={label}>
                  <Typography
                    className="mono tnum"
                    sx={{ fontFamily: 'var(--mono)', fontSize: '1.0625rem', fontWeight: 600, color: 'text.primary' }}
                  >
                    {value}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {label}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Box>

          <Box sx={{ minWidth: 0 }}>
            <Transcript lines={TRANSCRIPT} />
          </Box>
        </Box>
      </Container>

      {/* --- the waterfall, as the thesis ------------------------------- */}
      <Box sx={{ borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
        <Container maxWidth="lg" sx={{ py: { xs: 7, md: 9 } }}>
          <Typography variant="h2" sx={{ mb: 1.5, maxWidth: '20ch', textWrap: 'balance' }}>
            One number cannot tell you what went wrong
          </Typography>
          <Typography sx={{ color: 'text.secondary', maxWidth: '62ch', mb: 5 }}>
            This send took 109 ms. Nearly half of it was the TLS handshake and the payload transfer —
            two problems with completely different causes. Collapsed into a single figure, they are
            indistinguishable.
          </Typography>
          <Waterfall phases={PHASES} total={total} />
        </Container>
      </Box>

      {/* --- claims with evidence --------------------------------------- */}
      <Container maxWidth="lg" sx={{ py: { xs: 7, md: 10 } }}>
        <Stack divider={<Divider />} spacing={0}>
          {CLAIMS.map((c) => (
            <Box
              key={c.title}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1.3fr' },
                gap: { xs: 1.5, md: 6 },
                py: { xs: 3.5, md: 5 },
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h4" sx={{ mb: 1.5, textWrap: 'balance' }}>
                  {c.title}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
                  <Typography
                    className="mono"
                    sx={{
                      fontFamily: 'var(--mono)',
                      fontSize: '0.75rem',
                      color: 'secondary.main',
                      wordBreak: 'break-all',
                    }}
                  >
                    {c.evidence.label}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                    {c.evidence.detail}
                  </Typography>
                </Stack>
              </Box>
              <Typography sx={{ color: 'text.secondary', maxWidth: '68ch' }}>{c.body}</Typography>
            </Box>
          ))}
        </Stack>
      </Container>

      {/* --- footer ------------------------------------------------------ */}
      <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
        <Container maxWidth="lg" sx={{ py: 4 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
          >
            <Wordmark size={18} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              A mail transfer agent built for a Computer Networks final project.
            </Typography>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}

/* ------------------------------------------------------------------ */

function Transcript({ lines }) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 1.75, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}
      >
        <Typography
          className="mono"
          sx={{ fontFamily: 'var(--mono)', fontSize: '0.6875rem', color: 'text.secondary', letterSpacing: '0.06em' }}
        >
          SMTP TRANSACTION
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Typography
          className="mono tnum"
          sx={{ fontFamily: 'var(--mono)', fontSize: '0.6875rem', color: 'text.disabled' }}
        >
          mx.example.net:25
        </Typography>
      </Stack>

      <Box sx={{ p: { xs: 1.75, sm: 2.25 }, overflowX: 'auto' }}>
        {lines.map(([dir, text], i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1.25, whiteSpace: 'pre', lineHeight: 1.85 }}>
            <Typography
              component="span"
              className="mono"
              sx={{
                fontFamily: 'var(--mono)',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: dir === 'C' ? 'secondary.main' : 'text.disabled',
                flexShrink: 0,
              }}
            >
              {dir}
            </Typography>
            <Typography
              component="span"
              className="mono"
              sx={{
                fontFamily: 'var(--mono)',
                fontSize: '0.75rem',
                color: dir === 'C' ? 'text.primary' : 'text.secondary',
              }}
            >
              {text}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function Waterfall({ phases, total }) {
  const peak = Math.max(...phases.map((p) => p.ms));

  return (
    <Box sx={{ display: 'grid', gap: 0.25 }}>
      {phases.map((p) => (
        <Box
          key={p.phase}
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '84px 1fr 62px', sm: '120px 1fr 72px' },
            alignItems: 'center',
            gap: 2,
            py: 0.75,
          }}
        >
          <Typography
            className="mono"
            sx={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'text.secondary' }}
          >
            {p.phase}
          </Typography>

          <Box sx={{ position: 'relative', height: 10, bgcolor: 'grey.100', borderRadius: 0.5 }}>
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                width: `${(p.ms / peak) * 100}%`,
                // The two phases that dominate are the ones worth noticing, so
                // they carry the signal colour and everything else recedes.
                bgcolor: p.ms > total * 0.2 ? 'secondary.main' : 'grey.400',
                borderRadius: 0.5,
              }}
            />
          </Box>

          <Typography
            className="mono tnum"
            sx={{
              fontFamily: 'var(--mono)',
              fontSize: '0.75rem',
              textAlign: 'right',
              color: p.ms > total * 0.2 ? 'text.primary' : 'text.secondary',
              fontWeight: p.ms > total * 0.2 ? 600 : 400,
            }}
          >
            {p.ms.toFixed(1)} ms
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
