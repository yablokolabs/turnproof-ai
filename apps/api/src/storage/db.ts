/**
 * SQLite connection handling.
 *
 * We use the built-in `node:sqlite` module rather than a native addon: it needs
 * no compilation step, which keeps `npm install` reproducible on a judge's
 * machine. The trade-off is that it is marked experimental in Node, which is
 * recorded in the limitations section of the docs.
 *
 * Every persisted payload is stored twice on purpose: a few scalar columns for
 * querying and indexing, plus the full validated JSON payload so an export can
 * reproduce exactly what was decided at that revision.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

/**
 * `node:sqlite` is loaded through `createRequire` rather than a static import.
 * The module is still flagged experimental in Node 22, so it is missing from
 * the builtin list that Vite and other bundlers consult; a static import is
 * rewritten into a bare `sqlite` specifier and fails to resolve under Vitest.
 * Requiring it at runtime keeps the exact same Node module while letting the
 * test runner load this file.
 */
const nodeRequire = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = nodeRequire('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };
type DatabaseSync = DatabaseSyncType;

const here = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(here, '..', '..');

export const DEFAULT_DB_PATH = join(API_ROOT, 'data', 'turnproof.sqlite');

type ActiveHandle = { path: string; db: DatabaseSync };
let active: ActiveHandle | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scenarios (
  id              TEXT PRIMARY KEY,
  revision        INTEGER NOT NULL,
  label           TEXT NOT NULL,
  category        TEXT NOT NULL,
  policy_id       TEXT NOT NULL,
  schema_version  TEXT NOT NULL,
  data_provenance TEXT NOT NULL,
  payload         TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id              TEXT PRIMARY KEY,
  scenario_id     TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  source_kind     TEXT NOT NULL,
  observed_at     TEXT NOT NULL,
  ingested_at     TEXT NOT NULL,
  trust           TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  content         TEXT NOT NULL,
  snapshot_path   TEXT,
  schema_version  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_scenario ON evidence (scenario_id);

CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY,
  scenario_id     TEXT NOT NULL,
  revision        INTEGER NOT NULL,
  occurred_at     TEXT NOT NULL,
  ingested_at     TEXT NOT NULL,
  kind            TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  field           TEXT NOT NULL,
  value_json      TEXT NOT NULL,
  evidence_id     TEXT NOT NULL,
  source_label    TEXT,
  schema_version  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_scenario ON events (scenario_id, revision);

CREATE TABLE IF NOT EXISTS snapshots (
  id              TEXT PRIMARY KEY,
  scenario_id     TEXT NOT NULL,
  revision        INTEGER NOT NULL,
  as_of           TEXT NOT NULL,
  input_hash      TEXT NOT NULL,
  policy_version  TEXT NOT NULL,
  schema_version  TEXT NOT NULL,
  payload         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_scenario ON snapshots (scenario_id, revision);

CREATE TABLE IF NOT EXISTS decisions (
  id              TEXT PRIMARY KEY,
  scenario_id     TEXT NOT NULL,
  snapshot_hash   TEXT NOT NULL,
  policy_version  TEXT NOT NULL,
  solver_version  TEXT NOT NULL,
  provider_mode   TEXT NOT NULL,
  provider_status TEXT NOT NULL,
  provider_name   TEXT,
  candidate_id    TEXT,
  state           TEXT NOT NULL,
  snapshot_revision INTEGER NOT NULL,
  schema_version  TEXT NOT NULL,
  payload         TEXT NOT NULL,
  packet          TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  idempotency_scope TEXT,
  idempotency_key   TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_scenario ON decisions (scenario_id);
CREATE INDEX IF NOT EXISTS idx_decisions_idem ON decisions (idempotency_scope, idempotency_key);

CREATE TABLE IF NOT EXISTS reviews (
  id              TEXT PRIMARY KEY,
  decision_id     TEXT NOT NULL,
  reviewer        TEXT NOT NULL,
  action          TEXT NOT NULL,
  note            TEXT NOT NULL,
  supersedes      TEXT,
  schema_version  TEXT NOT NULL,
  payload         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_decision ON reviews (decision_id);

CREATE TABLE IF NOT EXISTS adapter_runs (
  id              TEXT PRIMARY KEY,
  scenario_id     TEXT NOT NULL,
  decision_id     TEXT,
  provider        TEXT NOT NULL,
  mode            TEXT NOT NULL,
  status          TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  latency_ms      REAL NOT NULL,
  observed_at     TEXT NOT NULL,
  sanitized_metadata TEXT NOT NULL,
  schema_version  TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_adapter_runs_scenario ON adapter_runs (scenario_id);
`;

export function resolveDbPath(explicit?: string): string {
  return explicit ?? process.env.TURNPROOF_DB ?? DEFAULT_DB_PATH;
}

export function openDatabase(explicitPath?: string): DatabaseSync {
  const target = resolveDbPath(explicitPath);
  if (active && active.path === target) return active.db;
  if (active) {
    try {
      active.db.close();
    } catch {
      // Closing a handle that is already gone is not an error worth surfacing.
    }
    active = null;
  }
  if (target !== ':memory:') mkdirSync(dirname(target), { recursive: true });
  const handle = new DatabaseSync(target);
  handle.exec('PRAGMA foreign_keys = ON;');
  if (target !== ':memory:') {
    // WAL keeps read-only exports from blocking the coordinator's writes.
    handle.exec('PRAGMA journal_mode = WAL;');
  }
  handle.exec(SCHEMA);
  active = { path: target, db: handle };
  return handle;
}

export function getDatabase(): DatabaseSync {
  if (!active) throw new Error('Database is not open. Call openDatabase() first.');
  return active.db;
}

export function currentDbPath(): string | null {
  return active?.path ?? null;
}

export function closeDatabase(): void {
  if (!active) return;
  try {
    active.db.close();
  } finally {
    active = null;
  }
}

/**
 * Single-level transaction helper. Snapshot + decision + adapter run must land
 * together or not at all, so that a crash can never leave a decision without
 * the provenance that explains it. Nested use is not supported on purpose.
 */
export function withTransaction<T>(handle: DatabaseSync, fn: () => T): T {
  handle.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    handle.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      handle.exec('ROLLBACK');
    } catch {
      // A failed rollback must not mask the original error.
    }
    throw error;
  }
}

/** node:sqlite accepts only null, number, bigint, string and Uint8Array. */
export function bindValue(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
