/**
 * Normalisation: apply timestamped updates to a base world and produce a
 * snapshot that downstream code can reason about.
 *
 * Rules that matter for correctness:
 * - Events are applied in a stable order (revision, occurredAt, id).
 * - `note` events are inert: they are preserved as evidence text and never
 *   mutate a task or resource. Embedded instructions stay as data.
 * - A contradictory pair of *fresh* claims about the same target+field is never
 *   resolved silently: neither value is applied and the contradiction is
 *   recorded so the decision layer can abstain.
 */
import { hashValue } from './hash.js';
import {
  type Evidence,
  type Policy,
  type Resource,
  type Scenario,
  type Task,
  type Turnaround,
  type TurnaroundEvent,
} from './schemas.js';
import { diffMinutes } from './time.js';

export const EVENT_FIELDS_CRITICAL = new Set([
  'availableFrom',
  'availableUntil',
  'unavailable',
  'status',
  'actualFinish',
]);

const RESOURCE_FIELDS = new Set(['availableFrom', 'availableUntil', 'unavailable']);

export function budgetKindFor(field: string): 'availability' | 'completion' {
  return RESOURCE_FIELDS.has(field) ? 'availability' : 'completion';
}

export type Conflict = {
  targetId: string;
  field: string;
  reasonCode: 'CONFLICTING_EVIDENCE';
  claims: Array<{
    eventId: string;
    evidenceId: string;
    value: string | number | boolean | null;
    observedAt: string;
    sourceLabel?: string;
  }>;
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
  category: Scenario['category'];
  revision: number;
  asOf: string;
  turnaround: Turnaround;
  tasks: Task[];
  resources: Resource[];
  evidence: Evidence[];
  events: TurnaroundEvent[];
  /** Contradictory fresh claims; both sources are shown, nothing is applied. */
  conflicts: Conflict[];
  /** Claims whose supporting evidence is older than the synthetic freshness budget. */
  staleClaims: StaleClaim[];
  /** `note`-field events preserved as untrusted text. */
  includedNoteEventIds: string[];
  /** Events dropped because they target an unknown id or field/type mismatch. */
  rejectedEventIds: string[];
  policyVersion: string;
  inputHash: string;
};

export class SnapshotError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SnapshotError';
    this.code = code;
  }
}

function compareEvents(a: TurnaroundEvent, b: TurnaroundEvent): number {
  if (a.revision !== b.revision) return a.revision - b.revision;
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function valueMatchesField(field: string, value: unknown): boolean {
  switch (field) {
    case 'unavailable':
      return typeof value === 'boolean';
    case 'durationMin':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0;
    case 'availableFrom':
    case 'availableUntil':
    case 'earliestStart':
    case 'actualStart':
    case 'actualFinish':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value);
    case 'status':
      return (
        typeof value === 'string' &&
        ['pending', 'active', 'complete', 'blocked', 'unknown'].includes(value)
      );
    case 'note':
      return true;
    default:
      return false;
  }
}

export function resolveAsOf(scenario: Scenario, override?: string): string {
  if (override) return override;
  const stamps = [
    scenario.turnaround.plannedStartAt,
    ...scenario.events.map((e) => e.ingestedAt),
    ...scenario.evidence.map((e) => e.ingestedAt),
  ];
  return stamps.reduce((acc, s) => (s > acc ? s : acc), stamps[0]);
}

