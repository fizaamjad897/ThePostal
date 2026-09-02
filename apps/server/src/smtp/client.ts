import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';
import { SmtpDeliveryError } from '../lib/errors.js';
import { observeReplyCode } from '../lib/metrics.js';
import { type SmtpTranscript } from './transcript.js';

export interface SmtpReply {
  code: number;
  /** Enhanced status code from RFC 3463, e.g. `5.1.1`, when the server sends one. */
  enhanced: string | null;
  lines: string[];
  text: string;
}

export interface SmtpClientOptions {
  host: string;
  port: number;
  /** Name announced in EHLO. Should be a FQDN that resolves back to this host. */
  clientHostname: string;
  transcript: SmtpTranscript;
  tlsPolicy: 'disabled' | 'opportunistic' | 'require';
  rejectUnauthorized: boolean;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  auth?: { user: string; pass: string } | undefined;
  /** Connect with TLS from the first byte (implicit TLS, usually port 465). */
  implicitTls?: boolean;
}

export interface SmtpEnvelope {
  from: string;
  to: string[];
}

export interface SmtpSendResult {
  reply: SmtpReply;
  acceptedRecipients: string[];
  rejectedRecipients: { address: string; reply: SmtpReply }[];
  remoteAddress: string | null;
  remotePort: number | null;
  tlsProtocol: string | null;
  tlsCipher: string | null;
  messageBytes: number;
  /** DATA-phase throughput; the only figure that reflects real payload transfer. */
  throughputKbps: number | null;
}

const CRLF = '\r\n';

/**
 * A minimal but standards-correct SMTP client (RFC 5321), written directly on
 * sockets rather than delegating to a library.
 *
 * The reason is instrumentation: the whole point of this project is to expose
 * where time goes inside a mail transaction, and off-the-shelf clients report a
 * single end-to-end duration. Owning the socket means every command boundary is
 * observable — the TCP connect, the TLS handshake, the server's greeting
 * latency, and the DATA upload are separately timed and separately graphed.
 *
 * One instance handles exactly one connection and must not be reused; the
 * protocol is stateful and a half-finished transaction cannot be safely resumed.
 */
