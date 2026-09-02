import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Inbox as InboxIcon,
  Send as SendIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  Delete as DeleteIcon,
  Replay as ReplayIcon,
  Search as SearchIcon,
  Archive as ArchiveIcon,
} from '@mui/icons-material';
import { messages as messagesApi, subscribeToEvents } from '../lib/api';
import { useRequireAuth } from '../lib/auth-context';
import TopBar from './TopBar';
import MailCard from './MailCard';
import StatusChip from './StatusChip';

const FOLDERS = [
  { key: 'inbox', label: 'Inbox', Icon: InboxIcon, color: '#F59E0B' },
  { key: 'sent', label: 'Sent', Icon: SendIcon, color: '#38BDF8' },
  { key: 'archive', label: 'Archive', Icon: ArchiveIcon, color: '#10B981' },
];

export default function EmailDashboard() {
  const router = useRouter();
  const { user, isReady } = useRequireAuth();

  const [folder, setFolder] = useState('inbox');
  const [search, setSearch] = useState('');
  const [state, setState] = useState({ items: [], total: 0, nextCursor: null });
  const [counts, setCounts] = useState({ inbox: 0, sent: 0, archive: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(
    async ({ cursor = null, silent = false } = {}) => {
      if (!isReady) return;
      if (cursor) setLoadingMore(true);
      else if (!silent) setLoading(true);

      try {
        const page = await messagesApi.list({
          folder,
          limit: 25,
          q: search.trim() || undefined,
          cursor: cursor || undefined,
        });

        setState((current) => ({
          // A cursored fetch appends; a fresh fetch replaces.
          items: cursor ? [...current.items, ...page.items] : page.items,
          total: page.total,
          nextCursor: page.nextCursor,
        }));
        setCounts((current) => ({ ...current, [folder]: page.total }));
        setError(null);
      } catch (caught) {
        setError(caught.message ?? 'Could not load messages');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [folder, search, isReady],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Refresh quietly when the server reports a delivery state change, so a
   * message that lands or bounces updates without the user reloading. `silent`
   * keeps the list on screen rather than flashing skeletons on every event.
   */
  useEffect(() => {
    if (!isReady) return undefined;

    return subscribeToEvents((event) => {
      if (event.type === 'metrics.tick') return;
      void load({ silent: true });
    });
  }, [isReady, load]);

  const toggleStar = async (message, event) => {
    event.stopPropagation();
    // Optimistic: a star is trivially reversible and waiting on a round trip for
    // it feels broken.
    setState((current) => ({
      ...current,
      items: current.items.map((m) => (m.id === message.id ? { ...m, starred: !m.starred } : m)),
    }));

    try {
      await messagesApi.patch(message.id, { starred: !message.starred });
    } catch {
      void load({ silent: true });
    }
  };

  const remove = async (message, event) => {
    event.stopPropagation();
    setState((current) => ({
      ...current,
      items: current.items.filter((m) => m.id !== message.id),
      total: Math.max(0, current.total - 1),
    }));

    try {
      await messagesApi.remove(message.id);
    } catch (caught) {
      setError(caught.message ?? 'Could not delete the message');
      void load({ silent: true });
    }
  };

  const retry = async (message, event) => {
    event.stopPropagation();
    try {
      await messagesApi.retry(message.id);
      void load({ silent: true });
    } catch (caught) {
      setError(caught.message ?? 'Could not re-queue the message');
    }
  };

  const unread = useMemo(() => state.items.filter((m) => !m.read).length, [state.items]);

  if (!isReady) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#F8FAFC' }}>
      <TopBar />

      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={2}
          sx={{ mb: 4 }}
        >
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700, color: '#0F172A' }}>
              {user?.displayName || 'Mailbox'}
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748B' }}>
              {user?.email}
              {unread > 0 && ` · ${unread} unread on this page`}
            </Typography>
          </Box>

          <Button
            variant="contained"
            size="large"
            startIcon={<AddIcon />}
            onClick={() => router.push('/compose')}
          >
            Compose
          </Button>
        </Stack>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          {FOLDERS.map(({ key, label, Icon, color }) => (
            <Grid item xs={12} sm={4} key={key}>
              <MailCard
                icon={<Icon />}
                title={label}
                count={key === folder ? state.total : (counts[key] ?? '—')}
                color={color}
                selected={folder === key}
                onClick={() => {
                  setFolder(key);
                  setState({ items: [], total: 0, nextCursor: null });
                }}
              />
            </Grid>
          ))}
        </Grid>

        <TextField
          fullWidth
          size="small"
          placeholder="Search subject, sender or body…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ mb: 3, bgcolor: '#fff' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: '#94A3B8' }} />
              </InputAdornment>
            ),
          }}
        />

        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Card sx={{ borderRadius: 3 }}>
          <CardContent sx={{ p: 0 }}>
            {loading ? (
              <Stack spacing={0} sx={{ p: 2 }}>
                {[0, 1, 2, 3, 4].map((index) => (
                  <Skeleton key={index} height={64} />
                ))}
              </Stack>
            ) : state.items.length === 0 ? (
              <EmptyState folder={folder} searching={Boolean(search.trim())} />
            ) : (
              state.items.map((message, index) => (
                <React.Fragment key={message.id}>
                  {index > 0 && <Divider />}
                  <MessageRow
                    message={message}
                    folder={folder}
                    onOpen={() => router.push(`/messages/${message.id}`)}
                    onStar={(event) => toggleStar(message, event)}
                    onDelete={(event) => remove(message, event)}
                    onRetry={(event) => retry(message, event)}
                  />
                </React.Fragment>
              ))
            )}
          </CardContent>
        </Card>

        {state.nextCursor && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Button
              variant="outlined"
              disabled={loadingMore}
              onClick={() => load({ cursor: state.nextCursor })}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </Box>
        )}
      </Container>
    </Box>
  );
}

