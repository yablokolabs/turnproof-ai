/**
 * Timestamp helpers. All timestamps are ISO-8601 UTC with a trailing `Z` and
 * second precision. Internal arithmetic uses epoch milliseconds.
 */

export function toEpoch(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Invalid ISO-8601 timestamp: ${iso}`);
  return ms;
}

/** Normalise any instant to canonical `YYYY-MM-DDTHH:MM:SSZ` (seconds, UTC). */
export function toIso(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid epoch milliseconds: ${ms}`);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export const MINUTE_MS = 60_000;

export function addMinutes(iso: string, minutes: number): string {
  return toIso(toEpoch(iso) + minutes * MINUTE_MS);
}

export function diffMinutes(fromIso: string, toIsoValue: string): number {
  return Math.round((toEpoch(toIsoValue) - toEpoch(fromIso)) / MINUTE_MS);
}

export function maxIso(values: string[]): string {
  if (values.length === 0) throw new Error('maxIso requires at least one timestamp');
  return toIso(Math.max(...values.map(toEpoch)));
}

export function minIso(values: string[]): string {
  if (values.length === 0) throw new Error('minIso requires at least one timestamp');
  return toIso(Math.min(...values.map(toEpoch)));
}

export function isBefore(a: string, b: string): boolean {
  return toEpoch(a) < toEpoch(b);
}

export function isAtOrBefore(a: string, b: string): boolean {
  return toEpoch(a) <= toEpoch(b);
}

/** Half-open interval overlap: [aStart, aEnd) vs [bStart, bEnd). */
export function intervalsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return toEpoch(aStart) < toEpoch(bEnd) && toEpoch(bStart) < toEpoch(aEnd);
}
