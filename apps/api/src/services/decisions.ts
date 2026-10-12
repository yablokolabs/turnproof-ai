/**
 * Decision recording.
 *
 * The snapshot, the decision and the adapter run are written in one
 * transaction: a decision may never exist without the provenance that explains
 * it. Idempotency is scoped to route + scenario, because the same client key on
 * a different scenario is a different intention.
 */
import {
  decide,
  DETERMINISTIC_PROVIDER,
  hashValue,
  shortHash,
  type Decision,
  type DecisionRequest,
  type Policy,
  type ProviderInfo,
  type Scenario,
  type Snapshot,
} from '@turnproof/domain';
import { LIVE_DESCRIPTOR, providerInfo } from '@turnproof/adapters';
import type { DatabaseSync } from 'node:sqlite';
import { idempotencyConflict, notFound, revisionConflict } from '../errors.js';
import { nowIso, withTransaction } from '../storage/db.js';
import {
  findDecisionByIdempotency,
  getDecision,
  getScenarioRevision,
  latestComputedDecision,
  listReviews,
  saveAdapterRun,
  saveDecision,
  saveSnapshot,
} from '../storage/repository.js';
import {
  loadScenarioOrThrow,
  policyFor,
  serializeEvaluation,
  type SerializedEvaluation,
} from './scenarios.js';

export const PACKET_VERSION = 'turnproof-packet-1.0.0';

export type ExportPacket = {
  packetVersion: string;
  generatedAt: string;
  scenarioId: string;
  snapshotHash: string;
  policyVersion: string;
  solverVersion: string;
  providerMode: string;
  providerStatus: string;
  providerName?: string;
  snapshot: Snapshot;
  normalizedEvents: unknown[];
  evidence: unknown[];
  candidates: SerializedEvaluation[];
  constraintsByCandidate: Array<{ candidateId: string; constraints: SerializedEvaluation['constraints'] }>;
  baselineSchedule: unknown;
  candidateSchedule: unknown;
  explanation: string;
  reviewerChoice: unknown;
  rejected: unknown;
  timestamps: { asOf: string; decisionCreatedAt: string; replayedAt?: string };
  hashes: { snapshotHash: string; evidence: Array<{ id: string; contentHash: string }> };
  provenance: {
    dataProvenance: string;
    synthetic: boolean;
    advisoryOnly: boolean;
    operationalExecution: boolean;
  };
  replayOfDecisionId?: string;
};

export type BuildPacketArgs = {
  snapshot: Snapshot;
  scenario: Scenario;
  policy: Policy;
  evaluations: SerializedEvaluation[];
  decision: Decision;
  baselineSchedule: unknown;
  generatedAt: string;
};

export function buildExportPacket(args: BuildPacketArgs): ExportPacket {
  const { snapshot, scenario, policy, evaluations, decision } = args;
  const chosen = evaluations.find((e) => e.candidate.id === decision.candidateId);

  return {
    packetVersion: PACKET_VERSION,
    generatedAt: args.generatedAt,
    scenarioId: scenario.id,
    snapshotHash: decision.snapshotHash,
    policyVersion: decision.policyVersion,
    solverVersion: decision.solverVersion,
    providerMode: decision.providerMode,
    providerStatus: decision.providerStatus,
    providerName: decision.providerName,
    snapshot,
    normalizedEvents: snapshot.events,
    evidence: snapshot.evidence,
    candidates: evaluations,
    constraintsByCandidate: evaluations.map((e) => ({
      candidateId: e.candidate.id,
      constraints: e.constraints,
    })),
    baselineSchedule: args.baselineSchedule,
    candidateSchedule: chosen?.schedule ?? null,
    explanation: decision.explanation,
    reviewerChoice: null,
    rejected: decision.rejected,
    timestamps: { asOf: snapshot.asOf, decisionCreatedAt: decision.createdAt },
    hashes: {
      snapshotHash: decision.snapshotHash,
      evidence: snapshot.evidence.map((e) => ({ id: e.id, contentHash: e.contentHash })),
    },
    provenance: {
      dataProvenance: scenario.dataProvenance,
      synthetic: true,
      advisoryOnly: true,
      operationalExecution: false,
    },
  };
}

export function decisionsScope(scenarioId: string): string {
  return `POST /api/decisions:${scenarioId}`;
}

export type RecordDecisionArgs = {
  db: DatabaseSync;
  body: DecisionRequest;
  idempotencyKey?: string | null;
};

export type RecordDecisionResult = {
  decision: Decision;
  packet: ExportPacket;
  replayOfDecisionId?: string;
  idempotentReplay: boolean;
};

