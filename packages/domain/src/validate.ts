/**
 * Hard constraints gate every candidate *before* any ranking happens
 * (PROJECT_BUILD.md section 5). A candidate that fails any hard check is
 * rejected with explicit reason codes; nothing about it is ranked or shown as
 * a recovery.
 */
import type { Snapshot } from './normalize.js';
import type { Candidate, ConstraintResult, Policy, Resource, Task } from './schemas.js';
import { intervalsOverlap, toEpoch } from './time.js';
import { computeSchedule, type Schedule, type Violation } from './schedule.js';

export const REASON = {
  CANDIDATE_TASK_NOT_FOUND: 'CANDIDATE_TASK_NOT_FOUND',
  COMPLETED_TASK_MUTATION: 'COMPLETED_TASK_MUTATION',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_KIND_MISMATCH: 'RESOURCE_KIND_MISMATCH',
  RESOURCE_UNAVAILABLE: 'RESOURCE_UNAVAILABLE',
  RESOURCE_RESERVED: 'RESOURCE_RESERVED',
  OUTSIDE_AVAILABILITY_WINDOW: 'OUTSIDE_AVAILABILITY_WINDOW',
  DURATION_OUT_OF_BOUNDS: 'DURATION_OUT_OF_BOUNDS',
  NEGATIVE_TIMING: 'NEGATIVE_TIMING',
  STALE_CRITICAL_EVIDENCE: 'STALE_CRITICAL_EVIDENCE',
  CONFLICTING_EVIDENCE: 'CONFLICTING_EVIDENCE',
  READINESS_UNCERTAIN: 'READINESS_UNCERTAIN',
  DEPENDENCY_INVALID: 'DEPENDENCY_INVALID',
} as const;

export type ReasonCode = (typeof REASON)[keyof typeof REASON];

export const HARD_REASONS: ReadonlyArray<ReasonCode> = [
  REASON.CANDIDATE_TASK_NOT_FOUND,
  REASON.COMPLETED_TASK_MUTATION,
  REASON.RESOURCE_NOT_FOUND,
  REASON.RESOURCE_KIND_MISMATCH,
  REASON.RESOURCE_UNAVAILABLE,
  REASON.RESOURCE_RESERVED,
  REASON.OUTSIDE_AVAILABILITY_WINDOW,
  REASON.DURATION_OUT_OF_BOUNDS,
  REASON.NEGATIVE_TIMING,
  REASON.STALE_CRITICAL_EVIDENCE,
  REASON.CONFLICTING_EVIDENCE,
  REASON.READINESS_UNCERTAIN,
  REASON.DEPENDENCY_INVALID,
];

const CRITICAL_RESOURCE_FIELDS = ['availableFrom', 'availableUntil', 'unavailable'];

export type CandidateEvaluation = {
  candidate: Candidate;
  feasible: boolean;
  violations: Violation[];
  reasonCodes: ReasonCode[];
  constraints: ConstraintResult[];
  schedule: Schedule | null;
  projectedDelayMin: number | null;
  projectedRecoveryMin: number | null;
  /** Resource fields whose supporting evidence is stale or contradicted. */
  evidenceWarnings: string[];
  requiresReview: boolean;
};

/** Structural faults that no candidate or policy can repair. */
export type StructuralFault = { violations: Violation[] };

function cloneTasks(tasks: Task[]): Task[] {
  return tasks.map((t) => ({ ...t, predecessors: [...t.predecessors], evidenceIds: [...t.evidenceIds] }));
}

function cloneResources(resources: Resource[]): Resource[] {
  return resources.map((r) => ({
    ...r,
    evidenceIds: [...r.evidenceIds],
    reservations: r.reservations.map((x) => ({ ...x })),
  }));
}

function constraint(
  code: string,
  label: string,
  ok: boolean,
  detail?: string,
): ConstraintResult {
  return { code, label, status: ok ? 'pass' : 'fail', detail };
}

function structuralViolations(snapshot: Snapshot, policy: Policy): Violation[] {
  const outcome = computeSchedule({
    scenarioId: snapshot.scenarioId,
    turnaround: snapshot.turnaround,
    tasks: snapshot.tasks,
    resources: snapshot.resources,
    policy,
  });
  return outcome.ok ? [] : outcome.violations;
}

