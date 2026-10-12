/**
 * Deterministic dependency scheduler (PROJECT_BUILD.md section 5).
 *
 * A graph/topological pass, not a heavyweight optimiser. The same engine
 * computes the baseline and every candidate so comparisons are like-for-like.
 */
import type { Policy, Resource, Task, Turnaround } from './schemas.js';
import { addMinutes, diffMinutes, toEpoch, toIso } from './time.js';

export type Violation = {
  code: string;
  message: string;
  taskId?: string;
  resourceId?: string;
};

export type ScheduledTaskResult = {
  taskId: string;
  kind: string;
  status: Task['status'];
  earliestStart: string;
  finish: string;
  resourceId?: string;
  /** Human-readable chain of causes that set the earliest start. */
  causes: string[];
  uncertain: boolean;
};

export type Schedule = {
  scenarioId: string;
  tasks: ScheduledTaskResult[];
  readyAt: string | null;
  readyAtTaskId: string | null;
  plannedReadyAt: string;
  projectedDelayMin: number | null;
  uncertainties: string[];
};

export type ScheduleInput = {
  scenarioId: string;
  turnaround: Turnaround;
  tasks: Task[];
  resources: Resource[];
  policy: Policy;
};

export type ScheduleOutcome =
  | { ok: true; schedule: Schedule }
  | { ok: false; violations: Violation[] };

/** Kahn topological sort with a stable task-ID tie break. Returns null on a cycle. */
export function topoSort(tasks: Task[]): Task[] | null {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const t of tasks) {
    indegree.set(t.id, 0);
    children.set(t.id, []);
  }
  for (const t of tasks) {
    for (const p of new Set(t.predecessors)) {
      children.get(p)!.push(t.id);
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
    }
  }

  const ready = tasks
    .filter((t) => indegree.get(t.id) === 0)
    .map((t) => t.id)
    .sort();
  const out: Task[] = [];

  while (ready.length > 0) {
    const id = ready.shift()!;
    out.push(byId.get(id)!);
    for (const child of [...children.get(id)!].sort()) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }

  return out.length === tasks.length ? out : null;
}

function findEarliestFree(
  earliestMs: number,
  durationMin: number,
  busy: Array<{ fromMs: number; toMs: number }>,
): number {
  let start = earliestMs;
  let moved = true;
  while (moved) {
    moved = false;
    for (const slot of busy) {
      if (start < slot.toMs && slot.fromMs < start + durationMin * 60_000) {
        start = slot.toMs;
        moved = true;
      }
    }
  }
  return start;
}

