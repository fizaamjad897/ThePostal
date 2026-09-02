import { promises as dns } from 'node:dns';
import { performance } from 'node:perf_hooks';
import { SmtpDeliveryError } from '../lib/errors.js';

export interface MxTarget {
  host: string;
  priority: number;
}

export interface MxLookupResult {
  targets: MxTarget[];
  lookupMs: number;
  /** True when no MX record existed and the A/AAAA record was used instead. */
  implicit: boolean;
  cached: boolean;
}

interface CacheEntry {
  targets: MxTarget[];
  implicit: boolean;
  expiresAt: number;
}

/**
 * MX results are cached in-process for a fixed window. Node's resolver does not
 * expose record TTLs through `resolveMx`, so rather than guess per-record we use
 * one conservative window — short enough that an MX cutover is picked up within
 * minutes, long enough that a burst of mail to one domain resolves once.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  if (at === -1 || at === address.length - 1) {
    throw new SmtpDeliveryError(`Address has no domain part: ${address}`, { permanent: true });
  }
  return address.slice(at + 1).toLowerCase();
}

/**
 * Resolve a domain to an ordered list of delivery targets.
 *
 * RFC 5321 §5.1: try MX records in ascending priority; if the domain has no MX
 * record but does have an address record, the domain itself is an implicit MX
 * at priority 0. Equal priorities should be tried in random order to spread load
 * across a pool, which is why ties are shuffled rather than left in DNS order.
 */
export async function resolveMx(domain: string): Promise<MxLookupResult> {
  const cached = cache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    return { targets: cached.targets, lookupMs: 0, implicit: cached.implicit, cached: true };
  }

  const start = performance.now();
  let targets: MxTarget[] = [];
  let implicit = false;

  try {
    const records = await dns.resolveMx(domain);
    targets = records
      .map((r) => ({ host: r.exchange.toLowerCase(), priority: r.priority }))
      .sort((a, b) => a.priority - b.priority || (Math.random() < 0.5 ? -1 : 1));
  } catch {
    // ENOTFOUND/ENODATA here is not yet fatal — fall through to the A record.
    targets = [];
  }

  if (targets.length === 0) {
    try {
      await dns.lookup(domain);
      targets = [{ host: domain, priority: 0 }];
      implicit = true;
    } catch (cause) {
      throw new SmtpDeliveryError(`No MX or address record for ${domain}`, {
        permanent: true,
        cause,
      });
    }
  }

  // A single "null MX" (RFC 7505) is an explicit statement that the domain
  // accepts no mail. Retrying it would burn every attempt on a guaranteed
  // failure, so it is classified permanent immediately.
  if (targets.length === 1 && targets[0]!.host === '') {
    throw new SmtpDeliveryError(`${domain} advertises a null MX and accepts no mail`, {
      permanent: true,
    });
  }

  const lookupMs = Math.round((performance.now() - start) * 1000) / 1000;
  cache.set(domain, { targets, implicit, expiresAt: Date.now() + CACHE_TTL_MS });

  return { targets, lookupMs, implicit, cached: false };
}

/** Exposed for tests and for an operator-triggered cache flush. */
export function clearMxCache(): void {
  cache.clear();
}
