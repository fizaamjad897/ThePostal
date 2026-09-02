import React, { useState } from 'react';
import { useRouter } from 'next/router';
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Logout,
  MarkEmailRead,
  Insights,
  Inbox as InboxIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { useAuth } from '../lib/auth-context';

const NAV_LINKS = [
  { href: '/client/dashboard', label: 'Mailbox', Icon: InboxIcon },
  { href: '/compose', label: 'Compose', Icon: EditIcon },
  { href: '/server/dashboard', label: 'Telemetry', Icon: Insights },
];

export default function TopBar() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [anchor, setAnchor] = useState(null);

  const initials = (user?.displayName || user?.email || '?').trim().charAt(0).toUpperCase();

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        background: 'linear-gradient(90deg, #4C1D95 0%, #6D28D9 60%, #7C3AED 100%)',
      }}
    >
      <Toolbar sx={{ gap: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mr: 2 }}>
          <MarkEmailRead />
          <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.01em' }}>
            Postal
          </Typography>
        </Stack>

        <Stack direction="row" spacing={0.5} sx={{ flexGrow: 1, display: { xs: 'none', sm: 'flex' } }}>
          {NAV_LINKS.map(({ href, label, Icon }) => {
            const active = router.pathname === href;
            return (
              <Button
                key={href}
                color="inherit"
                startIcon={<Icon />}
                onClick={() => router.push(href)}
                sx={{
                  // The active page is marked with weight and a background wash
                  // rather than colour alone.
                  fontWeight: active ? 700 : 500,
                  bgcolor: active ? 'rgba(255,255,255,0.16)' : 'transparent',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.24)' },
                }}
              >
                {label}
              </Button>
            );
          })}
        </Stack>

        <Box sx={{ flexGrow: { xs: 1, sm: 0 } }} />

        {user && (
          <Tooltip title={user.email}>
            <IconButton onClick={(event) => setAnchor(event.currentTarget)} size="small">
              <Avatar sx={{ width: 34, height: 34, bgcolor: '#FDE68A', color: '#78350F', fontWeight: 700 }}>
                {initials}
              </Avatar>
            </IconButton>
          </Tooltip>
        )}

        <Menu
          anchorEl={anchor}
          open={Boolean(anchor)}
          onClose={() => setAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {user?.displayName}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {user?.email}
            </Typography>
          </Box>
          <Divider />
          <MenuItem
            onClick={async () => {
              setAnchor(null);
              await signOut();
              await router.push('/auth');
            }}
          >
            <ListItemIcon>
              <Logout fontSize="small" />
            </ListItemIcon>
            Sign out
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
