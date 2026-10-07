import React from 'react';
import { Box, Typography } from '@mui/material';

/**
 * The mark draws an envelope whose flap is also a signal trace — the two things
 * this product is about, in one figure. Authored rather than borrowed from an
 * icon set so the stroke weight matches the interface's hairlines exactly.
 */
export default function Wordmark({ size = 20, showText = true }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box
        component="svg"
        viewBox="0 0 24 24"
        aria-hidden="true"
        sx={{ width: size, height: size, display: 'block', flexShrink: 0 }}
      >
        <rect
          x="1.75"
          y="4.75"
          width="20.5"
          height="14.5"
          rx="2.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        {/* The flap, drawn as a measured trace rather than a plain crease. */}
        <path
          d="M2.5 7.5 L8 13 L10 10.5 L12.2 15 L14.4 11 L16 13 L21.5 7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Box>

      {showText && (
        <Typography
          component="span"
          sx={{ fontSize: '0.9375rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'text.primary' }}
        >
          Postal
        </Typography>
      )}
    </Box>
  );
}