export class SmtpClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = '';
  private capabilities = new Set<string>();
  private authMechanisms = new Set<string>();
  private maxMessageSize: number | null = null;
  /** Resolver for the reply currently being awaited, if any. */
  private pending: {
    resolve: (reply: SmtpReply) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  private fatalError: Error | null = null;
  private closed = false;

  constructor(private readonly options: SmtpClientOptions) {}

  private get transcript(): SmtpTranscript {
    return this.options.transcript;
  }

  /* ---------------------------------------------------------------- *
   * Connection lifecycle
   * ---------------------------------------------------------------- */

  async connect(): Promise<void> {
    const { host, port, implicitTls, connectTimeoutMs } = this.options;

    await this.transcript.measure('tcp', async () => {
      const socket = implicitTls
        ? tls.connect({
            host,
            port,
            servername: host,
            rejectUnauthorized: this.options.rejectUnauthorized,
          })
        : net.connect({ host, port });

      socket.setTimeout(0); // Timeouts are enforced per command, not per socket.
      socket.setKeepAlive(true, 30_000);

      const timer = setTimeout(() => {
        socket.destroy(
          new SmtpDeliveryError(`Connection to ${host}:${port} timed out after ${connectTimeoutMs}ms`),
        );
      }, connectTimeoutMs);

      try {
        await once(socket, implicitTls ? 'secureConnect' : 'connect');
      } catch (cause) {
        clearTimeout(timer);
        // A refused or unreachable peer is transient by definition: the server
        // may be restarting, so this must be retried rather than bounced.
        throw new SmtpDeliveryError(`Cannot connect to ${host}:${port}`, {
          permanent: false,
          cause,
        });
      }
      clearTimeout(timer);
      this.attach(socket);
    });

    // The greeting is timed separately: a slow banner is the classic signature
    // of a greylisting or tarpitting peer, and is invisible in an aggregate.
    const greeting = await this.transcript.measure('greeting', () => this.readReply());
    this.expect(greeting, [220], 'server greeting');
  }

  /** Attach (or re-attach, after a STARTTLS upgrade) the socket handlers. */
  private attach(socket: net.Socket | tls.TLSSocket): void {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.removeAllListeners('data');
    socket.removeAllListeners('error');
    socket.removeAllListeners('close');

    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('error', (error: Error) => this.fail(error));
    socket.on('close', () => {
      this.closed = true;
      // A close while a reply is outstanding is a dropped connection, not a
      // clean shutdown — surface it rather than hanging until the timeout.
      this.fail(new SmtpDeliveryError('Connection closed by remote host', { permanent: false }));
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;

    // A reply is complete when a line's 4th character is a space rather than a
    // hyphen (RFC 5321 §4.2.1). Anything before that is a continuation.
    let index: number;
    while ((index = this.buffer.indexOf(CRLF)) !== -1) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + CRLF.length);
      this.transcript.record('S', line);
      this.currentLines.push(line);

      if (line.length >= 4 && line[3] === '-') continue;
      const lines = this.currentLines;
      this.currentLines = [];
      this.deliverReply(lines);
    }
  }

  private currentLines: string[] = [];

  private deliverReply(lines: string[]): void {
    const first = lines[0] ?? '';
    const code = Number.parseInt(first.slice(0, 3), 10);
    if (!Number.isFinite(code)) {
      this.fail(new SmtpDeliveryError(`Unparseable SMTP reply: ${first}`, { permanent: false }));
      return;
    }

    const text = lines.map((l) => l.slice(4)).join(' ').trim();
    const enhanced = /^([245]\.\d{1,3}\.\d{1,3})\b/.exec(text)?.[1] ?? null;
    const reply: SmtpReply = { code, enhanced, lines, text };

    observeReplyCode(code);

    const pending = this.pending;
    if (!pending) return; // Unsolicited line (some servers chatter); ignore it.
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(reply);
  }

  private fail(error: Error): void {
    if (this.fatalError) return;
    this.fatalError = error;
    const pending = this.pending;
    if (pending) {
      this.pending = null;
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private readReply(): Promise<SmtpReply> {
    if (this.fatalError) return Promise.reject(this.fatalError);

    return new Promise<SmtpReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        const error = new SmtpDeliveryError(
          `Timed out after ${this.options.commandTimeoutMs}ms waiting for an SMTP reply`,
          { permanent: false },
        );
        this.fail(error);
        reject(error);
      }, this.options.commandTimeoutMs);

      this.pending = { resolve, reject, timer };
    });
  }

  private async command(line: string): Promise<SmtpReply> {
    if (!this.socket || this.closed) {
      throw this.fatalError ?? new SmtpDeliveryError('Socket is not open', { permanent: false });
    }
    this.transcript.record('C', line);
    this.socket.write(line + CRLF);
    return this.readReply();
  }

  /**
   * Assert a reply falls in the expected set, and classify it if it does not.
   * 5xx is permanent (the message will never be accepted as-is); 4xx and
   * anything unrecognised is transient and worth another attempt later.
   */
  private expect(reply: SmtpReply, accepted: number[], context: string): void {
    if (accepted.includes(reply.code)) return;
    throw new SmtpDeliveryError(
      `Unexpected reply to ${context}: ${reply.code} ${reply.text}`,
      {
        responseCode: reply.code,
        responseText: reply.text,
        permanent: reply.code >= 500 && reply.code < 600,
      },
    );
  }

  /* ---------------------------------------------------------------- *
   * Protocol phases
   * ---------------------------------------------------------------- */

  /** EHLO, with an automatic HELO fallback for pre-ESMTP servers. */
  async ehlo(): Promise<void> {
    await this.transcript.measure('ehlo', async () => {
      let reply = await this.command(`EHLO ${this.options.clientHostname}`);

      if (reply.code === 500 || reply.code === 502) {
        // RFC 5321 §3.2: a server that does not implement ESMTP rejects EHLO,
        // and the client is expected to retry with HELO before giving up.
        reply = await this.command(`HELO ${this.options.clientHostname}`);
        this.expect(reply, [250], 'HELO');
        return;
      }

      this.expect(reply, [250], 'EHLO');
      this.parseCapabilities(reply.lines);
    });
  }

  private parseCapabilities(lines: string[]): void {
    this.capabilities.clear();
    this.authMechanisms.clear();
    this.maxMessageSize = null;

    // The first line is the greeting text, not a capability.
    for (const raw of lines.slice(1)) {
      const line = raw.slice(4).trim();
      const [keyword = '', ...args] = line.split(/\s+/);
      const name = keyword.toUpperCase();
      this.capabilities.add(name);

      if (name === 'AUTH') {
        for (const mechanism of args) this.authMechanisms.add(mechanism.toUpperCase());
      } else if (name === 'SIZE' && args[0]) {
        const size = Number.parseInt(args[0], 10);
        if (Number.isFinite(size) && size > 0) this.maxMessageSize = size;
      }
    }
  }

  supports(capability: string): boolean {
    return this.capabilities.has(capability.toUpperCase());
  }

  /**
   * Upgrade the connection with STARTTLS when policy and the peer allow it.
   * Returns whether the connection is now encrypted.
   */
  async startTls(): Promise<boolean> {
    const { tlsPolicy } = this.options;
    if (tlsPolicy === 'disabled' || this.options.implicitTls) return this.options.implicitTls ?? false;

    if (!this.supports('STARTTLS')) {
      if (tlsPolicy === 'require') {
        // Refusing to fall back is the point of `require`: silently sending in
        // cleartext when TLS was demanded is worse than not sending at all.
        throw new SmtpDeliveryError(
          `${this.options.host} does not offer STARTTLS but TLS policy is "require"`,
          { permanent: true },
        );
      }
      return false;
    }

    return this.transcript.measure('tls', async () => {
      const reply = await this.command('STARTTLS');
      this.expect(reply, [220], 'STARTTLS');

      const plain = this.socket as net.Socket;
      plain.removeAllListeners('data');
      plain.removeAllListeners('error');
      plain.removeAllListeners('close');

      const secure = tls.connect({
        socket: plain,
        servername: this.options.host,
        rejectUnauthorized: this.options.rejectUnauthorized,
      });

      try {
        await once(secure, 'secureConnect');
      } catch (cause) {
        throw new SmtpDeliveryError(`TLS handshake with ${this.options.host} failed`, {
          // A handshake failure is usually a certificate or protocol mismatch,
          // which will not fix itself on the next attempt.
          permanent: true,
          cause,
        });
      }

      this.buffer = '';
      this.currentLines = [];
      this.attach(secure);

      // RFC 3207 §4.2: the TLS handshake resets the session, and the client must
      // re-issue EHLO. Capabilities advertised in cleartext are discarded — a
      // server may (and often does) offer different ones once encrypted.
      await this.ehlo();
      return true;
    });
  }

  async authenticate(): Promise<void> {
    const { auth } = this.options;
    if (!auth) return;

    await this.transcript.measure('auth', async () => {
      if (this.authMechanisms.has('PLAIN')) {
        // RFC 4616: the payload is authzid NUL authcid NUL password.
        const token = Buffer.from(`\0${auth.user}\0${auth.pass}`, 'utf8').toString('base64');
        const reply = await this.command(`AUTH PLAIN ${token}`);
        this.expect(reply, [235], 'AUTH PLAIN');
        return;
      }

      if (this.authMechanisms.has('LOGIN')) {
        const start = await this.command('AUTH LOGIN');
        this.expect(start, [334], 'AUTH LOGIN');
        const userReply = await this.command(Buffer.from(auth.user, 'utf8').toString('base64'));
        this.expect(userReply, [334], 'AUTH LOGIN username');
        const passReply = await this.command(Buffer.from(auth.pass, 'utf8').toString('base64'));
        this.expect(passReply, [235], 'AUTH LOGIN password');
        return;
      }

      throw new SmtpDeliveryError(
        `${this.options.host} offers no supported AUTH mechanism` +
          (this.authMechanisms.size ? ` (advertised: ${[...this.authMechanisms].join(', ')})` : ''),
        { permanent: true },
      );
    });
  }

  /* ---------------------------------------------------------------- *
   * Mail transaction
   * ---------------------------------------------------------------- */

  async send(envelope: SmtpEnvelope, raw: Buffer): Promise<SmtpSendResult> {
    const messageBytes = raw.byteLength;

    if (this.maxMessageSize !== null && messageBytes > this.maxMessageSize) {
      // Checking the advertised SIZE up front turns a wasted upload of the full
      // payload into an immediate, correctly-classified permanent failure.
      throw new SmtpDeliveryError(
        `Message is ${messageBytes} bytes but ${this.options.host} accepts at most ${this.maxMessageSize}`,
        { permanent: true },
      );
    }

    const sizeParam = this.supports('SIZE') ? ` SIZE=${messageBytes}` : '';
    await this.transcript.measure('mailFrom', async () => {
      const reply = await this.command(`MAIL FROM:<${envelope.from}>${sizeParam}`);
      this.expect(reply, [250], 'MAIL FROM');
    });

    const acceptedRecipients: string[] = [];
    const rejectedRecipients: { address: string; reply: SmtpReply }[] = [];

    await this.transcript.measure('rcptTo', async () => {
      for (const address of envelope.to) {
        const reply = await this.command(`RCPT TO:<${address}>`);
        // 251 is "user not local; will forward" — an acceptance, not an error.
        if (reply.code === 250 || reply.code === 251) acceptedRecipients.push(address);
        else rejectedRecipients.push({ address, reply });
      }
    });

    if (acceptedRecipients.length === 0) {
      const first = rejectedRecipients[0]?.reply;
      throw new SmtpDeliveryError(
        `All ${envelope.to.length} recipient(s) were rejected` +
          (first ? `: ${first.code} ${first.text}` : ''),
        {
          responseCode: first?.code ?? null,
          responseText: first?.text ?? null,
          permanent: first ? first.code >= 500 : false,
        },
      );
    }

    const reply = await this.transcript.measure('data', async () => {
      const ready = await this.command('DATA');
      this.expect(ready, [354], 'DATA');

      if (!this.socket) throw new SmtpDeliveryError('Socket closed before DATA', { permanent: false });
      this.transcript.record('C', `<${messageBytes} bytes of message body>`);
      this.socket.write(dotStuff(raw));
      this.socket.write(`${CRLF}.${CRLF}`);

      const result = await this.readReply();
      this.expect(result, [250], 'end of DATA');
      return result;
    });

    const dataMs = this.transcript.phases.find((p) => p.phase === 'data')?.durationMs ?? 0;
    const throughputKbps = dataMs > 0 ? round((messageBytes * 8) / dataMs) : null;

    const socket = this.socket;
    const tlsSocket = socket instanceof tls.TLSSocket ? socket : null;

    return {
      reply,
      acceptedRecipients,
      rejectedRecipients,
      remoteAddress: socket?.remoteAddress ?? null,
      remotePort: socket?.remotePort ?? null,
      tlsProtocol: tlsSocket?.getProtocol() ?? null,
      tlsCipher: tlsSocket?.getCipher()?.name ?? null,
      messageBytes,
      throughputKbps,
    };
  }

  /** Close the session politely. Never throws — the mail is already delivered. */
  async quit(): Promise<void> {
    if (!this.socket || this.closed) return;
    try {
      await this.transcript.measure('quit', async () => {
        await this.command('QUIT');
      });
    } catch {
      // A peer that drops the connection instead of answering QUIT is common and
      // harmless: the 250 for DATA already committed the message.
    } finally {
      this.destroy();
    }
  }

  destroy(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
    this.socket?.removeAllListeners();
    this.socket?.destroy();
    this.socket = null;
    this.closed = true;
  }
}

/**
 * RFC 5321 §4.5.2 (transparency). The sequence CRLF "." CRLF terminates DATA, so
 * any body line that legitimately begins with "." must be sent with an extra
 * one, which the receiver strips. Without this, a message containing a line of
 * "." alone is truncated at that point — a subtle, data-dependent corruption.
 */
export function dotStuff(raw: Buffer): Buffer {
  const text = raw.toString('binary');
  const stuffed = text
    .replace(/\r\n\./g, '\r\n..')
    .replace(/^\./, '..');
  return Buffer.from(stuffed, 'binary');
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
