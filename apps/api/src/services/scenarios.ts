/**
 * Scenario reads and the coordinator-facing snapshot view.
 *
 * The view recomputes on every request from the stored scenario plus the stored
 * events: nothing is cached, so what the coordinator sees is always the current
 * revision. Recomputing is cheap for one station and one turnaround.
 */
import {
  decide,
  DETERMINISTIC_PROVIDER,
  hashValue,
  sha256Hex,
  shortHash,
  type CandidateEvaluation,
  type Decision,
  type EventRequest,
  type Evidence,
  type Policy,
  type ProviderInfo,
  type ProviderMode,
  type Scenario,
  type TurnaroundEvent,
} from '@turnproof/domain';
import { providerInfo, LIVE_DESCRIPTOR } from '@turnproof/adapters';
import type { DatabaseSync } from 'node:sqlite';
import { loadPolicy } from '../../../../fixtures/loader.js';
import { notFound, revisionConflict, unsupportedUpdate } from '../errors.js';
import { nowIso, withTransaction } from '../storage/db.js';
import {
  getScenarioPayload,
  getScenarioRevision,
  latestComputedDecision,
  listScenarioRows,
  saveScenario,
  seedEvent,
  seedEvidence,
} from '../storage/repository.js';

export type ScenarioSummary = {
  id: string;
  label: string;
  category: string;
  station: string;
  flightNumber: string;
  aircraft: string;
  plannedStartAt: string;
  plannedReadyAt: string;
  revision: number;
  policyId: string;
  dataProvenance: string;
};

export function listScenarios(db: DatabaseSync): ScenarioSummary[] {
  return listScenarioRows(db).map((row) => {
    const scenario = JSON.parse(String(row.payload)) as Scenario;
    return {
      id: scenario.id,
      label: scenario.label,
      category: scenario.category,
      station: scenario.turnaround.station,
      flightNumber: scenario.turnaround.flightNumber,
      aircraft: scenario.turnaround.aircraft,
      plannedStartAt: scenario.turnaround.plannedStartAt,
      plannedReadyAt: scenario.turnaround.plannedReadyAt,
      revision: Number(row.revision),
      policyId: scenario.policyId,
      dataProvenance: scenario.dataProvenance,
    };
  });
}

export function loadScenarioOrThrow(db: DatabaseSync, id: string): Scenario {
  const scenario = getScenarioPayload(db, id);
  if (!scenario) throw notFound(`Unknown scenario "${id}".`);
  return scenario;
}

/** Falls back to the default policy if a scenario names one that is not committed. */
export function policyFor(scenario: Scenario): Policy {
  try {
    return loadPolicy(scenario.policyId);
  } catch {
    return loadPolicy('policy-default');
  }
}

export type SerializedEvaluation = {
  candidate: CandidateEvaluation['candidate'];
  feasible: boolean;
  reasonCodes: string[];
  constraints: CandidateEvaluation['constraints'];
  violations: Array<{ code: string; message: string; taskId?: string; resourceId?: string }>;
  evidenceWarnings: string[];
  requiresReview: boolean;
  projectedDelayMin: number | null;
  projectedRecoveryMin: number | null;
  schedule: CandidateEvaluation['schedule'];
};

export function serializeEvaluation(evaluation: CandidateEvaluation): SerializedEvaluation {
  return {
    candidate: evaluation.candidate,
    feasible: evaluation.feasible,
    reasonCodes: [...evaluation.reasonCodes],
    constraints: evaluation.constraints,
    violations: evaluation.violations.map((v) => ({
      code: v.code,
      message: v.message,
      taskId: v.taskId,
      resourceId: v.resourceId,
    })),
    evidenceWarnings: [...evaluation.evidenceWarnings],
    requiresReview: evaluation.requiresReview,
    projectedDelayMin: evaluation.projectedDelayMin,
    projectedRecoveryMin: evaluation.projectedRecoveryMin,
    schedule: evaluation.schedule,
  };
}

export type SnapshotView = {
  scenario: Scenario;
  snapshot: unknown;
  baseline: unknown;
  baselineDelayMin: number | null;
  candidates: SerializedEvaluation[];
  decision: Decision;
  provider: ProviderInfo;
  replayOfDecisionId?: string;
  usedDeterministicFallback: boolean;
};

export type SnapshotViewArgs = {
  db: DatabaseSync;
  scenarioId: string;
  providerMode?: ProviderMode;
};

/**
 * Provider resolution for a *view*. Only `deterministic` has an implemented
 * compute path; `replay` can surface a recorded decision, and `live` is
 * reported unavailable while still showing the deterministic computation so the
 * board stays usable offline.
 */
