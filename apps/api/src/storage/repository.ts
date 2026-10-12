/**
 * Row-level persistence.
 *
 * Rows carry both queryable scalar columns and the full validated JSON payload,
 * so an export can reproduce a decision byte-for-byte as it was recorded.
 */
import {
  DecisionSchema,
  ReviewSchema,
  SCHEMA_VERSION,
  type Decision,
  type Evidence,
  type Review,
  type Scenario,
  type Snapshot,
  type TurnaroundEvent,
} from '@turnproof/domain';
import type { DatabaseSync } from 'node:sqlite';
import { bindValue } from './db.js';

export type Row = Record<string, unknown>;

function all(db: DatabaseSync, sql: string, ...params: unknown[]): Row[] {
  const statement = db.prepare(sql);
  return statement.all(...(params.map(bindValue) as never[])) as unknown as Row[];
}

function first(db: DatabaseSync, sql: string, ...params: unknown[]): Row | null {
  const rows = all(db, sql, ...params);
  return rows.length > 0 ? rows[0] : null;
}

function run(db: DatabaseSync, sql: string, ...params: unknown[]): void {
  const statement = db.prepare(sql);
  statement.run(...(params.map(bindValue) as never[]));
}

export type StoredDecision = {
  decision: Decision;
  packet: unknown;
  snapshotRevision: number;
  requestHash: string;
};

/* ------------------------------------------------------------------ */
/* scenarios                                                            */
/* ------------------------------------------------------------------ */

export function countScenarios(db: DatabaseSync): number {
  const row = first(db, 'SELECT COUNT(*) AS n FROM scenarios');
  return Number(row?.n ?? 0);
}

export function getScenarioPayload(db: DatabaseSync, id: string): Scenario | null {
  const row = first(db, 'SELECT payload FROM scenarios WHERE id = ?', id);
  if (!row) return null;
  return JSON.parse(String(row.payload)) as Scenario;
}

export function getScenarioRevision(db: DatabaseSync, id: string): number | null {
  const row = first(db, 'SELECT revision FROM scenarios WHERE id = ?', id);
  return row ? Number(row.revision) : null;
}

export function listScenarioRows(db: DatabaseSync): Row[] {
  return all(db, 'SELECT * FROM scenarios ORDER BY id ASC');
}

export function listEvidenceRows(db: DatabaseSync, scenarioId: string): Row[] {
  return all(db, 'SELECT * FROM evidence WHERE scenario_id = ? ORDER BY observed_at ASC, id ASC', scenarioId);
}