export function buildSnapshot(
  scenario: Scenario,
  policy: Policy,
  asOfOverride?: string,
): Snapshot {
  if (scenario.tasks.length === 0) {
    throw new SnapshotError('EMPTY_TASKS', `Scenario ${scenario.id} contains no tasks`);
  }
  const asOf = resolveAsOf(scenario, asOfOverride);

  const tasks = scenario.tasks.map((t) => ({ ...t, predecessors: [...t.predecessors], evidenceIds: [...t.evidenceIds] }));
  const resources = scenario.resources.map((r) => ({
    ...r,
    evidenceIds: [...r.evidenceIds],
    reservations: r.reservations.map((x) => ({ ...x })),
  }));
  const evidence = scenario.evidence.map((e) => ({ ...e }));
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const resourceById = new Map(resources.map((r) => [r.id, r]));

  const ordered = [...scenario.events].sort(compareEvents);

  const rejectedEventIds: string[] = [];
  const includedNoteEventIds: string[] = [];
  const applicable: TurnaroundEvent[] = [];

  for (const event of ordered) {
    if (!evidenceById.has(event.evidenceId)) {
      rejectedEventIds.push(event.id);
      continue;
    }
    const targetsTask = taskById.has(event.targetId);
    const targetsResource = resourceById.has(event.targetId);
    if (!targetsTask && !targetsResource) {
      rejectedEventIds.push(event.id);
      continue;
    }
    if (!valueMatchesField(event.field, event.value)) {
      rejectedEventIds.push(event.id);
      continue;
    }
    if (event.field === 'note') {
      includedNoteEventIds.push(event.id);
      continue;
    }
    applicable.push(event);
  }

  // Group by target+field to detect contradictions among fresh claims.
  const groups = new Map<string, TurnaroundEvent[]>();
  for (const event of applicable) {
    const key = `${event.targetId}::${event.field}`;
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }

  const conflicts: Conflict[] = [];
  const staleClaims: StaleClaim[] = [];
  const effectiveByKey = new Map<string, TurnaroundEvent>();

  for (const [key, group] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const budgetMinutes =
      policy.freshnessBudgetMinutes[budgetKindFor(group[0].field)];
    const cutoffAge = budgetMinutes;

    const fresh = group.filter((e) => diffMinutes(e.occurredAt, asOf) <= cutoffAge);
    const distinct = new Set(fresh.map((e) => JSON.stringify(e.value)));

    if (distinct.size > 1 && EVENT_FIELDS_CRITICAL.has(group[0].field)) {
      conflicts.push({
        targetId: group[0].targetId,
        field: group[0].field,
        reasonCode: 'CONFLICTING_EVIDENCE',
        claims: fresh.map((e) => ({
          eventId: e.id,
          evidenceId: e.evidenceId,
          value: e.value,
          observedAt: e.occurredAt,
          sourceLabel: e.sourceLabel,
        })),
      });
      continue; // fail closed: apply neither claim
    }

    const winner = group[group.length - 1];
    effectiveByKey.set(key, winner);

    const age = diffMinutes(winner.occurredAt, asOf);
    if (age > cutoffAge) {
      staleClaims.push({
        targetId: winner.targetId,
        field: winner.field,
        eventId: winner.id,
        evidenceId: winner.evidenceId,
        observedAt: winner.occurredAt,
        ageMinutes: age,
        budgetMinutes,
      });
    }
  }

  for (const event of [...effectiveByKey.values()].sort(compareEvents)) {
    if (RESOURCE_FIELDS.has(event.field)) {
      const resource = resourceById.get(event.targetId);
      if (!resource) continue;
      if (event.field === 'availableFrom') resource.availableFrom = event.value as string;
      if (event.field === 'availableUntil') resource.availableUntil = event.value as string;
      if (event.field === 'unavailable') resource.unavailable = event.value as boolean;
      if (!resource.evidenceIds.includes(event.evidenceId)) resource.evidenceIds.push(event.evidenceId);
    } else {
      const task = taskById.get(event.targetId);
      if (!task) continue;
      if (event.field === 'earliestStart') task.earliestStart = event.value as string;
      if (event.field === 'durationMin') task.durationMin = event.value as number;
      if (event.field === 'status') task.status = event.value as Task['status'];
      if (event.field === 'actualStart') task.actualStart = event.value as string;
      if (event.field === 'actualFinish') task.actualFinish = event.value as string;
      if (!task.evidenceIds.includes(event.evidenceId)) task.evidenceIds.push(event.evidenceId);
    }
  }

  const revision = Math.max(
    scenario.turnaround.revision,
    ...ordered.map((e) => e.revision),
    0,
  );

  const withoutHash = {
    scenarioId: scenario.id,
    revision,
    asOf,
    turnaround: { ...scenario.turnaround, revision },
    tasks: [...tasks].sort((a, b) => (a.id < b.id ? -1 : 1)),
    resources: [...resources].sort((a, b) => (a.id < b.id ? -1 : 1)),
    evidence: [...evidence].sort((a, b) => (a.id < b.id ? -1 : 1)),
    conflicts,
    staleClaims,
    policyVersion: policy.version,
  };

  return {
    scenarioId: scenario.id,
    label: scenario.label,
    category: scenario.category,
    revision,
    asOf,
    turnaround: { ...scenario.turnaround, revision },
    tasks,
    resources,
    evidence,
    events: scenario.events,
    conflicts,
    staleClaims,
    includedNoteEventIds,
    rejectedEventIds,
    policyVersion: policy.version,
    inputHash: hashValue(withoutHash),
  };
}
