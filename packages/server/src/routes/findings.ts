import {
  findings,
  qualifications,
  remediations,
  repos,
  type Db,
  type Finding,
} from "@proofhouse-scan/core";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
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
  page?: string;
  page_size?: string;
}

export function registerFindingRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: FindingsQuery }>("/api/findings", (request) => {
    const q = request.query;
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(q.page_size ?? 50)));

    const conditions: SQL[] = [];
    if (q.repo_id) conditions.push(eq(findings.repoId, Number(q.repo_id)));
    if (q.scan_id) {
      // Findings present in that scan: first seen at or before it, last seen
      // at or after it (approximation without a per-scan junction table).
      const scanId = Number(q.scan_id);
      conditions.push(lte(findings.firstSeenScanId, scanId));
      conditions.push(gte(findings.lastSeenScanId, scanId));
    }
    if (q.scanner) conditions.push(eq(findings.scanner, q.scanner as Finding["scanner"]));
    if (q.severity) conditions.push(eq(findings.severity, q.severity as Finding["severity"]));
    if (q.status) conditions.push(eq(findings.status, q.status as Finding["status"]));
    if (q.category) conditions.push(eq(findings.category, q.category as Finding["category"]));
    if (q.qualification)
      conditions.push(eq(findings.qualification, q.qualification as Finding["qualification"]));
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
