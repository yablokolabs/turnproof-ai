/**
 * One orchestrated pass: normalise the scenario, compute the baseline, generate
 * candidates, gate them on hard constraints, then rank and explain.
 */
import { generateCandidates } from './candidates.js';
import { SOLVER_VERSION, makeDecision, type ProviderInfo } from './explain.js';
import { buildSnapshot, type Snapshot } from './normalize.js';
import { computeSchedule, type Schedule } from './schedule.js';
import type { Decision, Policy, Scenario } from './schemas.js';
import { evaluateCandidate, type CandidateEvaluation } from './validate.js';

export const DETERMINISTIC_PROVIDER: ProviderInfo = {
  name: 'deterministic-rules',
  mode: 'deterministic',
  status: 'available',
  detail: 'Rule-based dependency engine and constraint gate. No model inference.',
};

export type DecisionRun = {
  snapshot: Snapshot;
  baseline: Schedule | null;
  baselineDelayMin: number | null;
  evaluations: CandidateEvaluation[];
  decision: Decision;
  solverVersion: string;
};

export type DecideArgs = {
  scenario: Scenario;
  policy: Policy;
  /** Snapshot instant. Defaults to the latest ingestion time in the scenario. */
  asOf?: string;
  /** Wall-clock used for the decision record only; never used for scheduling. */
  now: string;
  provider?: ProviderInfo;
};

export function decide(args: DecideArgs): DecisionRun {
  const { scenario, policy } = args;
  const snapshot = buildSnapshot(scenario, policy, args.asOf);

  const baselineOutcome = computeSchedule({
    scenarioId: snapshot.scenarioId,
    turnaround: snapshot.turnaround,
    tasks: snapshot.tasks,
    resources: snapshot.resources,
    policy,
  });
  const baseline: Schedule | null = baselineOutcome.ok ? baselineOutcome.schedule : null;
  const baselineDelayMin = baseline?.projectedDelayMin ?? null;

  const candidates = generateCandidates(snapshot, policy);
  const evaluations: CandidateEvaluation[] = candidates.map((candidate) =>
    evaluateCandidate({ snapshot, policy, candidate, baselineDelayMin }),
  );

  const provider = args.provider ?? DETERMINISTIC_PROVIDER;
  const decision = makeDecision({
    snapshot,
    policy,
    evaluations,
    baselineDelayMin,
    provider,
    now: args.now,
  });

  return { snapshot, baseline, baselineDelayMin, evaluations, decision, solverVersion: SOLVER_VERSION };
}
