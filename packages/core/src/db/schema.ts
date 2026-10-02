import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const SCANNERS = ["opengrep", "trivy", "gitleaks"] as const;
export type Scanner = (typeof SCANNERS)[number];

export const CATEGORIES = ["sast", "sca", "iac", "secret"] as const;
export type Category = (typeof CATEGORIES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const FINDING_STATUSES = ["new", "open", "resolved", "reopened"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];
/** Findings that still need attention — everything but "resolved". */
export const UNRESOLVED_STATUSES = ["new", "open", "reopened"] as const satisfies readonly FindingStatus[];

export const QUALIFICATIONS = [
  "unqualified",
  "qualifying",
  "true_positive",
  "false_positive",
  "needs_review",
] as const;
export type Qualification = (typeof QUALIFICATIONS)[number];

export const SCAN_STATUSES = [
  "dispatched",
  "running",
  "completed",
  "failed",
] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const SCAN_SOURCES = ["dispatch", "action"] as const;
export type ScanSource = (typeof SCAN_SOURCES)[number];

export const REMEDIATION_STATUSES = [
  "generating",
  "patch_ready",
  "branch_pushed",
  "pr_opened",
  "failed",
] as const;
export type RemediationStatus = (typeof REMEDIATION_STATUSES)[number];

export const repos = sqliteTable("repos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull().unique(),
  defaultBranch: text("default_branch"),
  isPrivate: integer("is_private", { mode: "boolean" }).notNull().default(false),
  lastScannedAt: text("last_scanned_at"),
  createdAt: text("created_at").notNull(),
});

export const scans = sqliteTable("scans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  repoId: integer("repo_id")
    .notNull()
    .references(() => repos.id),
  workflowRunId: integer("workflow_run_id"),
  correlationId: text("correlation_id").notNull(),
  commitSha: text("commit_sha"),
  status: text("status", { enum: SCAN_STATUSES }).notNull(),
  source: text("source", { enum: SCAN_SOURCES }).notNull().default("dispatch"),
  ref: text("ref"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  error: text("error"),
  countsNew: integer("counts_new"),
  countsResolved: integer("counts_resolved"),
  countsOpen: integer("counts_open"),
});

export const findings = sqliteTable(
  "findings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id),
    fingerprint: text("fingerprint").notNull(),
    scanner: text("scanner", { enum: SCANNERS }).notNull(),
    category: text("category", { enum: CATEGORIES }).notNull(),
    ruleId: text("rule_id").notNull(),
    message: text("message").notNull(),
    severity: text("severity", { enum: SEVERITIES }).notNull(),
    filePath: text("file_path").notNull(),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    snippet: text("snippet"),
    status: text("status", { enum: FINDING_STATUSES }).notNull(),
    qualification: text("qualification", { enum: QUALIFICATIONS })
      .notNull()
      .default("unqualified"),
    firstSeenScanId: integer("first_seen_scan_id")
      .notNull()
      .references(() => scans.id),
    lastSeenScanId: integer("last_seen_scan_id")
      .notNull()
      .references(() => scans.id),
    resolvedAt: text("resolved_at"),
    rawSarif: text("raw_sarif"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("findings_repo_fingerprint").on(t.repoId, t.fingerprint)],
);

export const qualifications = sqliteTable("qualifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  findingId: integer("finding_id")
    .notNull()
    .references(() => findings.id),
  verdict: text("verdict", {
    enum: ["true_positive", "false_positive", "needs_review"],
  }),
  confidence: real("confidence"),
  reasoning: text("reasoning"),
  exploitScenario: text("exploit_scenario"),
  model: text("model"),
  contextFiles: text("context_files"),
  status: text("status", { enum: ["running", "done", "failed"] }).notNull(),
  error: text("error"),
  createdAt: text("created_at").notNull(),
});

export const remediations = sqliteTable("remediations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  findingId: integer("finding_id")
    .notNull()
    .references(() => findings.id),
  qualificationId: integer("qualification_id").references(() => qualifications.id),
  status: text("status", { enum: REMEDIATION_STATUSES }).notNull(),
  explanation: text("explanation"),
  patchDiff: text("patch_diff"),
  filesChanged: text("files_changed"),
  branchName: text("branch_name"),
  prUrl: text("pr_url"),
  prNumber: integer("pr_number"),
  usedFork: integer("used_fork", { mode: "boolean" }),
  forkFullName: text("fork_full_name"),
  model: text("model"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Web UI sessions from GitHub sign-in. The cookie token itself is never
// stored — only its SHA-256 — so a leaked database yields no live sessions.
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  githubUserId: integer("github_user_id").notNull(),
  githubLogin: text("github_login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  // Allowlisted org whose membership granted access; null = user allowlist.
  grantedByOrg: text("granted_by_org"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export type Repo = typeof repos.$inferSelect;
export type Scan = typeof scans.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type QualificationRow = typeof qualifications.$inferSelect;
export type Remediation = typeof remediations.$inferSelect;
export type Session = typeof sessions.$inferSelect;
