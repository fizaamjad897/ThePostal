import { SMTPServer } from 'smtp-server';

export interface ReceivedMessage {
  from: string;
  to: string[];
  raw: string;
}

export interface SmtpSink {
  received: ReceivedMessage[];
  /** Force the next N transactions to fail with this reply code. */
  failNextWith(code: number, text: string, times?: number): void;
  close(): Promise<void>;
}

/**
 * A controllable SMTP server used as the peer in delivery tests.
 *
 * The client under test is our own hand-written implementation, so it is worth
 * pointing it at a real server that actually speaks the protocol — a stubbed
 * socket would only prove that our code matches our own assumptions about what
 * a server says.
 */
export async function startSmtpSink(port: number): Promise<SmtpSink> {
  const received: ReceivedMessage[] = [];
  let failures: { code: number; text: string; remaining: number } | null = null;

  const server = new SMTPServer({
    authOptional: true,
    hideSTARTTLS: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        if (failures && failures.remaining > 0) {
          failures.remaining -= 1;
          const error = new Error(failures.text) as Error & { responseCode?: number };
          error.responseCode = failures.code;
          callback(error);
          return;
        }
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          raw: Buffer.concat(chunks).toString('utf8'),
        });
        callback();
      });
    },
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  // Sessions torn down mid-transaction are expected in these tests; without a
  // listener the emitter would throw and fail an unrelated assertion.
  server.on('error', () => {});

  return {
    received,
    failNextWith(code, text, times = 1) {
      failures = { code, text, remaining: times };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