function MessageRow({ message, folder, onOpen, onStar, onDelete, onRetry }) {
  const counterparty = folder === 'inbox' ? message.from : message.to.join(', ');
  const canRetry = message.status === 'failed' || message.status === 'deferred';

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={2}
      onClick={onOpen}
      sx={{
        px: 2,
        py: 1.75,
        cursor: 'pointer',
        // Unread mail is marked by weight and a left rule, not by colour alone.
        borderLeft: message.read ? '3px solid transparent' : '3px solid #7C3AED',
        bgcolor: message.read ? 'transparent' : 'rgba(124, 58, 237, 0.04)',
        '&:hover': { bgcolor: 'rgba(15, 23, 42, 0.04)' },
      }}
    >
      <IconButton size="small" onClick={onStar} aria-label={message.starred ? 'Unstar' : 'Star'}>
        {message.starred ? <StarIcon sx={{ color: '#F59E0B' }} /> : <StarBorderIcon sx={{ color: '#CBD5E1' }} />}
      </IconButton>

      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.25 }}>
          <Typography
            noWrap
            variant="subtitle2"
            sx={{ fontWeight: message.read ? 500 : 700, color: '#0F172A', maxWidth: '60%' }}
          >
            {message.subject}
          </Typography>
          {folder !== 'inbox' && <StatusChip status={message.status} />}
        </Stack>

        <Typography noWrap variant="body2" sx={{ color: '#64748B' }}>
          <Box component="span" sx={{ fontWeight: 600, color: '#475569' }}>
            {counterparty}
          </Box>
          {message.bodyPreview ? ` — ${message.bodyPreview}` : ''}
        </Typography>
      </Box>

      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
        <Typography variant="caption" sx={{ color: '#94A3B8', mr: 1, display: { xs: 'none', md: 'block' } }}>
          {formatTimestamp(message.createdAt)}
        </Typography>

        {canRetry && (
          <Tooltip title="Re-queue for delivery">
            <IconButton size="small" onClick={onRetry} aria-label="Retry delivery">
              <ReplayIcon fontSize="small" sx={{ color: '#0EA5E9' }} />
            </IconButton>
          </Tooltip>
        )}

        <Tooltip title="Delete">
          <IconButton size="small" onClick={onDelete} aria-label="Delete message">
            <DeleteIcon fontSize="small" sx={{ color: '#94A3B8' }} />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

function EmptyState({ folder, searching }) {
  return (
    <Stack spacing={1} alignItems="center" sx={{ py: 8, px: 3, textAlign: 'center' }}>
      <InboxIcon sx={{ fontSize: 48, color: '#CBD5E1' }} />
      <Typography variant="h6" sx={{ color: '#475569' }}>
        {searching ? 'No matching messages' : `Nothing in ${folder}`}
      </Typography>
      <Typography variant="body2" sx={{ color: '#94A3B8', maxWidth: 420 }}>
        {searching
          ? 'Try a shorter query — search covers the subject, sender, recipients and body.'
          : folder === 'inbox'
            ? 'Mail delivered to this address over SMTP will appear here.'
            : 'Messages you send will appear here with their full delivery trace.'}
      </Typography>
    </Stack>
  );
}

/** Time for today, weekday within the week, date beyond that — as mail clients do. */
function formatTimestamp(iso) {
  const date = new Date(iso);
  const ageMs = Date.now() - date.getTime();

  if (ageMs < 24 * 3600 * 1000) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (ageMs < 7 * 24 * 3600 * 1000) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
