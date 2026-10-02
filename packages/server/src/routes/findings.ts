import {
  CATEGORIES,
  FINDING_STATUSES,
  findings,
  QUALIFICATIONS,
  qualifications,
  remediations,
  repos,
  SCANNERS,
  SEVERITIES,
  UNRESOLVED_STATUSES,
  type Db,
} from "@proofhouse-scan/core";
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

const SEVERITY_ORDER = sql.raw(
  "CASE findings.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END",
);

interface FindingsQuery {
  repo_id?: string;
  scan_id?: string;
  scanner?: string;
  severity?: string;
  status?: string;
  category?: string;
  qualification?: string;
  q?: string;
  page?: string;
  page_size?: string;
}

class BadFilter extends Error {}

function csv(raw: string): string[] {
  return [...new Set(raw.split(",").map((v) => v.trim()).filter(Boolean))];
}

/** Comma-separated filter values ("critical,high"), checked against the column's enum. */
function enumList<T extends string>(raw: string | undefined, allowed: readonly T[], label: string): T[] | null {
  if (!raw) return null;
  const values = csv(raw);
  const unknown = values.filter((v) => !(allowed as readonly string[]).includes(v));
  if (unknown.length > 0) {
    throw new BadFilter(`Unknown ${label}: ${unknown.join(", ")}. Expected one of: ${allowed.join(", ")}`);
  }
  return values as T[];
}

function intList(raw: string | undefined, label: string): number[] | null {
  if (!raw) return null;
  const values = csv(raw).map(Number);
  if (values.some((n) => !Number.isInteger(n))) throw new BadFilter(`Invalid ${label}: ${raw}`);
  return values;
}

function int(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Escapes LIKE wildcards so a search for "100%" matches literally. */
function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function buildConditions(q: FindingsQuery): SQL[] {
  const conditions: SQL[] = [];
  const repoIds = intList(q.repo_id, "repo_id");
  if (repoIds) conditions.push(inArray(findings.repoId, repoIds));
  if (q.scan_id) {
    // Findings present in that scan: first seen at or before it, last seen
    // at or after it (approximation without a per-scan junction table).
    const scanId = Number(q.scan_id);
    if (!Number.isInteger(scanId)) throw new BadFilter(`Invalid scan_id: ${q.scan_id}`);
    conditions.push(lte(findings.firstSeenScanId, scanId));
    conditions.push(gte(findings.lastSeenScanId, scanId));
  }

  // "unresolved" = new + open + reopened, the set stats and repo counts report.
  const status = q.status
    ?.split(",")
    .flatMap((v) => (v.trim() === "unresolved" ? UNRESOLVED_STATUSES : [v]))
    .join(",");
  const filters = [
    [findings.scanner, enumList(q.scanner, SCANNERS, "scanner")],
    [findings.severity, enumList(q.severity, SEVERITIES, "severity")],
    [findings.status, enumList(status, FINDING_STATUSES, "status")],
    [findings.category, enumList(q.category, CATEGORIES, "category")],
    [findings.qualification, enumList(q.qualification, QUALIFICATIONS, "qualification")],
  ] as const;
  for (const [column, values] of filters) {
    if (values) conditions.push(inArray(column, values));
  }

  const term = q.q?.trim();
  if (term) {
    const pattern = likeContains(term);
    // SQLite LIKE is case-insensitive for ASCII.
    conditions.push(
      sql`(${findings.ruleId} LIKE ${pattern} ESCAPE '\\' OR ${findings.message} LIKE ${pattern} ESCAPE '\\' OR ${findings.filePath} LIKE ${pattern} ESCAPE '\\')`,
    );
  }
  return conditions;
}

export function registerFindingRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: FindingsQuery }>("/api/findings", (request, reply) => {
    const q = request.query;
    const page = Math.max(1, int(q.page, 1));
    const pageSize = Math.min(200, Math.max(1, int(q.page_size, 50)));

    let conditions: SQL[];
    try {
      conditions = buildConditions(q);
    } catch (err) {
      if (err instanceof BadFilter) return reply.code(400).send({ error: err.message });
      throw err;
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const total = db
      .select({ count: sql<number>`count(*)` })
      .from(findings)
      .where(where)
      .get()!.count;

    const rows = db
      .select({
        id: findings.id,
        repoId: findings.repoId,
        repo: repos.fullName,
        scanner: findings.scanner,
        category: findings.category,
        ruleId: findings.ruleId,
        message: findings.message,
        severity: findings.severity,
        filePath: findings.filePath,
        startLine: findings.startLine,
        status: findings.status,
        qualification: findings.qualification,
        updatedAt: findings.updatedAt,
      })
      .from(findings)
      .innerJoin(repos, eq(findings.repoId, repos.id))
      .where(where)
      .orderBy(SEVERITY_ORDER, desc(findings.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();

    return { total, page, pageSize, findings: rows };
  });

  app.get<{ Params: { id: string } }>("/api/findings/:id", (request, reply) => {
    const id = Number(request.params.id);
    const finding = db.select().from(findings).where(eq(findings.id, id)).get();
    if (!finding) return reply.code(404).send({ error: "Finding not found" });
    const repo = db.select().from(repos).where(eq(repos.id, finding.repoId)).get();
    const quals = db
      .select()
      .from(qualifications)
      .where(eq(qualifications.findingId, id))
      .orderBy(desc(qualifications.id))
      .all();
    const remeds = db
      .select()
      .from(remediations)
      .where(eq(remediations.findingId, id))
      .orderBy(desc(remediations.id))
      .all();
    return { ...finding, repo, qualifications: quals, remediations: remeds };
  });
}
