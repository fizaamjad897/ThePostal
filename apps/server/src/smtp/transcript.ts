import { performance } from 'node:perf_hooks';
import type { SmtpPhase, SmtpPhaseTiming } from '@postal/shared';
import { observePhase } from '../lib/metrics.js';

export interface TranscriptLine {
  direction: 'C' | 'S';
  /** Milliseconds since the transaction started, for ordering the waterfall. */
  atMs: number;
  text: string;
}

/**
 * Times each phase of an SMTP transaction and keeps a redacted transcript.
 *
 * Timing has to happen here rather than around the transaction as a whole,
 * because the interesting question is never "how long did the mail take" but
 * "which phase was slow" — a slow DNS lookup, a slow TLS handshake and a slow
 * DATA upload have completely different causes and completely different fixes.
 *
 * `performance.now()` is used over `Date.now()` deliberately: it is monotonic,
 * so an NTP correction mid-transaction cannot produce a negative duration.
 */
export class SmtpTranscript {
  private readonly startedAt = performance.now();
  private readonly timings = new Map<SmtpPhase, number>();
  private readonly lines: TranscriptLine[] = [];
  private openPhase: { phase: SmtpPhase; at: number } | null = null;

  begin(phase: SmtpPhase): void {
    this.openPhase = { phase, at: performance.now() };
  }

  /** Close the open phase and accumulate its duration. */
  end(phase: SmtpPhase): number {
    if (!this.openPhase || this.openPhase.phase !== phase) {
      // Phases are opened and closed in matched pairs by the client; an
      // unmatched close means a code path skipped `begin`, so record zero
      // rather than inventing a duration from an unrelated start point.
      return 0;
    }
    const duration = performance.now() - this.openPhase.at;
    // RCPT TO runs once per recipient — accumulate rather than overwrite.
    this.timings.set(phase, (this.timings.get(phase) ?? 0) + duration);
    this.openPhase = null;
    observePhase(phase, duration);
    return duration;
  }

  /** Run `fn` bracketed by begin/end, so a throw cannot leave a phase open. */
  async measure<T>(phase: SmtpPhase, fn: () => Promise<T>): Promise<T> {
    this.begin(phase);
    try {
      return await fn();
    } finally {
      this.end(phase);
    }
  }

  record(direction: 'C' | 'S', text: string): void {
    this.lines.push({
      direction,
      atMs: Math.round((performance.now() - this.startedAt) * 1000) / 1000,
      text: redact(text),
    });
  }

  get phases(): SmtpPhaseTiming[] {
    return [...this.timings.entries()].map(([phase, durationMs]) => ({
      phase,
      durationMs: round(durationMs),
    }));
  }

  get totalMs(): number {
    return round(performance.now() - this.startedAt);
  }

  get transcript(): TranscriptLine[] {
    return [...this.lines];
  }
}

/**
 * AUTH exchanges carry base64-encoded credentials on the wire. The transcript is
 * shown in the UI and written to logs, so the payload is stripped here — at the
 * only place that sees it — rather than trusting every consumer to filter.
 */
function redact(line: string): string {
  if (/^AUTH\s+(PLAIN|LOGIN)/i.test(line)) {
    return line.replace(/^(AUTH\s+\w+)(\s+.*)?$/i, '$1 [redacted]');
  }
  // Bare base64 continuation lines of an AUTH LOGIN handshake.
  if (/^[A-Za-z0-9+/]{16,}={0,2}$/.test(line.trim())) return '[redacted]';
  return line;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
