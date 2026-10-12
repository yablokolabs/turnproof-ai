/**
 * Adapter contracts. These are *internal* interfaces for this prototype, not
 * claims about any sponsor SDK. `collectEvidence()` and `rankCandidates()` are
 * our own shapes.
 *
 * Honesty rules enforced here:
 * - A provider is only `available` when a real, implemented path exists behind it.
 * - Sponsor adapters stay `unavailable` until official capabilities, access,
 *   contracts, and real calls have been verified.
 * - A replay is `available` but always labelled `replay`; it never claims live use.
 */
import type { ProviderInfo } from '@turnproof/domain';

export type ProviderMode = 'deterministic' | 'replay' | 'live';
export type AdapterKind = 'provider' | 'sponsor';
export type AdapterStatusValue = 'unavailable' | 'available' | 'error';

export type AdapterDescriptor = {
  id: string;
  name: string;
  kind: AdapterKind;
  mode: ProviderMode | 'none';
  status: AdapterStatusValue;
  /** Operator-facing explanation. Always states what is *not* proven. */
  detail: string;
  sourceUrl?: string;
  verifiedAt?: string;
};

export type AdapterCallResult<T> = {
  status: AdapterStatusValue;
  provider: string;
  mode: ProviderMode;
  observedAt: string;
  sourceIds: string[];
  requestHash: string;
  latencyMs: number;
  sanitizedResponseMetadata: Record<string, unknown>;
  data?: T;
  error?: string;
};

export const DETERMINISTIC_DESCRIPTOR: AdapterDescriptor = {
  id: 'deterministic',
  name: 'Deterministic rules',
  kind: 'provider',
  mode: 'deterministic',
  status: 'available',
  detail:
    'Dependency engine and hard-constraint gate implemented in this repository. Rule-based, not model inference. No network access.',
};

export const REPLAY_DESCRIPTOR: AdapterDescriptor = {
  id: 'replay',
  name: 'Recorded replay',
  kind: 'provider',
  mode: 'replay',
  status: 'available',
  detail:
    'Returns a previously recorded decision for the same scenario from local SQLite. Labelled as replay everywhere it appears. A replay does not demonstrate a live provider.',
};

export const LIVE_DESCRIPTOR: AdapterDescriptor = {
  id: 'live',
  name: 'Live AI provider',
  kind: 'provider',
  mode: 'live',
  status: 'unavailable',
  detail:
    'Unimplemented. No live model provider contract has been verified: no documented endpoint, structured-output guarantee, authentication model, rate limit, or account access. Live extraction and live ranking are therefore reported as unimplemented rather than stubbed.',
};

export const ANAKIN_DESCRIPTOR: AdapterDescriptor = {
  id: 'anakin',
  name: 'Anakin',
  kind: 'sponsor',
  mode: 'none',
  status: 'unavailable',
  detail:
    'Competition attachment describes a web-interaction API/MCP. Official documentation, endpoint, permission model, pricing, rate limits, retention, and account access were NOT verified in this session, so no adapter is implemented and no call is possible.',
};

export const JEV_DESCRIPTOR: AdapterDescriptor = {
  id: 'jev',
  name: 'Jev (TypeSafe AI)',
  kind: 'sponsor',
  mode: 'none',
  status: 'unavailable',
  detail:
    'Competition attachment describes a "System One" decision model. Official interface, input limits, output format, latency, and permitted use were NOT verified, so no adapter is implemented and no call is possible.',
};

export const PROVIDER_DESCRIPTORS: Record<ProviderMode, AdapterDescriptor> = {
  deterministic: DETERMINISTIC_DESCRIPTOR,
  replay: REPLAY_DESCRIPTOR,
  live: LIVE_DESCRIPTOR,
};

export const SPONSOR_DESCRIPTORS: AdapterDescriptor[] = [ANAKIN_DESCRIPTOR, JEV_DESCRIPTOR];

export function listAdapters(): AdapterDescriptor[] {
  return [...Object.values(PROVIDER_DESCRIPTORS), ...SPONSOR_DESCRIPTORS];
}

/** Map a descriptor onto the domain-level provider record stored with a decision. */
export function providerInfo(mode: ProviderMode, overrideStatus?: AdapterStatusValue, detail?: string): ProviderInfo {
  const descriptor = PROVIDER_DESCRIPTORS[mode];
  return {
    name: descriptor.id,
    mode,
    status: overrideStatus ?? descriptor.status,
    detail: detail ?? descriptor.detail,
  };
}

/** Never silently enable a provider whose contract is unverified. */
export function assertProviderUsable(mode: ProviderMode): void {
  const descriptor = PROVIDER_DESCRIPTORS[mode];
  if (descriptor.status === 'unavailable') {
    throw new Error(`Provider "${mode}" is unavailable: ${descriptor.detail}`);
  }
}
