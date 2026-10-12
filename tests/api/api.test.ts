import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decide } from '@turnproof/domain';
import { loadPolicyFor, loadScenario } from '../../fixtures/loader.js';

let app: FastifyInstance;
let workDir: string;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'turnproof-api-'));
  const { buildApp } = await import('../../apps/api/src/app.js');
  app = await buildApp({ dbPath: join(workDir, 'test.sqlite'), seed: true, logger: false });
});

afterAll(async () => {
  if (app) await app.close();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

async function json<T>(response: { body: string }): Promise<T> {
  return JSON.parse(response.body) as T;
}

async function scenarioRevision(id: string): Promise<number> {
  const res = await app.inject({ method: 'GET', url: '/api/scenarios' });
  const body = await json<{ scenarios: Array<{ id: string; revision: number }> }>(res);
  const found = body.scenarios.find((s) => s.id === id);
  if (!found) throw new Error(`scenario ${id} missing`);
  return found.revision;
}

describe('GET /api/health', () => {
  it('reports health and honest adapter status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = await json<{
      status: string;
      solverVersion: string;
      adapters: Array<{ id: string; status: string }>;
    }>(res);
    expect(body.status).toBe('ok');
    expect(body.solverVersion).toContain('tp-solver');
    const byId = new Map(body.adapters.map((a) => [a.id, a.status]));
    expect(byId.get('deterministic')).toBe('available');
    expect(byId.get('replay')).toBe('available');
    expect(byId.get('live')).toBe('unavailable');
    expect(byId.get('anakin')).toBe('unavailable');
    expect(byId.get('jev')).toBe('unavailable');
  });
});

describe('GET /api/scenarios', () => {
  it('serves the three hero cases plus at least 30 generated scenarios', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios' });
    expect(res.statusCode).toBe(200);
    const body = await json<{ scenarios: Array<{ id: string }> }>(res);
    const ids = body.scenarios.map((s) => s.id);
    expect(ids).toContain('case-a');
    expect(ids).toContain('case-b');
    expect(ids).toContain('case-c');
    expect(ids.filter((id) => id.startsWith('gen-')).length).toBeGreaterThanOrEqual(30);
  });
});

describe('GET /api/scenarios/:id/snapshot', () => {
  it('returns the recommended alternate for case A', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/case-a/snapshot' });
    expect(res.statusCode).toBe(200);
    const body = await json<{
      baseline: { readyAt: string; projectedDelayMin: number };
      decision: { state: string; candidateId?: string; projectedDelayMin?: number };
      candidates: Array<{ candidate: { id: string }; feasible: boolean; reasonCodes: string[] }>;
    }>(res);
    expect(body.baseline.readyAt).toBe('2026-10-12T10:10:00Z');
    expect(body.decision.state).toBe('recommended');
    expect(body.decision.candidateId).toBe('use_alternate_resource:t-fuel:TANKER-2');
    expect(body.decision.projectedDelayMin).toBe(5);
    const rejected = body.candidates.find((c) => !c.feasible);
    expect(rejected?.reasonCodes).toContain('RESOURCE_RESERVED');
  });

  it('abstains on the contradictory scenario', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/case-c/snapshot' });
    const body = await json<{ decision: { state: string }; snapshot: { conflicts: unknown[] } }>(res);
    expect(body.decision.state).toBe('needs_review');
    expect(body.snapshot.conflicts.length).toBe(1);
  });

  it('marks live mode unavailable without pretending a provider call happened', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/scenarios/case-a/snapshot?providerMode=live',
    });
    const body = await json<{
      decision: { providerMode: string; providerStatus: string };
      provider: { status: string };
    }>(res);
    expect(body.decision.providerMode).toBe('live');
    expect(body.decision.providerStatus).toBe('unavailable');
    expect(body.provider.status).toBe('unavailable');
  });

  it('404s for an unknown scenario', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/nope/snapshot' });
    expect(res.statusCode).toBe(404);
    const body = await json<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('not_found');
  });
});

