import React from 'react';
import { Chip } from '@mui/material';
import {
  CheckCircle,
  Schedule,
  Error as ErrorIcon,
  Sync,
  Replay,
} from '@mui/icons-material';

/**
 * One place that decides how a delivery status looks. Colour carries meaning
 * here, so it is paired with a distinct icon and label — status must remain
 * readable without relying on colour alone.
 */
const PRESETS = {
  queued: { label: 'Queued', color: 'default', Icon: Schedule },
  sending: { label: 'Sending', color: 'info', Icon: Sync },
  sent: { label: 'Delivered', color: 'success', Icon: CheckCircle },
  deferred: { label: 'Deferred', color: 'warning', Icon: Replay },
  failed: { label: 'Failed', color: 'error', Icon: ErrorIcon },
};

export default function StatusChip({ status, size = 'small' }) {
  const preset = PRESETS[status] ?? { label: status, color: 'default', Icon: Schedule };
  const { label, color, Icon } = preset;

  return (
    <Chip
      size={size}
      color={color}
      variant="outlined"
      icon={<Icon sx={{ fontSize: 16 }} />}
      label={label}
      sx={{ fontWeight: 600 }}
    />
  );
}
