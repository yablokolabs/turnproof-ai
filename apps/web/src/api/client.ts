import type {
  Decision,
  DecisionPacket,
  HealthResponse,
  ProviderMode,
  ReviewResponse,
  SnapshotResponse,
} from '../types';

const BASE = '/api';

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: string;

  constructor(code: string, message: string, status: number, detail?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

type ErrorEnvelope = { error?: { code?: string; message?: string; detail?: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (init?.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const envelope = body as ErrorEnvelope | null;
    throw new ApiClientError(
      envelope?.error?.code ?? 'internal_error',
      envelope?.error?.message ?? `Request failed with HTTP ${response.status}`,
      response.status,
      envelope?.error?.detail,
    );
  }
  return body as T;
}

export function newIdempotencyKey(prefix = 'ui'): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return `${prefix}-${random}`;
}

export const api = {
  health(): Promise<HealthResponse> {
    return request<HealthResponse>('/health');
  },

  scenarios(): Promise<{ scenarios: SnapshotScenarioSummary[] }> {
    return request<{ scenarios: SnapshotScenarioSummary[] }>('/scenarios');
  },

  snapshot(scenarioId: string, providerMode: ProviderMode): Promise<SnapshotResponse> {
    const query = new URLSearchParams({ providerMode });
    return request<SnapshotResponse>(
      `/scenarios/${encodeURIComponent(scenarioId)}/snapshot?${query.toString()}`,
    );
  },

  createDecision(
    body: {
      scenarioId: string;
      expectedRevision: number;
      providerMode: ProviderMode;
      note?: string;
    },
    /**
     * Pass a stable key when the same logical decision may be requested more
     * than once (for example on every scenario reload) so the server can return
     * the already-recorded decision instead of writing a duplicate.
     */
    idempotencyKey: string = newIdempotencyKey('decision'),
  ): Promise<{ decision: Decision; packet: DecisionPacket }> {
    return request<{ decision: Decision; packet: DecisionPacket }>('/decisions', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'x-idempotency-key': idempotencyKey },
    });
  },

  createReview(
    decisionId: string,
    body: { reviewer: string; action: 'accept' | 'reject' | 'needs_review'; note: string },
  ): Promise<ReviewResponse> {
    return request<ReviewResponse>(`/decisions/${encodeURIComponent(decisionId)}/reviews`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'x-idempotency-key': newIdempotencyKey('review') },
    });
  },

  exportUrl(decisionId: string): string {
    return `${BASE}/decisions/${encodeURIComponent(decisionId)}/export`;
  },

  async exportPacket(decisionId: string): Promise<DecisionPacket> {
    return request<DecisionPacket>(`/decisions/${encodeURIComponent(decisionId)}/export`);
  },
};

/** Alias kept local so the client file does not import browser-unused domain types. */
export type SnapshotScenarioSummary = import('../types').ScenarioSummary;