describe('POST /api/decisions', () => {
  it('persists a decision and returns an export packet', async () => {
    const revision = await scenarioRevision('case-a');
    const res = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { 'x-idempotency-key': 'api-test-a-1' },
      payload: { scenarioId: 'case-a', expectedRevision: revision, providerMode: 'deterministic' },
    });
    expect(res.statusCode).toBe(200);
    const body = await json<{
      decision: { id: string; state: string; candidateId?: string };
      packet: Record<string, unknown>;
    }>(res);
    expect(body.decision.state).toBe('recommended');
    for (const key of [
      'packetVersion',
      'generatedAt',
      'scenarioId',
      'snapshotHash',
      'policyVersion',
      'solverVersion',
      'providerMode',
      'providerStatus',
      'snapshot',
      'normalizedEvents',
      'evidence',
      'candidates',
      'constraintsByCandidate',
      'baselineSchedule',
      'candidateSchedule',
      'explanation',
      'reviewerChoice',
      'rejected',
      'timestamps',
      'hashes',
      'provenance',
    ]) {
      expect(Object.keys(body.packet)).toContain(key);
    }
  });

  it('rejects a stale revision with 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: { scenarioId: 'case-a', expectedRevision: 999, providerMode: 'deterministic' },
    });
    expect(res.statusCode).toBe(409);
    const body = await json<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('revision_conflict');
  });

  it('replays an identical idempotent request and conflicts on a different payload', async () => {
    const revision = await scenarioRevision('case-a');
    const first = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { 'x-idempotency-key': 'api-test-dup' },
      payload: { scenarioId: 'case-a', expectedRevision: revision, providerMode: 'deterministic' },
    });
    const firstBody = await json<{ decision: { id: string }; idempotentReplay: boolean }>(first);
    expect(firstBody.idempotentReplay).toBe(false);

    const second = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { 'x-idempotency-key': 'api-test-dup' },
      payload: { scenarioId: 'case-a', expectedRevision: revision, providerMode: 'deterministic' },
    });
    const secondBody = await json<{ decision: { id: string }; idempotentReplay: boolean }>(second);
    expect(second.statusCode).toBe(200);
    expect(secondBody.decision.id).toBe(firstBody.decision.id);
    expect(secondBody.idempotentReplay).toBe(true);

    const conflicting = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { 'x-idempotency-key': 'api-test-dup' },
      payload: { scenarioId: 'case-a', expectedRevision: revision, providerMode: 'replay' },
    });
    expect(conflicting.statusCode).toBe(409);
    const conflictBody = await json<{ error: { code: string } }>(conflicting);
    expect(conflictBody.error.code).toBe('idempotency_conflict');
  });

  it('labels a replay as replay and points at the recorded decision', async () => {
    const revision = await scenarioRevision('case-a');
    const res = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: { scenarioId: 'case-a', expectedRevision: revision, providerMode: 'replay' },
    });
    expect(res.statusCode).toBe(200);
    const body = await json<{
      decision: { providerMode: string; providerStatus: string; id: string };
      replayOfDecisionId?: string;
    }>(res);
    expect(body.decision.providerMode).toBe('replay');
    expect(body.decision.providerStatus).toBe('available');
    expect(body.replayOfDecisionId).toBeTruthy();
    expect(body.decision.id).not.toBe(body.replayOfDecisionId);
  });

  it('validates the request body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: { scenarioId: 'case-a' },
    });
    expect(res.statusCode).toBe(400);
    const body = await json<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });
});

