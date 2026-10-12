/** Display helpers. Timestamps are always shown in local readable form plus UTC. */

export function formatLocal(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatUtc(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return `${date.toISOString().replace(/\.\d{3}Z$/, 'Z')} UTC`;
}

export function formatBoth(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  return `${formatLocal(iso)} (${formatUtc(iso)})`;
}

export function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'unknown';
  if (value === 0) return '0 min';
  return `${value > 0 ? '+' : ''}${value} min`;
}

export function formatCostUnits(value: number): string {
  return `${value} synthetic cost units`;
}

export function formatDelayMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'readiness uncertain';
  return `${value} min late`;
}

export function shortenHash(hash: string, length = 16): string {
  return hash.length <= length ? hash : `${hash.slice(0, length)}...`;
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
