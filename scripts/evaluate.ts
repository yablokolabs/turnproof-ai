/**
 * Evaluation harness.
 *
 * Everything below is measured on the committed synthetic fixtures with the
 * deterministic rule-based provider. There is no live model in this run, so no
 * live-AI comparison is reported. Results are written to
 * `proof/results/evaluation.json` with the fixture revision, environment,
 * sample counts, and the raw per-scenario rows.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { join } from 'node:path';
import { SOLVER_VERSION, decide, type DecisionRun, type Scenario } from '@turnproof/domain';
import { loadAllScenarios, loadPolicyFor, loadScenario } from '../fixtures/loader.js';

/** Fixed wall-clock for decision records only; scheduling never reads the clock. */
const NOW = '2026-10-12T09:20:00Z';
const OUT_DIR = join(process.cwd(), 'proof', 'results');

function gitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'no-git-repository';
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(3));
}

type Row = {
  scenarioId: string;
  category: string;
  state: string;
  candidates: number;
  feasible: number;
  rejected: number;
  baselineDelayMin: number | null;
  recommendedDelayMin: number | null;
  projectedRecoveryMin: number | null;
  conflicts: number;
  staleClaims: number;
  citations: number;
  unresolvedCitations: string[];
  uncertainties: number;
  latencyMs: number;
  expectedMatches: boolean | null;
};

function runOne(scenario: Scenario): { row: Row; run: DecisionRun } {
  const policy = loadPolicyFor(scenario);
  const startedAt = process.hrtime.bigint();
  const run = decide({ scenario, policy, now: NOW });
  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  const known = new Set(run.snapshot.evidence.map((e) => e.id));
  const unresolvedCitations = run.decision.evidenceIds.filter((id) => !known.has(id));

  const expected = scenario.expected;
  const expectedMatches = expected
    ? expected.state === run.decision.state &&
      (expected.baselineDelayMin ?? null) === run.baselineDelayMin &&
      (expected.candidateDelayMin ?? null) === (run.decision.projectedDelayMin ?? null) &&
      (expected.projectedRecoveryMin ?? null) === (run.decision.projectedRecoveryMin ?? null)
    : null;

  return {
    run,
    row: {
      scenarioId: scenario.id,
      category: scenario.category,
      state: run.decision.state,
      candidates: run.evaluations.length,
      feasible: run.evaluations.filter((e) => e.feasible).length,
      rejected: run.decision.rejected.length,
      baselineDelayMin: run.baselineDelayMin,
      recommendedDelayMin: run.decision.projectedDelayMin ?? null,
      projectedRecoveryMin: run.decision.projectedRecoveryMin ?? null,
      conflicts: run.snapshot.conflicts.length,
      staleClaims: run.snapshot.staleClaims.length,
      citations: run.decision.evidenceIds.length,
      unresolvedCitations,
      uncertainties: run.baseline?.uncertainties.length ?? 0,
      latencyMs: Number(latencyMs.toFixed(3)),
      expectedMatches,
    },
  };
}

const scenarios = loadAllScenarios();
const rows: Row[] = [];

for (const scenario of scenarios) {
  const { row } = runOne(scenario);
  rows.push(row);
}

// Determinism: a second pass must reproduce the same decision identity.
let rerunsIdentical = true;
for (const id of ['case-a', 'case-b', 'case-c']) {
  const scenario = loadScenario(id);
  const policy = loadPolicyFor(scenario);
  const first = decide({ scenario, policy, now: NOW });
  const second = decide({ scenario, policy, now: NOW });
  if (first.decision.id !== second.decision.id || first.snapshot.inputHash !== second.snapshot.inputHash) {
    rerunsIdentical = false;
  }
}

const byCategory: Record<string, number> = {};
const byState: Record<string, number> = {};
for (const row of rows) {
  byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
  byState[row.state] = (byState[row.state] ?? 0) + 1;
}

const totalCitations = rows.reduce((sum, r) => sum + r.citations, 0);
const unresolvedCitations = rows.reduce((sum, r) => sum + r.unresolvedCitations.length, 0);
const latencies = rows.map((r) => r.latencyMs);

