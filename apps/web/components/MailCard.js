import React from 'react';
import { Box, Stack, Typography } from '@mui/material';

/**
 * A folder selector. Flat by default and marked by a rule plus weight when
 * active, so switching folders does not make the page jump the way a scaling
 * card would.
 */
export default function MailCard({ icon, title, count, onClick, selected }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      aria-pressed={selected}
      sx={{
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        appearance: 'none',
        font: 'inherit',
        px: 2,
        py: 1.75,
        border: '1px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        borderRadius: 1.5,
        bgcolor: 'background.paper',
        transition: 'border-color 120ms ease, background-color 120ms ease',
        '&:hover': { borderColor: selected ? 'primary.main' : 'grey.400' },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.25}>
        <Box
          sx={{
            display: 'flex',
            color: selected ? 'text.primary' : 'text.disabled',
            '& svg': { fontSize: 17 },
          }}
        >
          {icon}
        </Box>
        <Typography
          sx={{
            fontSize: '0.875rem',
            fontWeight: selected ? 600 : 500,
            color: selected ? 'text.primary' : 'text.secondary',
            flexGrow: 1,
          }}
        >
          {title}
        </Typography>
        <Typography
          className="mono tnum"
          sx={{
            fontFamily: 'var(--mono)',
            fontSize: '0.8125rem',
            fontWeight: 500,
            color: selected ? 'text.primary' : 'text.disabled',
          }}
        >
          {count}
        </Typography>
      </Stack>
    </Box>
  );
}
