import { createHash } from 'node:crypto';

/** Recursively sort object keys so structurally equal values serialise identically. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortValue(v);
    return out;
  }
  return value;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Stable content hash of any JSON-serialisable value. */
export function hashValue(value: unknown): string {
  return sha256Hex(canonicalize(value));
}

/**
 * Short, human-checkable evidence fingerprint. A hash detects byte changes; it
 * does not establish source truth or tamper-resistant storage.
 */
export function shortHash(value: unknown, length = 12): string {
  return hashValue(value).slice(0, length);
}
