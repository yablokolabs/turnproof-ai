/**
 * Runtime-validated data contracts (PROJECT_BUILD.md section 4).
 *
 * Every inbound fixture, request body, and stored payload passes through these
 * schemas. Unknown or malformed payloads fail closed rather than being coerced.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = '1.0.0';
export const STACK_VERSION = 'tp-0.1.0';

/** Enforces canonical ISO-8601 UTC with a trailing Z (no offsets, no milliseconds). */
export const IsoUtc = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'must be ISO-8601 UTC, e.g. 2026-10-12T09:30:00Z');

export const TaskStatus = z.enum(['pending', 'active', 'complete', 'blocked', 'unknown']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  sourceKind: z.enum(['synthetic', 'authorized_web', 'manual']),
  observedAt: IsoUtc,
  ingestedAt: IsoUtc,
  content: z.string(),
  contentHash: z.string().min(8),
  snapshotPath: z.string().optional(),
  trust: z.enum(['fixture', 'unverified', 'reviewed']),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  turnaroundId: z.string().min(1),
  kind: z.string().min(1),
  predecessors: z.array(z.string()).default([]),
  plannedStart: IsoUtc,
  durationMin: z.number().int().nonnegative(),
  status: TaskStatus,
  earliestStart: IsoUtc.optional(),
  actualStart: IsoUtc.optional(),
  actualFinish: IsoUtc.optional(),
  resourceId: z.string().optional(),
  /** Resource kind this task must be served by, when it needs an exclusive unit. */
  resourceKind: z.string().optional(),
  evidenceIds: z.array(z.string()).default([]),
});
export type Task = z.infer<typeof TaskSchema>;

export const ReservationSchema = z.object({
  from: IsoUtc,
  to: IsoUtc,
  label: z.string().min(1),
});
export type Reservation = z.infer<typeof ReservationSchema>;

export const ResourceSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  availableFrom: IsoUtc,
  availableUntil: IsoUtc,
  unavailable: z.boolean().default(false),
  authorization: z.enum(['fixture', 'reviewed', 'unknown']),
  evidenceIds: z.array(z.string()).default([]),
  /** Exclusive commitments already held by this unit (other work, other flights). */
  reservations: z.array(ReservationSchema).default([]),
});
export type Resource = z.infer<typeof ResourceSchema>;

export const TurnaroundSchema = z.object({
  id: z.string().min(1),
  station: z.string().min(1),
  flightNumber: z.string().min(1),
  aircraft: z.string().min(1),
  plannedStartAt: IsoUtc,
  plannedReadyAt: IsoUtc,
  revision: z.number().int().nonnegative(),
});
export type Turnaround = z.infer<typeof TurnaroundSchema>;

/**
 * Critical claim fields. `note` is inert: it is preserved as evidence text and
 * is never applied to a resource or task.
 */
export const EventField = z.enum([
  'availableFrom',
  'availableUntil',
  'unavailable',
  'earliestStart',
  'durationMin',
  'status',
  'actualStart',
  'actualFinish',
  'note',
]);
export type EventField = z.infer<typeof EventField>;

export const EventSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  occurredAt: IsoUtc,
  ingestedAt: IsoUtc,
  kind: z.enum([
    'resource_available',
    'resource_unavailable',
    'task_delay',
    'task_status',
    'note',
  ]),
  /** Resource id or task id this event claims something about. */
  targetId: z.string().min(1),
  field: EventField,
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  evidenceId: z.string().min(1),
  sourceLabel: z.string().optional(),
});
export type TurnaroundEvent = z.infer<typeof EventSchema>;

export const CandidateSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['wait', 'use_alternate_resource', 'resequencing']),
  taskId: z.string().min(1),
  resourceId: z.string().optional(),
  evidenceIds: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  estimatedCostUnits: z.number(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const ConstraintResultSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['pass', 'fail', 'warn', 'skipped']),
  detail: z.string().optional(),
});
export type ConstraintResult = z.infer<typeof ConstraintResultSchema>;

export const ProviderModeSchema = z.enum(['deterministic', 'replay', 'live']);
export type ProviderMode = z.infer<typeof ProviderModeSchema>;

export const DecisionStateSchema = z.enum(['recommended', 'needs_review', 'no_feasible_option']);
export type DecisionState = z.infer<typeof DecisionStateSchema>;

