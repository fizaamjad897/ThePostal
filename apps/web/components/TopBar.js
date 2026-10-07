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
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Logout, MenuRounded } from '@mui/icons-material';
import { useAuth } from '../lib/auth-context';
import Wordmark from './Wordmark';

const LINKS = [
  { href: '/client/dashboard', label: 'Mailbox' },
  { href: '/compose', label: 'Compose' },
  { href: '/server/dashboard', label: 'Telemetry' },
];

export default function TopBar() {
  const router = useRouter();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const { user, signOut } = useAuth();

  const [account, setAccount] = useState(null);
  const [nav, setNav] = useState(null);

  const initial = (user?.displayName || user?.email || '?').trim().charAt(0).toUpperCase();

  const go = (href) => {
    setNav(null);
    void router.push(href);
  };

  return (
    <AppBar position="sticky">
      <Toolbar sx={{ gap: 1 }}>
        <Box
          component="button"
          onClick={() => go('/client/dashboard')}
          aria-label="Postal home"
          sx={{
            display: 'flex',
            alignItems: 'center',
            background: 'none',
            border: 0,
            p: 0,
            mr: 2.5,
            cursor: 'pointer',
          }}
        >
          <Wordmark />
        </Box>

        {compact ? (
          <>
            <Box sx={{ flexGrow: 1 }} />
            <IconButton onClick={(e) => setNav(e.currentTarget)} aria-label="Open navigation">
              <MenuRounded />
            </IconButton>
            <Menu anchorEl={nav} open={Boolean(nav)} onClose={() => setNav(null)}>
              {LINKS.map(({ href, label }) => (
                <MenuItem key={href} selected={router.pathname === href} onClick={() => go(href)}>
                  {label}
                </MenuItem>
              ))}
            </Menu>
          </>
        ) : (
          <Stack direction="row" spacing={0.25} sx={{ flexGrow: 1 }}>
            {LINKS.map(({ href, label }) => {
              const active = router.pathname === href;
              return (
                <Button
                  key={href}
                  onClick={() => go(href)}
                  disableRipple
                  sx={{
                    px: 1.25,
                    color: active ? 'text.primary' : 'text.secondary',
                    fontWeight: active ? 600 : 500,
                    borderRadius: 0,
                    // The active page is marked by a rule aligned to the
                    // header's own bottom border, so the two read as one line.
                    position: 'relative',
                    '&::after': active
                      ? {
                          content: '""',
                          position: 'absolute',
                          left: 10,
                          right: 10,
                          bottom: -16,
                          height: 2,
                          backgroundColor: 'text.primary',
                        }
                      : undefined,
                    '&:hover': { backgroundColor: 'transparent', color: 'text.primary' },
                  }}
                >
                  {label}
                </Button>
              );
            })}
          </Stack>
        )}

        {user && (
          <IconButton onClick={(e) => setAccount(e.currentTarget)} aria-label="Account" sx={{ p: 0.5 }}>
            <Avatar
              sx={{
                width: 28,
                height: 28,
                fontSize: 12,
                fontWeight: 600,
                bgcolor: 'primary.main',
                color: '#fff',
              }}
            >
              {initial}
            </Avatar>
          </IconButton>
        )}

        <Menu
          anchorEl={account}
          open={Boolean(account)}
          onClose={() => setAccount(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { sx: { minWidth: 220 } } }}
        >
          <Box sx={{ px: 1.75, py: 1.25 }}>
            <Typography variant="subtitle2" sx={{ color: 'text.primary' }}>
              {user?.displayName}
            </Typography>
            <Typography
              className="mono"
              variant="caption"
              sx={{ color: 'text.secondary', fontFamily: 'var(--mono)', wordBreak: 'break-all' }}
            >
              {user?.email}
            </Typography>
          </Box>
          <Divider />
          <MenuItem
            onClick={async () => {
              setAccount(null);
              await signOut();
              await router.push('/auth');
            }}
          >
            <ListItemIcon>
              <Logout sx={{ fontSize: 17 }} />
            </ListItemIcon>
            Sign out
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
