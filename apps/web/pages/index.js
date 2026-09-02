import React from 'react';
import { useRouter } from 'next/router';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import {
  ArrowForward,
  Dns,
  Insights,
  Lock,
  Speed,
  SwapHoriz,
  Terminal,
} from '@mui/icons-material';
import { useAuth } from '../lib/auth-context';

const FEATURES = [
  {
    Icon: Terminal,
    title: 'A real SMTP client',
    body: 'RFC 5321 spoken directly over sockets — EHLO capability negotiation, STARTTLS upgrade, AUTH, envelope and DATA — not a library call.',
    gradient: 'linear-gradient(45deg, #5B21B6, #7C3AED)',
  },
  {
    Icon: Dns,
    title: 'A real SMTP server',
    body: 'An inbound listener that accepts mail from any standards-compliant client and files it into the addressed mailbox.',
    gradient: 'linear-gradient(45deg, #0EA5E9, #38BDF8)',
  },
  {
    Icon: Speed,
    title: 'Per-phase telemetry',
    body: 'Every transaction is timed phase by phase, so a slow send is attributable to DNS, the handshake or the payload — never just “slow”.',
    gradient: 'linear-gradient(45deg, #F59E0B, #FCD34D)',
  },
  {
    Icon: SwapHoriz,
    title: 'MTA retry semantics',
    body: 'A durable queue that reads reply codes the way a mail server must: 4xx defers with exponential backoff and jitter, 5xx bounces immediately.',
    gradient: 'linear-gradient(45deg, #10B981, #34D399)',
  },
  {
    Icon: Lock,
    title: 'Session security',
    body: 'Argon2id password hashing, short-lived access tokens, and refresh-token rotation with reuse detection that revokes a stolen session family.',
    gradient: 'linear-gradient(45deg, #DB2777, #F472B6)',
  },
  {
    Icon: Insights,
    title: 'Operable by design',
    body: 'Prometheus metrics, liveness and readiness probes, structured logs and a live event stream — the things you need when it misbehaves.',
    gradient: 'linear-gradient(45deg, #4F46E5, #818CF8)',
  },
];

export default function Home() {
  const router = useRouter();
  const { status } = useAuth();

  const primaryHref = status === 'authenticated' ? '/client/dashboard' : '/auth';
  const primaryLabel = status === 'authenticated' ? 'Open mailbox' : 'Get started';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#FFFFFF', position: 'relative', overflow: 'hidden' }}>
      <BackgroundDecoration />

      <Container maxWidth="lg" sx={{ position: 'relative', py: { xs: 6, md: 10 } }}>
        <Grid container spacing={6} alignItems="center" sx={{ mb: { xs: 8, md: 14 } }}>
          <Grid item xs={12} md={7}>
            <Chip
              label="Computer Networks · Mail Transfer Agent"
              sx={{ mb: 3, fontWeight: 600, bgcolor: '#EDE9FE', color: '#5B21B6' }}
            />
            <Typography
              variant="h1"
              sx={{ fontWeight: 800, letterSpacing: '-0.03em', mb: 2, color: '#0F172A' }}
            >
              Mail you can watch travel
            </Typography>
            <Typography variant="h6" sx={{ mb: 4, color: '#475569', fontWeight: 400, maxWidth: 560 }}>
              Postal is a self-hosted SMTP server that sends real mail over the wire and shows you
              exactly where every millisecond went — DNS lookup, TCP connect, TLS handshake, and the
              payload itself.
            </Typography>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Button
                variant="contained"
                size="large"
                endIcon={<ArrowForward />}
                onClick={() => router.push(primaryHref)}
              >
                {primaryLabel}
              </Button>
              <Button
                variant="outlined"
                size="large"
                onClick={() => window.open('/docs', '_blank', 'noopener')}
              >
                API reference
              </Button>
            </Stack>
          </Grid>

          <Grid item xs={12} md={5}>
            <TranscriptPreview />
          </Grid>
        </Grid>

        <Typography variant="h3" sx={{ mb: 1, fontWeight: 700, color: '#0F172A', textAlign: 'center' }}>
          What it actually does
        </Typography>
        <Typography variant="body1" sx={{ mb: 6, color: '#64748B', textAlign: 'center' }}>
          No mock data, no simulated latency — every number comes from a transaction that happened.
        </Typography>

        <Grid container spacing={3}>
          {FEATURES.map(({ Icon, title, body, gradient }) => (
            <Grid item xs={12} sm={6} md={4} key={title}>
              <Card
                sx={{
                  height: '100%',
                  borderRadius: 3,
                  transition: 'transform 0.25s ease, box-shadow 0.25s ease',
                  '&:hover': { transform: 'translateY(-4px)', boxShadow: 6 },
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Box
                    sx={{
                      background: gradient,
                      width: 48,
                      height: 48,
                      borderRadius: 2.5,
                      display: 'grid',
                      placeItems: 'center',
                      mb: 2,
                    }}
                  >
                    <Icon sx={{ fontSize: 24, color: '#fff' }} />
                  </Box>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 1, color: '#0F172A' }}>
                    {title}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#64748B', lineHeight: 1.7 }}>
                    {body}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}

/**
 * A static excerpt of a real SMTP conversation. It communicates what the project
 * is faster than any illustration — anyone who has read a protocol trace
 * recognises it immediately.
 */
function TranscriptPreview() {
  const lines = [
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
    ['S', '250 2.0.0 Ok: queued as 4B2f1x'],
  ];

  return (
    <Box
      sx={{
        bgcolor: '#0F172A',
        borderRadius: 3,
        p: 3,
        boxShadow: '0 20px 40px -12px rgba(15, 23, 42, 0.4)',
        overflowX: 'auto',
      }}
    >
      <Stack direction="row" spacing={0.75} sx={{ mb: 2 }}>
        {['#EF4444', '#F59E0B', '#10B981'].map((color) => (
          <Box key={color} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
        ))}
      </Stack>

      {lines.map(([direction, text], index) => (
        <Typography
          key={index}
          component="div"
          sx={{
            fontFamily: 'monospace',
            fontSize: 12.5,
            lineHeight: 1.9,
            whiteSpace: 'pre',
            color: direction === 'C' ? '#7DD3FC' : '#86EFAC',
          }}
        >
          <Box component="span" sx={{ color: '#475569', mr: 1 }}>
            {direction}:
          </Box>
          {text}
        </Typography>
      ))}
    </Box>
  );
}

function BackgroundDecoration() {
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        zIndex: 0,
        opacity: 0.45,
        pointerEvents: 'none',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          top: '5%',
          left: '-5%',
          width: '28rem',
          height: '28rem',
          background: 'radial-gradient(circle, #C4B5FD, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          bottom: '0%',
          right: '-5%',
          width: '28rem',
          height: '28rem',
          background: 'radial-gradient(circle, #FCD34D, transparent 70%)',
          filter: 'blur(90px)',
        }}
      />
    </Box>
  );
}