export function recordDecision(args: RecordDecisionArgs): RecordDecisionResult {
  const { db, body } = args;
  const startedAt = Date.now();
  const now = nowIso();

  const scenario = loadScenarioOrThrow(db, body.scenarioId);
  const storedRevision = getScenarioRevision(db, body.scenarioId) ?? 0;
  if (body.expectedRevision !== storedRevision) {
    throw revisionConflict(
      `Scenario "${body.scenarioId}" is at revision ${storedRevision}, not ${body.expectedRevision}. Refusing a stale write.`,
    );
  }

  const key = args.idempotencyKey ?? null;
  const scope = decisionsScope(body.scenarioId);
  const requestHash = hashValue({
    scenarioId: body.scenarioId,
    expectedRevision: body.expectedRevision,
    providerMode: body.providerMode,
    note: body.note ?? null,
  });

  // Same key + byte-identical payload replays the stored answer; same key with
  // a different payload is a client bug and must not be silently accepted.
  if (key) {
    const existing = findDecisionByIdempotency(db, scope, key);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw idempotencyConflict(
          `Idempotency key "${key}" was already used on this scenario with a different payload.`,
        );
      }
      return {
        decision: existing.decision,
        packet: existing.packet as ExportPacket,
        idempotentReplay: true,
      };
    }
  }

  const policy = policyFor(scenario);

  const persist = (
    decision: Decision,
    packet: ExportPacket,
    options: { snapshot?: Snapshot; snapshotRevision: number; evaluations: SerializedEvaluation[]; replayOfDecisionId?: string },
  ): void => {
    withTransaction(db, () => {
      if (options.snapshot) saveSnapshot(db, options.snapshot, now);
      saveDecision(db, {
        decision,
        packet,
        snapshotRevision: options.snapshotRevision,
        requestHash,
        idempotencyScope: key ? scope : null,
        idempotencyKey: key,
      });
      saveAdapterRun(db, {
        id: `run_${shortHash({ decisionId: decision.id, provider: decision.providerName ?? decision.providerMode, requestHash }).slice(0, 12)}`,
        scenarioId: decision.scenarioId,
        decisionId: decision.id,
        provider: decision.providerName ?? decision.providerMode,
        mode: decision.providerMode,
        status: decision.providerStatus,
        requestHash,
        latencyMs: Date.now() - startedAt,
        observedAt: now,
        sanitizedMetadata: {
          evaluatedCandidates: options.evaluations.length,
          feasibleCandidates: options.evaluations.filter((e) => e.feasible).length,
          rejectedCandidates: options.evaluations.filter((e) => !e.feasible).length,
          replayOfDecisionId: options.replayOfDecisionId ?? null,
          model: decision.providerMode === 'deterministic' ? 'none (rule-based)' : 'none',
        },
        createdAt: now,
      });
    });
  };

  if (body.providerMode === 'replay') {
    const recorded = latestComputedDecision(db, body.scenarioId);
    if (recorded) {
      const packet: ExportPacket = {
        ...(recorded.packet as ExportPacket),
        generatedAt: now,
        providerMode: 'replay',
        providerStatus: 'available',
        providerName: 'replay',
        replayOfDecisionId: recorded.decision.id,
        timestamps: {
          ...(recorded.packet as ExportPacket).timestamps,
          replayedAt: now,
        },
      };
      const decision: Decision = {
        ...recorded.decision,
        id: `dec_replay_${shortHash({ of: recorded.decision.id, at: now }).slice(0, 12)}`,
        providerMode: 'replay',
        providerStatus: 'available',
        providerName: 'replay',
        createdAt: now,
      };
      persist(decision, packet, {
        snapshotRevision: storedRevision,
        evaluations: packet.candidates ?? [],
        replayOfDecisionId: recorded.decision.id,
      });
      return { decision, packet, replayOfDecisionId: recorded.decision.id, idempotentReplay: false };
    }
    // No recorded run: fall through to a deterministic computation that is
    // explicitly marked unavailable rather than pretending a replay happened.
  }

  const provider: ProviderInfo =
    body.providerMode === 'live'
      ? providerInfo('live', 'unavailable', LIVE_DESCRIPTOR.detail)
      : body.providerMode === 'replay'
        ? providerInfo(
            'replay',
            'unavailable',
            'No recorded run for this scenario yet. Computed with the deterministic engine and labelled unavailable.',
          )
        : DETERMINISTIC_PROVIDER;

  const run = decide({ scenario, policy, now, provider });
  const evaluations = run.evaluations.map(serializeEvaluation);
  const packet = buildExportPacket({
    snapshot: run.snapshot,
    scenario,
    policy,
    evaluations,
    decision: run.decision,
    baselineSchedule: run.baseline,
    generatedAt: now,
  });

  persist(run.decision, packet, {
    snapshot: run.snapshot,
    snapshotRevision: run.snapshot.revision,
    evaluations,
  });

  return { decision: run.decision, packet, idempotentReplay: false };
}

export type DecisionRecord = {
  decision: Decision;
  packet: ExportPacket;
  reviews: unknown[];
};

export function getDecisionRecord(db: DatabaseSync, id: string): DecisionRecord {
  const stored = getDecision(db, id);
  if (!stored) throw notFound(`Unknown decision "${id}".`);
  return {
    decision: stored.decision,
    packet: stored.packet as ExportPacket,
    reviews: listReviews(db, id),
  };
}

/**
 * Export attaches the *current* reviewer choice to the recorded packet. The
 * recorded decision itself is never rewritten; reviews live in their own
 * append-only table.
 */
export function exportPacketFor(db: DatabaseSync, id: string): { decision: Decision; packet: ExportPacket } {
  const stored = getDecision(db, id);
  if (!stored) throw notFound(`Unknown decision "${id}".`);
  const reviews = listReviews(db, id);
  const packet: ExportPacket = {
    ...(stored.packet as ExportPacket),
    reviewerChoice: reviews.length > 0 ? reviews[reviews.length - 1] : null,
  };
  return { decision: stored.decision, packet };
}