export const RejectedCandidateSchema = z.object({
  candidateId: z.string().min(1),
  reasonCodes: z.array(z.string()),
  detail: z.string().optional(),
});
export type RejectedCandidate = z.infer<typeof RejectedCandidateSchema>;

export const DecisionSchema = z.object({
  id: z.string().min(1),
  scenarioId: z.string().min(1),
  snapshotHash: z.string().min(8),
  policyVersion: z.string().min(1),
  solverVersion: z.string().min(1),
  providerMode: ProviderModeSchema,
  providerStatus: z.enum(['unavailable', 'available', 'error']),
  providerName: z.string().optional(),
  candidateId: z.string().optional(),
  state: DecisionStateSchema,
  projectedDelayMin: z.number().optional(),
  projectedRecoveryMin: z.number().optional(),
  baselineDelayMin: z.number().optional(),
  explanation: z.string(),
  evidenceIds: z.array(z.string()),
  rejected: z.array(RejectedCandidateSchema),
  createdAt: IsoUtc,
});
export type Decision = z.infer<typeof DecisionSchema>;

export const ReviewSchema = z.object({
  id: z.string().min(1),
  decisionId: z.string().min(1),
  reviewer: z.string().min(1),
  action: z.enum(['accept', 'reject', 'needs_review']),
  note: z.string(),
  createdAt: IsoUtc,
  supersedes: z.string().optional(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const PolicySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  /** Synthetic budgets only. Explicitly NOT an aviation standard. */
  freshnessBudgetMinutes: z.object({
    availability: z.number().nonnegative(),
    completion: z.number().nonnegative(),
  }),
  taskDurationBounds: z.record(z.object({ min: z.number(), max: z.number() })),
  costUnits: z.object({
    wait: z.number(),
    use_alternate_resource: z.number(),
    resequencing: z.number(),
  }),
  maxRequestBytes: z.number().int().positive(),
  note: z.string(),
});
export type Policy = z.infer<typeof PolicySchema>;

export const ScenarioCategory = z.enum(['normal', 'disrupted', 'adverse']);
export type ScenarioCategory = z.infer<typeof ScenarioCategory>;

export const ScenarioSchema = z.object({
  schemaVersion: z.string().min(1),
  id: z.string().min(1),
  label: z.string().min(1),
  category: ScenarioCategory,
  dataProvenance: z.string().min(1),
  turnaround: TurnaroundSchema,
  tasks: z.array(TaskSchema).min(1),
  resources: z.array(ResourceSchema),
  evidence: z.array(EvidenceSchema),
  events: z.array(EventSchema),
  policyId: z.string().min(1),
  /** Hand-derived oracle for the three hero scenarios (absent for generated fixtures). */
  expected: z
    .object({
      state: DecisionStateSchema,
      baselineDelayMin: z.number().nullable().optional(),
      candidateDelayMin: z.number().nullable().optional(),
      projectedRecoveryMin: z.number().nullable().optional(),
      recommendedAction: z.string().optional(),
      rejectedReasonCodes: z.array(z.string()).optional(),
      derivedBy: z.string().optional(),
    })
    .optional(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

/* ------------------------------------------------------------------ */
/* API request bodies                                                   */
/* ------------------------------------------------------------------ */

export const DecisionRequestSchema = z.object({
  scenarioId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  providerMode: ProviderModeSchema.default('deterministic'),
  note: z.string().max(4000).optional(),
});
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

export const ReviewRequestSchema = z.object({
  reviewer: z.string().min(1).max(200),
  action: z.enum(['accept', 'reject', 'needs_review']),
  note: z.string().max(4000),
  supersedes: z.string().optional(),
});
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

/** Client-supplied status update. Enabled only for `note` claims in the prototype. */
export const EventRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  occurredAt: IsoUtc,
  ingestedAt: IsoUtc,
  kind: EventSchema.shape.kind,
  targetId: z.string().min(1),
  field: EventField,
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  sourceLabel: z.string().max(200).optional(),
  content: z.string().max(2000),
});
export type EventRequest = z.infer<typeof EventRequestSchema>;

export const ApiErrorCode = z.enum([
  'validation_error',
  'not_found',
  'revision_conflict',
  'idempotency_conflict',
  'payload_too_large',
  'unsupported_update',
  'internal_error',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, value: unknown, label: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(`${label} failed validation: ${detail}`);
  }
  return result.data;
}