function resolveViewProvider(db: DatabaseSync, scenarioId: string, mode: ProviderMode): {
  provider: ProviderInfo;
  computeWith: ProviderInfo;
  replayOfDecisionId?: string;
  usedDeterministicFallback: boolean;
} {
  if (mode === 'deterministic') {
    return { provider: DETERMINISTIC_PROVIDER, computeWith: DETERMINISTIC_PROVIDER, usedDeterministicFallback: false };
  }
  if (mode === 'replay') {
    const recorded = latestComputedDecision(db, scenarioId);
    if (recorded) {
      return {
        provider: providerInfo('replay', 'available'),
        computeWith: DETERMINISTIC_PROVIDER,
        replayOfDecisionId: recorded.decision.id,
        usedDeterministicFallback: false,
      };
    }
    return {
      provider: providerInfo(
        'replay',
        'unavailable',
        'No recorded run for this scenario yet, so there is nothing to replay. Showing a freshly computed deterministic decision instead.',
      ),
      computeWith: DETERMINISTIC_PROVIDER,
      usedDeterministicFallback: true,
    };
  }
  return {
    provider: providerInfo('live', 'unavailable', LIVE_DESCRIPTOR.detail),
    computeWith: DETERMINISTIC_PROVIDER,
    usedDeterministicFallback: true,
  };
}

export function buildSnapshotView(args: SnapshotViewArgs): SnapshotView {
  const scenario = loadScenarioOrThrow(args.db, args.scenarioId);
  const policy = policyFor(scenario);
  const mode = args.providerMode ?? 'deterministic';
  const resolved = resolveViewProvider(args.db, scenario.id, mode);
  const now = nowIso();

  const run = decide({ scenario, policy, now, provider: resolved.computeWith });

  let decision = run.decision;
  let replayOfDecisionId = resolved.replayOfDecisionId;

  if (mode === 'replay' && replayOfDecisionId) {
    const recorded = latestComputedDecision(args.db, scenario.id);
    if (recorded) {
      decision = {
        ...recorded.decision,
        providerMode: 'replay',
        providerStatus: 'available',
        providerName: 'replay',
      };
      replayOfDecisionId = recorded.decision.id;
    }
  } else if (mode === 'live') {
    decision = {
      ...decision,
      providerMode: 'live',
      providerStatus: 'unavailable',
      providerName: 'live',
    };
  } else if (mode === 'replay') {
    decision = {
      ...decision,
      providerMode: 'replay',
      providerStatus: 'unavailable',
      providerName: 'replay',
    };
  }

  return {
    scenario,
    snapshot: run.snapshot,
    baseline: run.baseline,
    baselineDelayMin: run.baselineDelayMin,
    candidates: run.evaluations.map(serializeEvaluation),
    decision,
    provider: resolved.provider,
    replayOfDecisionId,
    usedDeterministicFallback: resolved.usedDeterministicFallback,
  };
}

export type AppendEventResult = {
  scenario: Scenario;
  revision: number;
};

/**
 * Append a coordinator-supplied update.
 *
 * Only manual, unverified evidence can be appended: the endpoint never writes
 * into an authorized source of record. The target must already exist in the
 * scenario, so an update cannot invent a task or a ground unit.
 */
export function appendEvent(args: {
  db: DatabaseSync;
  scenarioId: string;
  body: EventRequest;
}): AppendEventResult {
  const { db, scenarioId, body } = args;
  const scenario = loadScenarioOrThrow(db, scenarioId);
  const storedRevision = getScenarioRevision(db, scenarioId) ?? 0;

  if (body.expectedRevision !== storedRevision) {
    throw revisionConflict(
      `Scenario "${scenarioId}" is at revision ${storedRevision}, not ${body.expectedRevision}. Refusing a stale write.`,
    );
  }

  const targetIsTask = scenario.tasks.some((t) => t.id === body.targetId);
  const targetIsResource = scenario.resources.some((r) => r.id === body.targetId);
  if (!targetIsTask && !targetIsResource) {
    throw unsupportedUpdate(
      `Unknown update target "${body.targetId}".`,
      'An update may only reference a task or resource that already exists in the scenario.',
    );
  }

  const nextRevision = storedRevision + 1;
  const evidence: Evidence = {
    id: `ev-api-${shortHash({ scenarioId, targetId: body.targetId, occurredAt: body.occurredAt, content: body.content }).slice(0, 12)}`,
    sourceId: 'coordinator-entry',
    sourceKind: 'manual',
    observedAt: body.occurredAt,
    ingestedAt: body.ingestedAt,
    content: body.content,
    contentHash: sha256Hex(body.content),
    trust: 'unverified',
  };

  const event: TurnaroundEvent = {
    id: `evt-api-${shortHash({ scenarioId, nextRevision, targetId: body.targetId, field: body.field, value: body.value }).slice(0, 12)}`,
    revision: nextRevision,
    occurredAt: body.occurredAt,
    ingestedAt: body.ingestedAt,
    kind: body.kind,
    targetId: body.targetId,
    field: body.field,
    value: body.value,
    evidenceId: evidence.id,
    sourceLabel: body.sourceLabel ?? 'Coordinator entry',
  };

  const updated: Scenario = {
    ...scenario,
    evidence: [...scenario.evidence, evidence],
    events: [...scenario.events, event],
  };

  withTransaction(db, () => {
    saveScenario(db, updated, nextRevision, nowIso());
    seedEvidence(db, scenarioId, evidence);
    seedEvent(db, scenarioId, event);
  });

  return { scenario: updated, revision: nextRevision };
}

/** Stable request hash used for idempotency comparison. */
export function requestHashFor(payload: unknown): string {
  return hashValue(payload);
}
