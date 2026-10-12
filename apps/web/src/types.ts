/**
 * Shapes returned by the TurnProof API. Hand-mirrored from the domain package
 * so the browser bundle stays dependency-light. Every value shown in the UI is
 * treated as untrusted display data.
 */

export type ProviderMode = 'deterministic' | 'replay' | 'live';
export type AdapterStatusValue = 'unavailable' | 'available' | 'error';
export type DecisionState = 'recommended' | 'needs_review' | 'no_feasible_option';
export type TaskStatus = 'pending' | 'active' | 'complete' | 'blocked' | 'unknown';

export type Adapter = {
  id: string;
  name: string;
  kind: 'provider' | 'sponsor';
  mode: string;
  status: AdapterStatusValue;
  detail: string;
  sourceUrl?: string;
  verifiedAt?: string;
};

export type HealthResponse = {
  status: string;
  schemaVersion: string;
  solverVersion: string;
  adapters: Adapter[];
};

export type ScenarioSummary = {
  id: string;
  label: string;
  category: 'normal' | 'disrupted' | 'adverse';
  station: string;
  flightNumber: string;
  aircraft: string;
  plannedStartAt: string;
  plannedReadyAt: string;
  revision: number;
  policyId: string;
  dataProvenance: string;
};

export type Evidence = {
  id: string;
  sourceId: string;
  sourceKind: 'synthetic' | 'authorized_web' | 'manual';
  observedAt: string;
  ingestedAt: string;
  content: string;
  contentHash: string;
  snapshotPath?: string;
  trust: 'fixture' | 'unverified' | 'reviewed';
};

export type Reservation = { from: string; to: string; label: string };

export type Resource = {
  id: string;
  kind: string;
  availableFrom: string;
  availableUntil: string;
  unavailable: boolean;
  authorization: 'fixture' | 'reviewed' | 'unknown';
  evidenceIds: string[];
  reservations: Reservation[];
};

export type Task = {
  id: string;
  turnaroundId: string;
  kind: string;
  predecessors: string[];
  plannedStart: string;
  durationMin: number;
  status: TaskStatus;
  earliestStart?: string;
  actualStart?: string;
  actualFinish?: string;
  resourceId?: string;
  resourceKind?: string;
  evidenceIds: string[];
};

export type Turnaround = {
  id: string;
  station: string;
  flightNumber: string;
  aircraft: string;
  plannedStartAt: string;
  plannedReadyAt: string;
  revision: number;
};

export type ConflictClaim = {
  eventId: string;
  evidenceId: string;
  value: string | number | boolean | null;
  observedAt: string;
  sourceLabel?: string;
};

export type Conflict = {
  targetId: string;
  field: string;
  reasonCode: string;
  claims: ConflictClaim[];
};

export type StaleClaim = {
  targetId: string;
  field: string;
  eventId: string;
  evidenceId: string;
  observedAt: string;
  ageMinutes: number;
  budgetMinutes: number;
};

export type Snapshot = {
  scenarioId: string;
  label: string;
  category: string;
  revision: number;
  asOf: string;
  turnaround: Turnaround;
  tasks: Task[];
  resources: Resource[];
  evidence: Evidence[];
  conflicts: Conflict[];
  staleClaims: StaleClaim[];
  includedNoteEventIds: string[];
  rejectedEventIds: string[];
  policyVersion: string;
  inputHash: string;
};

export type ScheduledTask = {
  taskId: string;
  kind: string;
  status: TaskStatus;
  earliestStart: string;
  finish: string;
  resourceId?: string;
  causes: string[];
  uncertain: boolean;
};

export type Schedule = {
  scenarioId: string;
  tasks: ScheduledTask[];
  readyAt: string | null;
  readyAtTaskId: string | null;
  plannedReadyAt: string;
  projectedDelayMin: number | null;
  uncertainties: string[];
};

export type ConstraintResult = {
  code: string;
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'skipped';
  detail?: string;
};

export type Candidate = {
  id: string;
  action: 'wait' | 'use_alternate_resource' | 'resequencing';
  taskId: string;
  resourceId?: string;
  evidenceIds: string[];
  assumptions: string[];
  estimatedCostUnits: number;
};

export type Violation = { code: string; message: string; taskId?: string; resourceId?: string };

export type CandidateEvaluation = {
  candidate: Candidate;
  feasible: boolean;
  reasonCodes: string[];
  violations: Violation[];
  constraints: ConstraintResult[];
  schedule: Schedule | null;
  projectedDelayMin: number | null;
  projectedRecoveryMin: number | null;
  evidenceWarnings: string[];
  requiresReview: boolean;
};

export type RejectedCandidate = {
  candidateId: string;
  reasonCodes: string[];
  detail?: string;
};

export type Decision = {
  id: string;
  scenarioId: string;
  snapshotHash: string;
  policyVersion: string;
  solverVersion: string;
  providerMode: ProviderMode;
  providerStatus: AdapterStatusValue;
  providerName?: string;
  candidateId?: string;
  state: DecisionState;
  projectedDelayMin?: number;
  projectedRecoveryMin?: number;
  baselineDelayMin?: number;
  explanation: string;
  evidenceIds: string[];
  rejected: RejectedCandidate[];
  createdAt: string;
};

export type ProviderInfo = {
  name: string;
  mode: ProviderMode;
  status: AdapterStatusValue;
  detail?: string;
};

export type SnapshotResponse = {
  scenario: { id: string; label: string; category: string; dataProvenance: string };
  snapshot: Snapshot;
  baseline: Schedule | null;
  baselineDelayMin: number | null;
  candidates: CandidateEvaluation[];
  decision: Decision;
  provider: ProviderInfo;
  adapters: Adapter[];
};

export type Review = {
  id: string;
  decisionId: string;
  reviewer: string;
  action: 'accept' | 'reject' | 'needs_review';
  note: string;
  createdAt: string;
  supersedes?: string;
};

export type ReviewResponse = { review: Review; decision: Decision };

export type DecisionPacket = Record<string, unknown>;