/** Seeding is insert-if-absent so a reseed never erases appended coordinator events. */
export function seedScenario(
  db: DatabaseSync,
  scenario: Scenario,
  revision: number,
  updatedAt: string,
): void {
  run(
    db,
    `INSERT OR IGNORE INTO scenarios
      (id, revision, label, category, policy_id, schema_version, data_provenance, payload, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    scenario.id,
    revision,
    scenario.label,
    scenario.category,
    scenario.policyId,
    SCHEMA_VERSION,
    scenario.dataProvenance,
    JSON.stringify(scenario),
    updatedAt,
  );
  for (const item of scenario.evidence) seedEvidence(db, scenario.id, item);
  for (const event of scenario.events) seedEvent(db, scenario.id, event);
}

export function saveScenario(
  db: DatabaseSync,
  scenario: Scenario,
  revision: number,
  updatedAt: string,
): void {
  run(
    db,
    `INSERT INTO scenarios
      (id, revision, label, category, policy_id, schema_version, data_provenance, payload, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       revision = excluded.revision,
       label = excluded.label,
       category = excluded.category,
       payload = excluded.payload,
       updated_at = excluded.updated_at`,
    scenario.id,
    revision,
    scenario.label,
    scenario.category,
    scenario.policyId,
    SCHEMA_VERSION,
    scenario.dataProvenance,
    JSON.stringify(scenario),
    updatedAt,
  );
}

export function seedEvidence(db: DatabaseSync, scenarioId: string, item: Evidence): void {
  run(
    db,
    `INSERT OR IGNORE INTO evidence
      (id, scenario_id, source_id, source_kind, observed_at, ingested_at, trust, content_hash, content, snapshot_path, schema_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.id,
    scenarioId,
    item.sourceId,
    item.sourceKind,
    item.observedAt,
    item.ingestedAt,
    item.trust,
    item.contentHash,
    item.content,
    item.snapshotPath ?? null,
    SCHEMA_VERSION,
  );
}

export function seedEvent(db: DatabaseSync, scenarioId: string, event: TurnaroundEvent): void {
  run(
    db,
    `INSERT OR IGNORE INTO events
      (id, scenario_id, revision, occurred_at, ingested_at, kind, target_id, field, value_json, evidence_id, source_label, schema_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    event.id,
    scenarioId,
    event.revision,
    event.occurredAt,
    event.ingestedAt,
    event.kind,
    event.targetId,
    event.field,
    JSON.stringify(event.value),
    event.evidenceId,
    event.sourceLabel ?? null,
    SCHEMA_VERSION,
  );
}

export function listEventRows(db: DatabaseSync, scenarioId: string): Row[] {
  return all(db, 'SELECT * FROM events WHERE scenario_id = ? ORDER BY revision ASC, id ASC', scenarioId);
}

export function listAdapterRuns(db: DatabaseSync, scenarioId: string): Row[] {
  return all(db, 'SELECT * FROM adapter_runs WHERE scenario_id = ? ORDER BY rowid ASC', scenarioId);
}

/* ------------------------------------------------------------------ */
/* snapshots                                                            */
/* ------------------------------------------------------------------ */

export function saveSnapshot(
  db: DatabaseSync,
  snapshot: Snapshot,
  createdAt: string,
): void {
  run(
    db,
    `INSERT OR REPLACE INTO snapshots
      (id, scenario_id, revision, as_of, input_hash, policy_version, schema_version, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `${snapshot.scenarioId}:${snapshot.inputHash.slice(0, 16)}`,
    snapshot.scenarioId,
    snapshot.revision,
    snapshot.asOf,
    snapshot.inputHash,
    snapshot.policyVersion,
    SCHEMA_VERSION,
    JSON.stringify(snapshot),
    createdAt,
  );
}

/* ------------------------------------------------------------------ */
/* decisions                                                            */
/* ------------------------------------------------------------------ */

export type SaveDecisionArgs = {
  decision: Decision;
  packet: unknown;
  snapshotRevision: number;
  requestHash: string;
  idempotencyScope?: string | null;
  idempotencyKey?: string | null;
};

export function saveDecision(db: DatabaseSync, args: SaveDecisionArgs): void {
  const { decision } = args;
  run(
    db,
    `INSERT OR REPLACE INTO decisions
      (id, scenario_id, snapshot_hash, policy_version, solver_version, provider_mode, provider_status,
       provider_name, candidate_id, state, snapshot_revision, schema_version, payload, packet,
       request_hash, idempotency_scope, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    decision.id,
    decision.scenarioId,
    decision.snapshotHash,
    decision.policyVersion,
    decision.solverVersion,
    decision.providerMode,
    decision.providerStatus,
    decision.providerName ?? null,
    decision.candidateId ?? null,
    decision.state,
    args.snapshotRevision,
    SCHEMA_VERSION,
    JSON.stringify(decision),
    JSON.stringify(args.packet),
    args.requestHash,
    args.idempotencyScope ?? null,
    args.idempotencyKey ?? null,
    decision.createdAt,
  );
}

function rowToStoredDecision(row: Row): StoredDecision {
  return {
    decision: DecisionSchema.parse(JSON.parse(String(row.payload))),
    packet: JSON.parse(String(row.packet)),
    snapshotRevision: Number(row.snapshot_revision),
    requestHash: String(row.request_hash),
  };
}

export function getDecision(db: DatabaseSync, id: string): StoredDecision | null {
  const row = first(db, 'SELECT * FROM decisions WHERE id = ?', id);
  return row ? rowToStoredDecision(row) : null;
}

export function findDecisionByIdempotency(
  db: DatabaseSync,
  scope: string,
  key: string,
): StoredDecision | null {
  const row = first(
    db,
    'SELECT * FROM decisions WHERE idempotency_scope = ? AND idempotency_key = ? ORDER BY rowid DESC LIMIT 1',
    scope,
    key,
  );
  return row ? rowToStoredDecision(row) : null;
}

/** Most recent *computed* run for a scenario; replays are excluded by design. */
export function latestComputedDecision(db: DatabaseSync, scenarioId: string): StoredDecision | null {
  const row = first(
    db,
    "SELECT * FROM decisions WHERE scenario_id = ? AND provider_mode = 'deterministic' ORDER BY rowid DESC LIMIT 1",
    scenarioId,
  );
  return row ? rowToStoredDecision(row) : null;
}

export function listDecisionRows(db: DatabaseSync, scenarioId: string): Row[] {
  return all(db, 'SELECT * FROM decisions WHERE scenario_id = ? ORDER BY rowid ASC', scenarioId);
}

/* ------------------------------------------------------------------ */
/* reviews                                                              */
/* ------------------------------------------------------------------ */

export function countReviews(db: DatabaseSync, decisionId: string): number {
  const row = first(db, 'SELECT COUNT(*) AS n FROM reviews WHERE decision_id = ?', decisionId);
  return Number(row?.n ?? 0);
}

export function saveReview(db: DatabaseSync, review: Review): void {
  run(
    db,
    `INSERT INTO reviews
      (id, decision_id, reviewer, action, note, supersedes, schema_version, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    review.id,
    review.decisionId,
    review.reviewer,
    review.action,
    review.note,
    review.supersedes ?? null,
    SCHEMA_VERSION,
    JSON.stringify(review),
    review.createdAt,
  );
}

export function listReviews(db: DatabaseSync, decisionId: string): Review[] {
  return all(db, 'SELECT * FROM reviews WHERE decision_id = ? ORDER BY rowid ASC', decisionId).map(
    (row) => ReviewSchema.parse(JSON.parse(String(row.payload))),
  );
}

/* ------------------------------------------------------------------ */
/* adapter runs                                                         */
/* ------------------------------------------------------------------ */

export type SaveAdapterRunArgs = {
  id: string;
  scenarioId: string;
  decisionId: string | null;
  provider: string;
  mode: string;
  status: string;
  requestHash: string;
  latencyMs: number;
  observedAt: string;
  sanitizedMetadata: Record<string, unknown>;
  createdAt: string;
};

export function saveAdapterRun(db: DatabaseSync, args: SaveAdapterRunArgs): void {
  run(
    db,
    `INSERT OR REPLACE INTO adapter_runs
      (id, scenario_id, decision_id, provider, mode, status, request_hash, latency_ms, observed_at,
       sanitized_metadata, schema_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args.id,
    args.scenarioId,
    args.decisionId ?? null,
    args.provider,
    args.mode,
    args.status,
    args.requestHash,
    args.latencyMs,
    args.observedAt,
    JSON.stringify(args.sanitizedMetadata),
    SCHEMA_VERSION,
    args.createdAt,
  );
}
