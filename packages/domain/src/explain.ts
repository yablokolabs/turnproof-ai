/**
 * Ranking and decision assembly. Ranking happens only over candidates that
 * already passed every hard constraint. Deterministic mode is rule-based, not
 * AI inference, and the explanation says so.
 */
import { shortHash } from './hash.js';
import type { Snapshot } from './normalize.js';
import type {
  Candidate,
  Decision,
  Policy,
  ProviderMode,
  RejectedCandidate,
} from './schemas.js';
import { STACK_VERSION } from './schemas.js';
import type { CandidateEvaluation } from './validate.js';

export const SOLVER_VERSION = `tp-solver-0.1.0+${STACK_VERSION}`;

export type ProviderInfo = {
  name: string;
  mode: ProviderMode;
  status: 'unavailable' | 'available' | 'error';
  detail?: string;
};

function delayKey(evaluation: CandidateEvaluation): number {
  return evaluation.projectedDelayMin === null
    ? Number.POSITIVE_INFINITY
    : evaluation.projectedDelayMin;
}

/** Minimise delay, then synthetic cost, then assumption count, then stable ID. */
export function rankCandidates(evaluations: CandidateEvaluation[]): CandidateEvaluation[] {
  return [...evaluations].sort((a, b) => {
    const delay = delayKey(a) - delayKey(b);
    if (delay !== 0) return delay;
    const cost = a.candidate.estimatedCostUnits - b.candidate.estimatedCostUnits;
    if (cost !== 0) return cost;
    const assumptions = a.candidate.assumptions.length - b.candidate.assumptions.length;
    if (assumptions !== 0) return assumptions;
    return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0;
  });
}

function describeCandidate(candidate: Candidate, delay: number | null): string {
  const delayText = delay === null ? 'delay unknown' : `projected delay ${delay} min`;
  switch (candidate.action) {
    case 'wait':
      return `Wait: keep the existing plan for ${candidate.taskId} (${delayText})`;
    case 'use_alternate_resource':
      return `Use alternate resource ${candidate.resourceId} for ${candidate.taskId} (${delayText})`;
    case 'resequencing':
      return `Resequence around ${candidate.taskId} (${delayText})`;
    default:
      return `${candidate.id} (${delayText})`;
  }
}

export type MakeDecisionArgs = {
  snapshot: Snapshot;
  policy: Policy;
  evaluations: CandidateEvaluation[];
  /** Delay of the current plan under the `wait` policy, or null when it cannot be asserted. */
  baselineDelayMin: number | null;
  provider: ProviderInfo;
  now: string;
};

export function makeDecision(args: MakeDecisionArgs): Decision {
  const { snapshot, policy, evaluations, provider, now } = args;

  const feasible = evaluations.filter((e) => e.feasible);
  const rejected: RejectedCandidate[] = evaluations
    .filter((e) => !e.feasible)
    .map((e) => ({
      candidateId: e.candidate.id,
      reasonCodes: e.reasonCodes,
      detail: e.violations[0]?.message,
    }));

  const ranked = rankCandidates(feasible);
  const best = ranked[0];
  const waitOnly = ranked.length > 0 && ranked.every((e) => e.candidate.action === 'wait');

  let state: Decision['state'];
  let candidateId: string | undefined;
  let explanation: string;

  if (snapshot.conflicts.length > 0) {
    // Abstain completely: no candidate is proposed while a critical claim is
    // unresolved. Showing a "chosen" option here would misread as a
    // recommendation, so candidateId and the delay fields stay unset and only
    // the baseline delay is reported.
    state = 'needs_review';
    candidateId = undefined;
    const conflict = snapshot.conflicts[0];
    explanation =
      `Abstaining: ${snapshot.conflicts.length} contradictory fresh claim(s) about ` +
      `${conflict.targetId}.${conflict.field}. Sources disagree: ` +
      conflict.claims
        .map((c) => `${String(c.value)} observed ${c.observedAt} (${c.evidenceId})`)
        .join(' vs ') +
      `. Neither claim is applied; a human must resolve the conflict before any recovery is chosen.`;
  } else if (ranked.length === 0) {
    state = 'no_feasible_option';
    explanation =
      `No feasible recovery option. ${rejected.length} candidate(s) were rejected by hard constraints: ` +
      rejected.map((r) => `${r.candidateId} [${r.reasonCodes.join(', ')}]`).join('; ') +
      '. No recovery is invented to fill the gap.';
  } else if (best.requiresReview) {
    state = 'needs_review';
    candidateId = best.candidate.id;
    explanation =
      `Human confirmation required before acting on ${describeCandidate(best.candidate, best.projectedDelayMin)}. ` +
      (best.evidenceWarnings[0] ?? 'Authorization for the resource is unrecorded.') +
      ` Recorded as a preference only; it never authorizes an operational change.`;
  } else {
    state = 'recommended';
    candidateId = best.candidate.id;
    const recovery = best.projectedRecoveryMin;
    const recoveryText =
      recovery === null
        ? 'no comparable baseline'
        : recovery > 0
          ? `${recovery} min better than waiting`
          : recovery === 0
            ? 'equal to waiting; no recovery available'
            : `${Math.abs(recovery)} min worse than waiting`;
    explanation =
      `Recommended (deterministic rules, no model inference): ${describeCandidate(best.candidate, best.projectedDelayMin)}. ` +
      `That is ${recoveryText}` +
      (best.candidate.assumptions.length > 0
        ? `. Assumptions: ${best.candidate.assumptions.join(' ')}`
        : '.') +
      (rejected.length > 0
        ? ` Rejected ${rejected.length} alternative(s) on hard constraints: ${rejected
            .map((r) => `${r.candidateId} [${r.reasonCodes.join(', ')}]`)
            .join('; ')}.`
        : '') +
      (waitOnly ? ' No recovery alternative is feasible; the plan is retained.' : '');
  }

  const chosen = ranked.find((e) => e.candidate.id === candidateId);
  const focusTask = snapshot.tasks.find((t) => t.id === (chosen?.candidate.taskId ?? ''));
  const evidenceIds = [
    ...new Set([
      ...(chosen?.candidate.evidenceIds ?? []),
      ...(focusTask?.evidenceIds ?? []),
      ...snapshot.conflicts.flatMap((c) => c.claims.map((x) => x.evidenceId)),
    ]),
  ];

  const id = `dec_${shortHash({
    scenarioId: snapshot.scenarioId,
    snapshotHash: snapshot.inputHash,
    policyVersion: policy.version,
    solverVersion: SOLVER_VERSION,
    providerMode: provider.mode,
    candidateId: candidateId ?? null,
    state,
  })}`;

  return {
    id,
    scenarioId: snapshot.scenarioId,
    snapshotHash: snapshot.inputHash,
    policyVersion: policy.version,
    solverVersion: SOLVER_VERSION,
    providerMode: provider.mode,
    providerStatus: provider.status,
    providerName: provider.name,
    candidateId,
    state,
    projectedDelayMin: chosen?.projectedDelayMin ?? undefined,
    projectedRecoveryMin: chosen?.projectedRecoveryMin ?? undefined,
    baselineDelayMin: args.baselineDelayMin ?? undefined,
    explanation,
    evidenceIds,
    rejected,
    createdAt: now,
  };
}
