import { Types, type PipelineStage } from 'mongoose';
import type { SmtpPhase, StatsSummary } from '@postal/shared';
import { SMTP_PHASE } from '@postal/shared';
import { MessageModel } from '../../models/message.model.js';

/**
 * Delivery analytics for one user over a rolling window.
 *
 * Every figure is computed inside MongoDB rather than by loading documents and
 * reducing in Node. With attempt arrays embedded in each message, pulling a
 * month of mail into memory to average a latency would be several megabytes of
 * transfer to produce one number.
 */
export async function getStatsSummary(ownerId: string, windowHours = 24): Promise<StatsSummary> {
  const owner = new Types.ObjectId(ownerId);
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  const match = { owner, createdAt: { $gte: since } };

  const [totals, latency, phases, throughput] = await Promise.all([
    countsByStatus(match),
    latencyPercentiles(match),
    phaseBreakdown(match),
    throughputBuckets(match, windowHours),
  ]);

  const attempted = totals.sent + totals.failed;

  return {
    totals,
    // Delivery rate is over settled messages only. Counting still-queued mail as
    // a failure would make the rate dip every time a burst is submitted, which
    // reads as an incident when nothing is wrong.
    deliveryRate: attempted === 0 ? 1 : totals.sent / attempted,
    latency,
    phaseBreakdownMs: phases,
    throughput,
    windowHours,
  };
}

async function countsByStatus(match: object): Promise<StatsSummary['totals']> {
  const rows = await MessageModel.aggregate<{ _id: string; count: number }>([
    { $match: match },
    { $group: { _id: { $concat: ['$status', ':', '$folder'] }, count: { $sum: 1 } } },
  ]);

  const totals = { queued: 0, sent: 0, deferred: 0, failed: 0, received: 0 };

  for (const row of rows) {
    const [status = '', folder = ''] = row._id.split(':');
    // Inbound mail is stored with status `sent` in the inbox folder; counting it
    // as an outbound success would inflate the delivery rate with mail we never
    // sent, so it is reported separately.
    if (folder === 'inbox') {
      totals.received += row.count;
      continue;
    }
    if (status in totals) totals[status as keyof typeof totals] += row.count;
  }

  return totals;
}

async function latencyPercentiles(match: object): Promise<StatsSummary['latency']> {
  // $percentile with the "approximate" method is a t-digest: constant memory
  // regardless of how many attempts are in the window, which an exact sort is
  // not. The error is well under a millisecond at these magnitudes.
  // `$percentile` is a MongoDB 7.0 accumulator that Mongoose's pipeline types do
  // not yet describe, hence the cast on this stage only.
  const percentileStage = {
    $group: {
      _id: null,
      p50: { $percentile: { input: '$attempts.trace.totalMs', p: [0.5], method: 'approximate' } },
      p95: { $percentile: { input: '$attempts.trace.totalMs', p: [0.95], method: 'approximate' } },
      p99: { $percentile: { input: '$attempts.trace.totalMs', p: [0.99], method: 'approximate' } },
    },
  } as unknown as PipelineStage;

  const [row] = await MessageModel.aggregate<{ p50: number[]; p95: number[]; p99: number[] }>([
    { $match: { ...match, status: 'sent' } },
    { $unwind: '$attempts' },
    { $match: { 'attempts.status': 'sent', 'attempts.trace.totalMs': { $gt: 0 } } },
    percentileStage,
  ]);

  return {
    p50Ms: round(row?.p50?.[0]),
    p95Ms: round(row?.p95?.[0]),
    p99Ms: round(row?.p99?.[0]),
  };
}

async function phaseBreakdown(match: object): Promise<StatsSummary['phaseBreakdownMs']> {
  const rows = await MessageModel.aggregate<{ _id: SmtpPhase; avgMs: number }>([
    { $match: { ...match, status: 'sent' } },
    { $unwind: '$attempts' },
    { $match: { 'attempts.trace': { $ne: null } } },
    { $unwind: '$attempts.trace.phases' },
    {
      $group: {
        _id: '$attempts.trace.phases.phase',
        avgMs: { $avg: '$attempts.trace.phases.durationMs' },
      },
    },
  ]);

  // Seed every phase at zero so the waterfall chart keeps a stable set of bars
  // even when a phase never ran (AUTH and TLS are both conditional).
  const breakdown = Object.fromEntries(SMTP_PHASE.map((phase) => [phase, 0])) as Record<
    SmtpPhase,
    number
  >;
  for (const row of rows) breakdown[row._id] = round(row.avgMs) ?? 0;
  return breakdown;
}

async function throughputBuckets(
  match: object,
  windowHours: number,
): Promise<StatsSummary['throughput']> {
  // Bucket width scales with the window so the series stays around 24-48 points:
  // hourly for a day, daily for a month. A fixed width would either be unreadably
  // dense or uselessly coarse at one end of the range.
  const unit = windowHours <= 48 ? 'hour' : 'day';

  const rows = await MessageModel.aggregate<{ _id: Date; sent: number; failed: number }>([
    { $match: { ...match, folder: { $ne: 'inbox' } } },
    {
      $group: {
        _id: { $dateTrunc: { date: '$createdAt', unit } },
        sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((row) => ({
    bucket: new Date(row._id).toISOString(),
    sent: row.sent,
    failed: row.failed,
  }));
}

function round(value: number | undefined): number | null {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  return Math.round(value * 100) / 100;
}