/** Reasons a candidate's supporting evidence cannot be relied on. */
function evidenceIssues(snapshot: Snapshot, resourceId: string): {
  conflicts: Violation[];
  stale: Violation[];
} {
  const conflicts: Violation[] = [];
  const stale: Violation[] = [];

  for (const conflict of snapshot.conflicts) {
    if (conflict.targetId !== resourceId) continue;
    if (!CRITICAL_RESOURCE_FIELDS.includes(conflict.field)) continue;
    conflicts.push({
      code: REASON.CONFLICTING_EVIDENCE,
      resourceId,
      message: `Contradictory fresh claims about ${resourceId}.${conflict.field}: ${conflict.claims
        .map((c) => `${String(c.value)} @ ${c.observedAt} (${c.evidenceId})`)
        .join(' vs ')}`,
    });
  }

  for (const claim of snapshot.staleClaims) {
    if (claim.targetId !== resourceId) continue;
    if (!CRITICAL_RESOURCE_FIELDS.includes(claim.field)) continue;
    stale.push({
      code: REASON.STALE_CRITICAL_EVIDENCE,
      resourceId,
      message: `Evidence for ${resourceId}.${claim.field} is ${claim.ageMinutes}m old, beyond the ${claim.budgetMinutes}m synthetic freshness budget (evidence ${claim.evidenceId})`,
    });
  }

  return { conflicts, stale };
}

function durationViolations(tasks: Task[], policy: Policy): Violation[] {
  const out: Violation[] = [];
  for (const task of tasks) {
    const bounds = policy.taskDurationBounds[task.kind];
    if (!bounds) continue;
    if (task.durationMin < bounds.min || task.durationMin > bounds.max) {
      out.push({
        code: REASON.DURATION_OUT_OF_BOUNDS,
        taskId: task.id,
        message: `Task ${task.id} duration ${task.durationMin}m is outside the fixture policy band ${bounds.min}-${bounds.max}m for kind ${task.kind}`,
      });
    }
  }
  return out;
}

function negativeTimingViolations(schedule: Schedule): Violation[] {
  const out: Violation[] = [];
  for (const task of schedule.tasks) {
    if (toEpoch(task.finish) < toEpoch(task.earliestStart)) {
      out.push({
        code: REASON.NEGATIVE_TIMING,
        taskId: task.taskId,
        message: `Task ${task.taskId} finishes before it starts`,
      });
    }
  }
  return out;
}

function unavailableResourceViolation(resource: Resource, taskId: string): Violation | null {
  if (!resource.unavailable) return null;
  return {
    code: REASON.RESOURCE_UNAVAILABLE,
    taskId,
    resourceId: resource.id,
    message: `Resource ${resource.id} is marked unavailable`,
  };
}

function availabilityWindowViolation(schedule: Schedule, resources: Resource[]): Violation[] {
  const byId = new Map(resources.map((r) => [r.id, r]));
  const out: Violation[] = [];
  for (const task of schedule.tasks) {
    if (!task.resourceId) continue;
    const resource = byId.get(task.resourceId);
    if (!resource) continue;
    if (toEpoch(task.finish) > toEpoch(resource.availableUntil)) {
      out.push({
        code: REASON.OUTSIDE_AVAILABILITY_WINDOW,
        taskId: task.taskId,
        resourceId: resource.id,
        message: `Task ${task.taskId} would finish ${task.finish}, after ${resource.id} availability ends ${resource.availableUntil}`,
      });
    }
  }
  return out;
}

/**
 * Exclusive-availability check. The scheduler shifts a task around existing
 * reservations, which can hide a genuine collision; this recomputes with
 * reservations removed to ask the real question: does the requested window
 * overlap a commitment the unit already holds?
 */
function reservationViolations(
  snapshot: Snapshot,
  policy: Policy,
  tasks: Task[],
  candidateResourceId: string,
  taskId: string,
): Violation[] {
  const resource = snapshot.resources.find((r) => r.id === candidateResourceId);
  if (!resource || resource.reservations.length === 0) return [];

  const freeResources = cloneResources(snapshot.resources).map((r) =>
    r.id === candidateResourceId ? { ...r, reservations: [] } : r,
  );
  const outcome = computeSchedule({
    scenarioId: snapshot.scenarioId,
    turnaround: snapshot.turnaround,
    tasks,
    resources: freeResources,
    policy,
  });
  if (!outcome.ok) return [];
  const scheduled = outcome.schedule.tasks.find((t) => t.taskId === taskId);
  if (!scheduled) return [];

  const out: Violation[] = [];
  for (const reservation of resource.reservations) {
    if (intervalsOverlap(scheduled.earliestStart, scheduled.finish, reservation.from, reservation.to)) {
      out.push({
        code: REASON.RESOURCE_RESERVED,
        taskId,
        resourceId: resource.id,
        message: `Requested window ${scheduled.earliestStart}-${scheduled.finish} on ${resource.id} collides with existing commitment "${reservation.label}" (${reservation.from}-${reservation.to})`,
      });
    }
  }
  return out;
}

