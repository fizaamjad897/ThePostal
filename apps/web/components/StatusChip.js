import React from 'react';
import { Box, Typography } from '@mui/material';

/**
 * Delivery state, shown as a dot plus a word.
 *
 * Colour is doing real work here — it is the one place in the interface where
 * hue carries meaning — so it is always paired with a distinct label, and the
 * dot is filled or hollow so the states stay separable without colour at all.
 */
const PRESETS = {
  queued:   { label: 'Queued',    color: 'postal.state.idle',  filled: false },
  sending:  { label: 'Sending',   color: 'secondary.main',     filled: false },
  sent:     { label: 'Delivered', color: 'success.main',       filled: true },
  deferred: { label: 'Deferred',  color: 'warning.main',       filled: true },
  failed:   { label: 'Failed',    color: 'error.main',         filled: true },
};

export default function StatusChip({ status, size = 'small' }) {
  const p = PRESETS[status] ?? { label: status, color: 'text.secondary', filled: false };
  const dot = size === 'medium' ? 7 : 6;

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
      <Box
        sx={{
          width: dot,
          height: dot,
          borderRadius: '50%',
          flexShrink: 0,
          border: '1.5px solid',
          borderColor: p.color,
          bgcolor: p.filled ? p.color : 'transparent',
        }}
      />
      <Typography
        sx={{
          fontSize: size === 'medium' ? '0.8125rem' : '0.75rem',
          fontWeight: 550,
          color: p.color,
          whiteSpace: 'nowrap',
        }}
      >
        {p.label}
      </Typography>
    </Box>
  );
}
