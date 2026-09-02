import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Container,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import {
  Send as SendIcon,
  AttachFile as AttachFileIcon,
  Close as CloseIcon,
  ExpandMore,
  ExpandLess,
} from '@mui/icons-material';
import { messages as messagesApi } from '../lib/api';
import { useRequireAuth } from '../lib/auth-context';
import { collectClientTrace, fileToBase64 } from '../lib/network-trace';
import TopBar from './TopBar';

const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

export default function ComposeEmail() {
  const router = useRouter();
  const { user, isReady } = useRequireAuth();
  const fileInputRef = React.useRef(null);

  const [form, setForm] = useState({ to: '', cc: '', bcc: '', subject: '', body: '', html: false });
  const [attachments, setAttachments] = useState([]);
  const [showCopies, setShowCopies] = useState(false);
  const [status, setStatus] = useState({ kind: 'idle' });

  const attachmentBytes = attachments.reduce((sum, file) => sum + file.size, 0);
  const oversize = attachmentBytes > MAX_TOTAL_BYTES;

  const recipients = useMemo(() => parseAddresses(form.to), [form.to]);
  const canSend =
    recipients.length > 0 && form.subject.trim() && form.body.trim() && !oversize && status.kind !== 'sending';

  const update = (field) => (event) => {
    const value = field === 'html' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const addFiles = (event) => {
    setAttachments((current) => [...current, ...Array.from(event.target.files ?? [])]);
    // Reset so selecting the same file twice still fires a change event.
    event.target.value = '';
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSend) return;

    setStatus({ kind: 'sending' });

    try {
      const encoded = await Promise.all(
        attachments.map(async (file) => ({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          content: await fileToBase64(file),
        })),
      );

      const accepted = await messagesApi.send({
        to: recipients,
        cc: parseAddresses(form.cc),
        bcc: parseAddresses(form.bcc),
        subject: form.subject.trim(),
        body: form.body,
        html: form.html,
        attachments: encoded,
        // The browser's own view of the network, recorded alongside the
        // server's SMTP trace so both halves of the path are visible.
        clientTrace: collectClientTrace(),
      });

      setStatus({ kind: 'accepted', message: accepted });
    } catch (caught) {
      setStatus({ kind: 'error', error: caught.message ?? 'Could not submit the message' });
    }
  };

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

      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, color: '#0F172A', mb: 0.5 }}>
          New message
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
          Sending as {user?.email}. The server queues the message, opens an SMTP session, and records
          every phase of the transaction.
        </Typography>

        {status.kind === 'accepted' && (
          <Alert
            severity="success"
            sx={{ mb: 3 }}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => router.push(`/messages/${status.message.id}`)}
              >
                View trace
              </Button>
            }
          >
            Accepted for delivery as <strong>{status.message.messageId}</strong>. Delivery happens in
            the background — open the trace to watch it settle.
          </Alert>
        )}

        {status.kind === 'error' && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setStatus({ kind: 'idle' })}>
            {status.error}
          </Alert>
        )}

        <Card sx={{ borderRadius: 3 }}>
          <CardContent sx={{ p: { xs: 2.5, sm: 4 } }}>
            <form onSubmit={handleSubmit}>
              <Stack spacing={2.5}>
                <TextField
                  fullWidth
                  required
                  label="To"
                  placeholder="someone@example.net, another@example.net"
                  value={form.to}
                  onChange={update('to')}
                  helperText={
                    recipients.length > 1 ? `${recipients.length} recipients` : 'Comma-separated'
                  }
                />

                <Box>
                  <Button
                    size="small"
                    onClick={() => setShowCopies((v) => !v)}
                    endIcon={showCopies ? <ExpandLess /> : <ExpandMore />}
                  >
                    Cc and Bcc
                  </Button>
                  <Collapse in={showCopies}>
                    <Stack spacing={2.5} sx={{ mt: 2 }}>
                      <TextField fullWidth label="Cc" value={form.cc} onChange={update('cc')} />
                      <TextField
                        fullWidth
                        label="Bcc"
                        value={form.bcc}
                        onChange={update('bcc')}
                        helperText="Delivered via the SMTP envelope; never written into the message headers."
                      />
                    </Stack>
                  </Collapse>
                </Box>

                <TextField
                  fullWidth
                  required
                  label="Subject"
                  value={form.subject}
                  onChange={update('subject')}
                />

                <TextField
                  fullWidth
                  required
                  multiline
                  rows={10}
                  label={form.html ? 'HTML body' : 'Message'}
                  value={form.body}
                  onChange={update('body')}
                />

                <FormControlLabel
                  control={<Switch checked={form.html} onChange={update('html')} />}
                  label="Send as HTML"
                />

                {attachments.length > 0 && (
                  <Stack direction="row" flexWrap="wrap" sx={{ gap: 1 }}>
                    {attachments.map((file, index) => (
                      <Chip
                        key={`${file.name}-${index}`}
                        label={`${file.name} · ${formatBytes(file.size)}`}
                        onDelete={() =>
                          setAttachments((current) => current.filter((_, i) => i !== index))
                        }
                        deleteIcon={<CloseIcon />}
                        variant="outlined"
                      />
                    ))}
                  </Stack>
                )}

                {oversize && (
                  <Alert severity="warning">
                    Attachments total {formatBytes(attachmentBytes)}, over the {formatBytes(MAX_TOTAL_BYTES)}{' '}
                    limit this server accepts.
                  </Alert>
                )}

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Button
                    variant="outlined"
                    startIcon={<AttachFileIcon />}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Attach
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={addFiles}
                  />

                  <Button
                    type="submit"
                    variant="contained"
                    size="large"
                    disabled={!canSend}
                    startIcon={
                      status.kind === 'sending' ? (
                        <CircularProgress size={18} color="inherit" />
                      ) : (
                        <SendIcon />
                      )
                    }
                  >
                    {status.kind === 'sending' ? 'Submitting…' : 'Send'}
                  </Button>
                </Stack>
              </Stack>
            </form>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}

/** Split a comma- or semicolon-separated list into normalised addresses. */
function parseAddresses(value) {
  return value
    .split(/[,;]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.includes('@'));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