export type EvaluateOptions = {
  snapshot: Snapshot;
  policy: Policy;
  candidate: Candidate;
  baselineDelayMin: number | null;
};

export function evaluateCandidate(options: EvaluateOptions): CandidateEvaluation {
  const { snapshot, policy, candidate } = options;

  const structural = structuralViolations(snapshot, policy);
  if (structural.length > 0) {
    // Preserve a specific hard-constraint code where the scheduler already
    // produced one; only genuinely structural faults collapse to
    // DEPENDENCY_INVALID.
    const mapped = structural.map((v) => ({
      ...v,
      code: HARD_REASONS.includes(v.code as ReasonCode) ? v.code : REASON.DEPENDENCY_INVALID,
    }));
    return {
      candidate,
      feasible: false,
      violations: mapped,
      reasonCodes: [...new Set(mapped.map((v) => v.code as ReasonCode))],
      constraints: [
        constraint('dependency_graph', 'Dependency graph is valid', false, structural[0].message),
      ],
      schedule: null,
      projectedDelayMin: null,
      projectedRecoveryMin: null,
      evidenceWarnings: [],
      requiresReview: false,
    };
  }

  const violations: Violation[] = [];
  const constraints: ConstraintResult[] = [];
  const evidenceWarnings: string[] = [];
  let requiresReview = false;

  const tasks = cloneTasks(snapshot.tasks);
  const task = tasks.find((t) => t.id === candidate.taskId);

  if (!task) {
    violations.push({
      code: REASON.CANDIDATE_TASK_NOT_FOUND,
      taskId: candidate.taskId,
      message: `Candidate ${candidate.id} targets unknown task ${candidate.taskId}`,
    });
    return analyse(candidate, violations, constraints, null, null, null, requiresReview);
  }

  if (candidate.action === 'use_alternate_resource') {
    if (!candidate.resourceId) {
      violations.push({
        code: REASON.RESOURCE_NOT_FOUND,
        taskId: task.id,
        message: `Candidate ${candidate.id} has no resourceId`,
      });
    } else {
      const requested = snapshot.resources.find((r) => r.id === candidate.resourceId);
      if (!requested) {
        violations.push({
          code: REASON.RESOURCE_NOT_FOUND,
          taskId: task.id,
          resourceId: candidate.resourceId,
          message: `Candidate ${candidate.id} references unknown resource ${candidate.resourceId}`,
        });
      } else if (task.status === 'complete') {
        violations.push({
          code: REASON.COMPLETED_TASK_MUTATION,
          taskId: task.id,
          message: `Task ${task.id} is complete; a completed task may not be reassigned`,
        });
      } else {
        task.resourceId = requested.id;
      }
    }
  }

  // Checks below apply to whichever resource the task ends up on, so a `wait`
  // candidate is held to the same standard as a reassignment.
  const assignedId = task.resourceId;
  if (assignedId) {
    const assigned = snapshot.resources.find((r) => r.id === assignedId);
    if (!assigned) {
      violations.push({
        code: REASON.RESOURCE_NOT_FOUND,
        taskId: task.id,
        resourceId: assignedId,
        message: `Task ${task.id} is assigned to unknown resource ${assignedId}`,
      });
    } else {
      if (task.resourceKind && assigned.kind !== task.resourceKind) {
        violations.push({
          code: REASON.RESOURCE_KIND_MISMATCH,
          taskId: task.id,
          resourceId: assigned.id,
          message: `Task ${task.id} requires ${task.resourceKind}; ${assigned.id} is a ${assigned.kind}`,
        });
      }
      const unavailable = unavailableResourceViolation(assigned, task.id);
      if (unavailable) violations.push(unavailable);

      const issues = evidenceIssues(snapshot, assigned.id);
      violations.push(...issues.conflicts, ...issues.stale);
      evidenceWarnings.push(...issues.stale.map((v) => v.message));

      if (assigned.authorization === 'unknown') {
        requiresReview = true;
        evidenceWarnings.push(
          `Resource ${assigned.id} authorization is unrecorded; a human must confirm it before use.`,
        );
      }

      violations.push(...reservationViolations(snapshot, policy, tasks, assigned.id, task.id));
    }
  }

  violations.push(...durationViolations(tasks, policy));

  const outcome = computeSchedule({
    scenarioId: snapshot.scenarioId,
    turnaround: snapshot.turnaround,
    tasks,
    resources: cloneResources(snapshot.resources),
    policy,
  });

  if (!outcome.ok) {
    violations.push(
      ...outcome.violations.map((v) => ({ ...v, code: REASON.DEPENDENCY_INVALID })),
    );
    return analyse(candidate, violations, constraints, null, null, null, requiresReview);
  }

  const schedule = outcome.schedule;
  violations.push(...negativeTimingViolations(schedule));
  violations.push(...availabilityWindowViolation(schedule, snapshot.resources));

  if (schedule.readyAt === null) {
    violations.push({
      code: REASON.READINESS_UNCERTAIN,
      taskId: schedule.tasks.find((t) => t.uncertain)?.taskId,
      message: `Readiness cannot be asserted: ${schedule.uncertainties[0] ?? 'an input is unknown'}`,
    });
  }

  constraints.push(
    constraint('dependency_graph', 'Dependency graph is valid', true),
    constraint(
      'resource_kind',
      'Assigned resource kind matches task requirement',
      !violations.some((v) => v.code === REASON.RESOURCE_KIND_MISMATCH),
    ),
    constraint(
      'exclusive_availability',
      'Exclusive resource availability respected',
      !violations.some((v) => v.code === REASON.RESOURCE_RESERVED),
    ),
    constraint(
      'availability_window',
      'Task fits inside the resource availability window',
      !violations.some((v) => v.code === REASON.OUTSIDE_AVAILABILITY_WINDOW),
    ),
    constraint(
      'duration_bounds',
      'Task durations inside fixture policy bands',
      !violations.some((v) => v.code === REASON.DURATION_OUT_OF_BOUNDS),
    ),
    constraint(
      'nonnegative_timing',
      'No negative or reversed timings',
      !violations.some((v) => v.code === REASON.NEGATIVE_TIMING),
    ),
    constraint(
      'completed_task_immutability',
      'Completed tasks are not modified',
      !violations.some((v) => v.code === REASON.COMPLETED_TASK_MUTATION),
    ),
    constraint(
      'critical_evidence_freshness',
      'Critical evidence within the synthetic freshness budget',
      !violations.some(
        (v) =>
          v.code === REASON.STALE_CRITICAL_EVIDENCE || v.code === REASON.CONFLICTING_EVIDENCE,
      ),
    ),
  );

  const projectedDelayMin = schedule.projectedDelayMin;
  const projectedRecoveryMin =
    options.baselineDelayMin === null || projectedDelayMin === null
      ? null
      : options.baselineDelayMin - projectedDelayMin;

  return analyse(
    candidate,
    violations,
    constraints,
    schedule,
    projectedDelayMin,
    projectedRecoveryMin,
    requiresReview,
    evidenceWarnings,
  );
}

function analyse(
  candidate: Candidate,
  violations: Violation[],
  constraints: ConstraintResult[],
  schedule: Schedule | null,
  projectedDelayMin: number | null,
  projectedRecoveryMin: number | null,
  requiresReview: boolean,
  evidenceWarnings: string[] = [],
): CandidateEvaluation {
  const reasonCodes = [...new Set(violations.map((v) => v.code as ReasonCode))];
  const hard = reasonCodes.filter((c) => HARD_REASONS.includes(c));
  return {
    candidate,
    feasible: hard.length === 0,
    violations,
    reasonCodes: hard,
    constraints,
    schedule,
    projectedDelayMin,
    projectedRecoveryMin,
    evidenceWarnings,
    requiresReview,
  };
}

/** Baseline = the current disrupted snapshot under the `wait` policy. */
export function evaluateBaseline(snapshot: Snapshot, policy: Policy): CandidateEvaluation {
  const wait: Candidate = {
    id: 'wait:__baseline__',
    action: 'wait',
    taskId: snapshot.turnaround.id,
    evidenceIds: [],
    assumptions: [],
    estimatedCostUnits: 0,
  };
  return evaluateCandidate({ snapshot, policy, candidate: wait, baselineDelayMin: null });
}