const conflictScenarios = rows.filter((r) => r.conflicts > 0);
const noFeasibleScenarios = rows.filter((r) => r.feasible === 0);
const recommendedRows = rows.filter((r) => r.recommendedDelayMin !== null && r.baselineDelayMin !== null);
const heroRows = rows.filter((r) => r.expectedMatches !== null);

const summary = {
  measuredAt: new Date().toISOString(),
  wallClockUsedForDecisionRecords: NOW,
  commit: gitCommit(),
  solverVersion: SOLVER_VERSION,
  providerMode: 'deterministic',
  note:
    'All numbers are measured on committed synthetic fixtures with the rule-based engine. No live model provider was called, so no rule-only versus live-AI comparison is claimed. Durations, cost units and freshness budgets are invented fixture values, not aviation standards.',
  environment: {
    node: process.version,
    platform: `${platform()} ${arch()}`,
    sqlite: 'node:sqlite (experimental in Node 22)',
  },
  sampleCounts: {
    scenarios: rows.length,
    byCategory,
    heroScenariosWithHandDerivedOracle: heroRows.length,
  },
  outcomes: {
    byState,
    feasibleChoiceRate: rows.length === 0 ? 0 : Number((rows.filter((r) => r.feasible > 0).length / rows.length).toFixed(4)),
    candidateHardConstraintRejections: rows.reduce((sum, r) => sum + r.rejected, 0),
  },
  abstention: {
    scenariosWithConflictingEvidence: conflictScenarios.length,
    abstainedOnConflictingEvidence: conflictScenarios.filter((r) => r.state === 'needs_review').length,
    scenariosWithNoFeasibleCandidate: noFeasibleScenarios.length,
    reportedNoFeasibleOption: noFeasibleScenarios.filter((r) => r.state === 'no_feasible_option').length,
  },
  citations: {
    totalCitedEvidenceIds: totalCitations,
    unresolvedCitations,
    citationResolutionRate: totalCitations === 0 ? 1 : Number(((totalCitations - unresolvedCitations) / totalCitations).toFixed(4)),
  },
  projectedDelay: {
    scenariosWithComparableBaseline: recommendedRows.length,
    strictlyBetterThanWaiting: recommendedRows.filter((r) => (r.projectedRecoveryMin ?? 0) > 0).length,
    equalToWaiting: recommendedRows.filter((r) => r.projectedRecoveryMin === 0).length,
    worseThanWaiting: recommendedRows.filter((r) => (r.projectedRecoveryMin ?? 0) < 0).length,
    totalProjectedRecoveryMin: recommendedRows.reduce((sum, r) => sum + (r.projectedRecoveryMin ?? 0), 0),
  },
  latencyMs: {
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: Number(Math.max(...latencies).toFixed(3)),
    method: 'process.hrtime around decide() per fixture, single run, no warmup beyond module load',
  },
  determinism: {
    rerunsIdentical,
    method: 'case-a, case-b and case-c decided twice; decision id and snapshot hash compared',
  },
  heroOracleMatches: heroRows.map((r) => ({ scenarioId: r.scenarioId, matchesHandDerivedOracle: r.expectedMatches })),
  providerFailures: 0,
  invalidModelSelectedActionsReachingRecommended: 0,
  invalidModelSelectedActionsNote:
    'Zero by construction: no model runs in deterministic mode, and every candidate passes the hard-constraint gate before ranking. This is not evidence about a live provider.',
};

mkdirSync(OUT_DIR, { recursive: true });
const payload = { summary, rows };
writeFileSync(join(OUT_DIR, 'evaluation.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

console.log(`evaluate: ${rows.length} scenarios`);
console.log(`  states: ${JSON.stringify(byState)}`);
console.log(`  citation resolution: ${summary.citations.citationResolutionRate}`);
console.log(`  abstention on conflicts: ${summary.abstention.abstainedOnConflictingEvidence}/${summary.abstention.scenariosWithConflictingEvidence}`);
console.log(`  no-feasible reported: ${summary.abstention.reportedNoFeasibleOption}/${summary.abstention.scenariosWithNoFeasibleCandidate}`);
console.log(`  latency p50/p95 ms: ${summary.latencyMs.p50}/${summary.latencyMs.p95}`);
console.log(`  wrote ${join(OUT_DIR, 'evaluation.json')}`);
