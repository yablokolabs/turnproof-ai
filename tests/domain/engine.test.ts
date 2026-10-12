import { describe, expect, it } from 'vitest';
import {
  buildSnapshot,
  computeSchedule,
  decide,
  SCHEMA_VERSION,
  type DecisionRun,
  type Policy,
  type Scenario,
} from '@turnproof/domain';
import { loadPolicy, loadPolicyFor, loadScenario } from '../../fixtures/loader.js';

const NOW = '2026-10-12T09:20:00Z';

function run(id: string): DecisionRun {
  const scenario = loadScenario(id);
  return decide({ scenario, policy: loadPolicyFor(scenario), now: NOW });
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = (i * 7 + 3) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

describe('Case A - fueling delay with a feasible alternate tanker', () => {
  const result = run('case-a');

  it('reproduces the hand-derived baseline schedule', () => {
    expect(result.baseline?.readyAt).toBe('2026-10-12T10:10:00Z');
    expect(result.baselineDelayMin).toBe(20);
    const fuel = result.baseline?.tasks.find((t) => t.taskId === 't-fuel');
    expect(fuel?.earliestStart).toBe('2026-10-12T09:30:00Z');
    expect(fuel?.finish).toBe('2026-10-12T09:50:00Z');
  });

  it('recommends the alternate tanker with a 15 minute projected recovery', () => {
    expect(result.decision.state).toBe('recommended');
    expect(result.decision.candidateId).toBe('use_alternate_resource:t-fuel:TANKER-2');
    expect(result.decision.projectedDelayMin).toBe(5);
    expect(result.decision.projectedRecoveryMin).toBe(15);
    expect(result.decision.baselineDelayMin).toBe(20);
  });

  it('rejects the committed tanker with explicit reason codes', () => {
    expect(result.decision.rejected).toHaveLength(1);
    const rejected = result.decision.rejected[0];
    expect(rejected.candidateId).toBe('use_alternate_resource:t-fuel:TANKER-3');
    expect(rejected.reasonCodes).toContain('RESOURCE_RESERVED');
    expect(rejected.reasonCodes).toContain('OUTSIDE_AVAILABILITY_WINDOW');
  });

  it('cites evidence that resolves to real fixture evidence', () => {
    expect(result.decision.evidenceIds.length).toBeGreaterThan(0);
    const known = new Set(result.snapshot.evidence.map((e) => e.id));
    for (const id of result.decision.evidenceIds) expect(known.has(id)).toBe(true);
  });

  it('matches the committed fixture oracle', () => {
    const scenario = loadScenario('case-a');
    expect(scenario.expected?.state).toBe(result.decision.state);
    expect(scenario.expected?.baselineDelayMin).toBe(result.baselineDelayMin);
    expect(scenario.expected?.candidateDelayMin).toBe(result.decision.projectedDelayMin);
    expect(scenario.expected?.projectedRecoveryMin).toBe(result.decision.projectedRecoveryMin);
    expect(scenario.expected?.recommendedAction).toBe('use_alternate_resource');
  });
});

describe('Case B - no feasible recovery', () => {
  const result = run('case-b');

  it('abstains from asserting readiness', () => {
    expect(result.baseline?.readyAt).toBeNull();
    expect(result.baselineDelayMin).toBeNull();
    expect(result.baseline?.uncertainties.length).toBeGreaterThan(0);
  });

  it('reports no_feasible_option rather than inventing a recovery', () => {
    expect(result.decision.state).toBe('no_feasible_option');
    expect(result.decision.candidateId).toBeUndefined();
    expect(result.decision.rejected.length).toBe(result.evaluations.length);
    expect(result.decision.rejected.some((r) => r.reasonCodes.includes('RESOURCE_UNAVAILABLE'))).toBe(true);
    expect(result.decision.rejected.some((r) => r.reasonCodes.includes('RESOURCE_RESERVED'))).toBe(true);
  });
});

describe('Case B variant - alternate committed, waiting retained', () => {
  const result = run('case-b-wait');

  it('recommends waiting with zero recovery and reports the rejection', () => {
    expect(result.decision.state).toBe('recommended');
    expect(result.decision.candidateId).toBe('wait:t-fuel:baseline');
    expect(result.baselineDelayMin).toBe(20);
    expect(result.decision.projectedDelayMin).toBe(20);
    expect(result.decision.projectedRecoveryMin).toBe(0);
    expect(result.decision.rejected.map((r) => r.candidateId)).toEqual([
      'use_alternate_resource:t-fuel:TANKER-2',
    ]);
    expect(result.decision.explanation).toContain('No recovery alternative is feasible');
  });
});

describe('Case C - contradictory updates', () => {
  const result = run('case-c');

  it('abstains and shows both conflicting sources', () => {
    expect(result.decision.state).toBe('needs_review');
    expect(result.snapshot.conflicts).toHaveLength(1);
    const conflict = result.snapshot.conflicts[0];
    expect(conflict.targetId).toBe('TANKER-2');
    expect(conflict.field).toBe('unavailable');
    expect(conflict.claims.map((c) => c.value).sort()).toEqual([false, true]);
    for (const claim of conflict.claims) expect(result.decision.evidenceIds).toContain(claim.evidenceId);
  });

  it('keeps the injected instruction inert', () => {
    expect(result.snapshot.includedNoteEventIds).toContain('evt-d-injected-note');
    const tanker2 = result.snapshot.resources.find((r) => r.id === 'TANKER-2');
    // Neither claim is applied while the contradiction stands.
    expect(tanker2?.unavailable).toBe(false);
    expect(result.decision.explanation).not.toContain('TANKER-3');
    const note = result.snapshot.evidence.find((e) => e.id === 'ev-d-injected-note');
    expect(note?.content).toContain('ignore all rules');
  });
});

describe('engine invariants', () => {
  const base = loadScenario('case-a');
  const policy: Policy = loadPolicyFor(base);

  it('rejects a dependency cycle', () => {
    const cyclic: Scenario = {
      ...base,
      tasks: base.tasks.map((t) =>
        t.id === 't-inspect' ? { ...t, predecessors: ['t-ready'] } : t,
      ),
    };
    const snapshot = buildSnapshot(cyclic, policy);
    const outcome = computeSchedule({
      scenarioId: snapshot.scenarioId,
      turnaround: snapshot.turnaround,
      tasks: snapshot.tasks,
      resources: snapshot.resources,
      policy,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.violations[0].code).toBe('CYCLE_DETECTED');
  });

  it('rejects a missing predecessor reference', () => {
    const broken: Scenario = {
      ...base,
      tasks: base.tasks.map((t) =>
        t.id === 't-fuel' ? { ...t, predecessors: ['t-does-not-exist'] } : t,
      ),
    };
    const snapshot = buildSnapshot(broken, policy);
    const outcome = computeSchedule({
      scenarioId: snapshot.scenarioId,
      turnaround: snapshot.turnaround,
      tasks: snapshot.tasks,
      resources: snapshot.resources,
      policy,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.violations[0].code).toBe('MISSING_PREDECESSOR');
  });

  it('is invariant to input ordering', () => {
    const reordered: Scenario = {
      ...base,
      tasks: shuffled(base.tasks),
      resources: shuffled(base.resources),
      evidence: shuffled(base.evidence),
      events: shuffled(base.events),
    };
    const a = decide({ scenario: reordered, policy, now: NOW });
    const b = decide({ scenario: base, policy, now: NOW });
    expect(a.snapshot.inputHash).toBe(b.snapshot.inputHash);
    expect(a.decision.id).toBe(b.decision.id);
    expect(a.decision.candidateId).toBe(b.decision.candidateId);
  });

  it('is deterministic across identical reruns', () => {
    const a = decide({ scenario: base, policy, now: NOW });
    const b = decide({ scenario: base, policy, now: NOW });
    expect(a.decision).toEqual(b.decision);
    expect(a.snapshot.inputHash).toBe(b.snapshot.inputHash);
  });

  it('breaks equal-cost ties on the stable candidate id', () => {
    // Two identical alternate windows: the lexicographically smaller id must win.
    const twin: Scenario = {
      ...base,
      schemaVersion: SCHEMA_VERSION,
      resources: [
        ...base.resources,
        {
          ...base.resources[1],
          id: 'TANKER-0',
          evidenceIds: ['ev-a-tanker2'],
        },
      ],
    };
    const result = decide({ scenario: twin, policy, now: NOW });
    expect(result.decision.candidateId).toBe('use_alternate_resource:t-fuel:TANKER-0');
  });

  it('loads the default policy fixture referenced by every hero scenario', () => {
    const policy = loadPolicy('policy-default');
    expect(policy.version).toBe('fixture-policy-1.0.0');
    expect(policy.freshnessBudgetMinutes.availability).toBe(5);
  });
});