describe('reviews are append-only', () => {
  it('keeps both records and surfaces the latest as the reviewer choice', async () => {
    const revision = await scenarioRevision('case-b-wait');
    const created = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: { scenarioId: 'case-b-wait', expectedRevision: revision, providerMode: 'deterministic' },
    });
    const { decision } = await json<{ decision: { id: string } }>(created);

    const first = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decision.id}/reviews`,
      payload: { reviewer: 'Coordinator One', action: 'needs_review', note: 'Waiting is not acceptable; escalate.' },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = await json<{ review: { id: string; action: string } }>(first);
    expect(firstBody.review.action).toBe('needs_review');

    const second = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decision.id}/reviews`,
      payload: {
        reviewer: 'Coordinator Two',
        action: 'accept',
        note: 'Escalation returned no unit; waiting retained.',
        supersedes: firstBody.review.id,
      },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = await json<{ reviews: Array<{ id: string }> }>(second);
    expect(secondBody.reviews).toHaveLength(2);

    const record = await app.inject({ method: 'GET', url: `/api/decisions/${decision.id}` });
    const recordBody = await json<{ reviews: Array<{ action: string }> }>(record);
    expect(recordBody.reviews.map((r) => r.action)).toEqual(['needs_review', 'accept']);
  });

  it('404s for an unknown decision', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/decisions/dec_missing/reviews',
      payload: { reviewer: 'Nobody', action: 'accept', note: '' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/decisions/:id/export', () => {
  it('round-trips to the same deterministic schedule and contains no secrets', async () => {
    const revision = await scenarioRevision('case-a');
    const created = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: { scenarioId: 'case-a', expectedRevision: revision, providerMode: 'deterministic' },
    });
    const { decision } = await json<{ decision: { id: string } }>(created);

    const res = await app.inject({ method: 'GET', url: `/api/decisions/${decision.id}/export` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('turnproof-decision-');

    const packet = await json<{
      baselineSchedule: { tasks: Array<{ taskId: string; earliestStart: string; finish: string }> };
      snapshot: { tasks: unknown[] };
      provenance: { synthetic: boolean; advisoryOnly: boolean; operationalExecution: boolean };
      hashes: { evidence: Array<{ id: string; contentHash: string }> };
    }>(res);

    expect(packet.provenance).toEqual({
      dataProvenance: expect.any(String),
      synthetic: true,
      advisoryOnly: true,
      operationalExecution: false,
    });

    // Re-import: recompute from the fixture and compare the deterministic schedule.
    const scenario = loadScenario('case-a');
    const replay = decide({ scenario, policy: loadPolicyFor(scenario), now: '2026-10-12T09:20:00Z' });
    expect(packet.baselineSchedule.tasks.map((t) => [t.taskId, t.earliestStart, t.finish])).toEqual(
      replay.baseline?.tasks.map((t) => [t.taskId, t.earliestStart, t.finish]),
    );

    for (const entry of packet.hashes.evidence) expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const serialized = JSON.stringify(packet).toLowerCase();
    for (const forbidden of ['password', 'secret', 'api_key', 'apikey', 'bearer ', 'ghp_', 'token=']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('POST /api/scenarios/:id/events', () => {
  it('appends an update with a revision precondition and rejects a stale one', async () => {
    const revision = await scenarioRevision('case-b');
    const payload = {
      expectedRevision: revision,
      occurredAt: '2026-10-12T09:16:00Z',
      ingestedAt: '2026-10-12T09:16:00Z',
      kind: 'note' as const,
      targetId: 't-fuel',
      field: 'note' as const,
      value: 'Coordinator note: awaiting confirmation from the fuel supervisor.',
      sourceLabel: 'Coordinator console',
      content: 'Coordinator note: awaiting confirmation from the fuel supervisor.',
    };
    const ok = await app.inject({
      method: 'POST',
      url: '/api/scenarios/case-b/events',
      payload,
    });
    if (ok.statusCode !== 200) throw new Error(`event append failed: ${ok.body}`);
    const body = await json<{ revision: number; decision: { state: string } }>(ok);
    expect(body.revision).toBe(revision + 1);
    expect(body.decision.state).toBe('no_feasible_option');

    const stale = await app.inject({
      method: 'POST',
      url: '/api/scenarios/case-b/events',
      payload,
    });
    expect(stale.statusCode).toBe(409);
    const staleBody = await json<{ error: { code: string } }>(stale);
    expect(staleBody.error.code).toBe('revision_conflict');
  });
});
