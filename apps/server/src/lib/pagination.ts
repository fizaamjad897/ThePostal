import { BadRequestError } from './errors.js';

/**
 * Opaque keyset cursor. Offset pagination drifts when rows are inserted between
 * page loads — which is exactly what a live mailbox does — so pages are anchored
 * to the (createdAt, _id) of the last item instead. The composite key breaks
 * ties between messages created in the same millisecond.
 */
export interface Cursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Cursor).createdAt !== 'string' ||
      typeof (parsed as Cursor).id !== 'string'
    ) {
      throw new Error('malformed cursor payload');
    }
    return parsed as Cursor;
  } catch (cause) {
    throw new BadRequestError('Invalid pagination cursor', { cause: String(cause) });
  }
}
