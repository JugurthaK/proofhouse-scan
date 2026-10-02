import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

// Idempotent DDL applied on every open. For a single-user local tool this
// replaces a migration system; additive changes go here as ALTERs guarded by
// pragma checks if ever needed.
const DDL = `
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL UNIQUE,
  default_branch TEXT,
  is_private INTEGER NOT NULL DEFAULT 0,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id),
  workflow_run_id INTEGER,
  correlation_id TEXT NOT NULL,
  commit_sha TEXT,
  status TEXT NOT NULL CHECK (status IN ('dispatched','running','completed','failed')),
  source TEXT NOT NULL DEFAULT 'dispatch' CHECK (source IN ('dispatch','action')),
  ref TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT,
  counts_new INTEGER,
  counts_resolved INTEGER,
  counts_open INTEGER
);

CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id),
  fingerprint TEXT NOT NULL,
  scanner TEXT NOT NULL CHECK (scanner IN ('opengrep','trivy','gitleaks')),
  category TEXT NOT NULL CHECK (category IN ('sast','sca','iac','secret')),
  rule_id TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  file_path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  snippet TEXT,
  status TEXT NOT NULL CHECK (status IN ('new','open','resolved','reopened')),
  qualification TEXT NOT NULL DEFAULT 'unqualified'
    CHECK (qualification IN ('unqualified','qualifying','true_positive','false_positive','needs_review')),
  first_seen_scan_id INTEGER NOT NULL REFERENCES scans(id),
  last_seen_scan_id INTEGER NOT NULL REFERENCES scans(id),
  resolved_at TEXT,
  raw_sarif TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS findings_repo_fingerprint ON findings(repo_id, fingerprint);
CREATE INDEX IF NOT EXISTS findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS findings_severity ON findings(severity);

CREATE TABLE IF NOT EXISTS qualifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id INTEGER NOT NULL REFERENCES findings(id),
  verdict TEXT CHECK (verdict IN ('true_positive','false_positive','needs_review')),
  confidence REAL,
  reasoning TEXT,
  exploit_scenario TEXT,
  model TEXT,
  context_files TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','done','failed')),
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS qualifications_finding ON qualifications(finding_id);

CREATE TABLE IF NOT EXISTS remediations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id INTEGER NOT NULL REFERENCES findings(id),
  qualification_id INTEGER REFERENCES qualifications(id),
  status TEXT NOT NULL CHECK (status IN ('generating','patch_ready','branch_pushed','pr_opened','failed')),
  explanation TEXT,
  patch_diff TEXT,
  files_changed TEXT,
  branch_name TEXT,
  pr_url TEXT,
  pr_number INTEGER,
  used_fork INTEGER,
  fork_full_name TEXT,
  model TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS remediations_finding ON remediations(finding_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  github_user_id INTEGER NOT NULL,
  github_login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  granted_by_org TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
`;

const cache = new Map<string, Db>();

/**
 * Additive migration for databases created before a column existed —
 * CREATE TABLE IF NOT EXISTS never alters existing tables. CHECK constraints
 * are only present in the DDL for fresh databases; app code + drizzle types
 * enforce the enum on migrated ones.
 */
function ensureColumn(
  sqlite: Database.Database,
  table: string,
  column: string,
  ddl: string,
): void {
  const cols = sqlite.pragma(`table_info(${table})`) as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

export function openDb(dbPath: string): Db {
  const existing = cache.get(dbPath);
  if (existing) return existing;
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  ensureColumn(sqlite, "scans", "source", "source TEXT NOT NULL DEFAULT 'dispatch'");
  ensureColumn(sqlite, "scans", "ref", "ref TEXT");
  const db = drizzle(sqlite, { schema }) as Db;
  cache.set(dbPath, db);
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}