export function computeSchedule(input: ScheduleInput): ScheduleOutcome {
  const violations: Violation[] = [];
  const byId = new Map(input.tasks.map((t) => [t.id, t]));

  for (const task of input.tasks) {
    for (const predecessor of task.predecessors) {
      if (!byId.has(predecessor)) {
        violations.push({
          code: 'MISSING_PREDECESSOR',
          taskId: task.id,
          message: `Task ${task.id} references unknown predecessor ${predecessor}`,
        });
      }
    }
  }
  if (violations.length > 0) return { ok: false, violations };

  const order = topoSort(input.tasks);
  if (!order) {
    return {
      ok: false,
      violations: [
        { code: 'CYCLE_DETECTED', message: 'Dependency graph contains a cycle' },
      ],
    };
  }

  const resourceById = new Map(input.resources.map((r) => [r.id, r]));
  const busyByResource = new Map<string, Array<{ fromMs: number; toMs: number }>>();
  for (const r of input.resources) {
    busyByResource.set(
      r.id,
      r.reservations.map((x) => ({ fromMs: toEpoch(x.from), toMs: toEpoch(x.to) })),
    );
  }

  const results = new Map<string, ScheduledTaskResult>();
  const uncertainties: string[] = [];

  for (const task of order) {
    const causes: string[] = [`plannedStart ${task.plannedStart}`];
    let uncertain = false;

    if (task.status === 'complete') {
      const start = task.actualStart ?? task.plannedStart;
      if (!task.actualFinish) {
        uncertainties.push(
          `Task ${task.id} is marked complete without a verified actualFinish; completion time is unknown`,
        );
        uncertain = true;
      }
      const finish = task.actualFinish ?? addMinutes(start, task.durationMin);
      results.set(task.id, {
        taskId: task.id,
        kind: task.kind,
        status: task.status,
        earliestStart: start,
        finish,
        resourceId: task.resourceId,
        causes: ['verified actual times'],
        uncertain,
      });
      continue;
    }

    const candidates: number[] = [toEpoch(task.plannedStart)];
    if (task.earliestStart) {
      candidates.push(toEpoch(task.earliestStart));
      causes.push(`revised availability ${task.earliestStart}`);
    }
    for (const predecessor of task.predecessors) {
      const done = results.get(predecessor);
      if (done) {
        candidates.push(toEpoch(done.finish));
        causes.push(`predecessor ${predecessor} finishes ${done.finish}`);
      }
    }

    let earliestMs = Math.max(...candidates);

    if (task.status === 'blocked' || task.status === 'unknown') {
      uncertain = true;
      uncertainties.push(
        `Task ${task.id} reports status "${task.status}"; its start time rests on a reported state, not a verified time`,
      );
      causes.push(`status ${task.status} reported`);
    }

    if (task.resourceId) {
      const resource = resourceById.get(task.resourceId);
      if (!resource) {
        violations.push({
          code: 'MISSING_RESOURCE',
          taskId: task.id,
          resourceId: task.resourceId,
          message: `Task ${task.id} references unknown resource ${task.resourceId}`,
        });
        return { ok: false, violations };
      }
      if (task.resourceKind && resource.kind !== task.resourceKind) {
        violations.push({
          code: 'RESOURCE_KIND_MISMATCH',
          taskId: task.id,
          resourceId: resource.id,
          message: `Task ${task.id} requires a ${task.resourceKind} but ${resource.id} is a ${resource.kind}`,
        });
        return { ok: false, violations };
      }
      const availableFromMs = toEpoch(resource.availableFrom);
      if (availableFromMs > earliestMs) {
        earliestMs = availableFromMs;
        causes.push(`resource ${resource.id} available from ${resource.availableFrom}`);
      }
      if (resource.unavailable) {
        uncertain = true;
        uncertainties.push(`Assigned resource ${resource.id} is marked unavailable`);
        causes.push(`resource ${resource.id} unavailable; window end ${resource.availableUntil}`);
        earliestMs = Math.max(earliestMs, toEpoch(resource.availableUntil));
      }
      const startMs = findEarliestFree(
        earliestMs,
        task.durationMin,
        busyByResource.get(resource.id) ?? [],
      );
      if (startMs !== earliestMs) {
        causes.push(`resource ${resource.id} already reserved before ${toIso(startMs)}`);
      }
      earliestMs = startMs;
    }

    const start = toIso(earliestMs);
    const finish = addMinutes(start, task.durationMin);

    if (task.resourceId) {
      const resource = resourceById.get(task.resourceId)!;
      if (toEpoch(finish) > toEpoch(resource.availableUntil)) {
        uncertain = true;
        uncertainties.push(
          `Task ${task.id} would finish ${finish}, outside resource ${resource.id} availability ending ${resource.availableUntil}`,
        );
      }
      busyByResource.get(resource.id)!.push({ fromMs: earliestMs, toMs: toEpoch(finish) });
    }

    if (toEpoch(finish) < earliestMs) {
      violations.push({
        code: 'NEGATIVE_TIMING',
        taskId: task.id,
        message: `Task ${task.id} produced non-monotonic timing`,
      });
      return { ok: false, violations };
    }

    if (task.durationMin > 0) {
      const bounds = input.policy.taskDurationBounds[task.kind];
      if (bounds && (task.durationMin < bounds.min || task.durationMin > bounds.max)) {
        uncertain = true;
        uncertainties.push(
          `Task ${task.id} duration ${task.durationMin}m is outside the fixture policy band ${bounds.min}-${bounds.max}m`,
        );
      }
    }

    results.set(task.id, {
      taskId: task.id,
      kind: task.kind,
      status: task.status,
      earliestStart: start,
      finish,
      resourceId: task.resourceId,
      causes,
      uncertain,
    });
  }

  const taskResults = order.map((t) => results.get(t.id)!);
  let readyAtTaskId: string | null = null;
  let readyMs: number | null = null;
  for (const r of taskResults) {
    const ms = toEpoch(r.finish);
    const later = readyMs === null || ms > readyMs;
    const tiesEarlierId = ms === readyMs && readyAtTaskId !== null && r.taskId < readyAtTaskId;
    if (later || tiesEarlierId) {
      readyMs = ms;
      readyAtTaskId = r.taskId;
    }
  }

  const blockedByUncertainty = taskResults.some((r) => r.uncertain);
  const readyAt = readyMs === null || blockedByUncertainty ? null : toIso(readyMs);
  const projectedDelayMin =
    readyAt === null ? null : Math.max(0, diffMinutes(input.turnaround.plannedReadyAt, readyAt));

  return {
    ok: true,
    schedule: {
      scenarioId: input.scenarioId,
      tasks: taskResults,
      readyAt,
      readyAtTaskId: blockedByUncertainty ? null : readyAtTaskId,
      plannedReadyAt: input.turnaround.plannedReadyAt,
      projectedDelayMin,
      uncertainties,
    },
  };
}
