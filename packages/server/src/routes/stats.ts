import { findings, scans, UNRESOLVED_STATUSES, type Db } from "@proofhouse-scan/core";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export function registerStatsRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: { repo_id?: string } }>(
    "/api/stats/summary",
    (request) => {
      const conditions: SQL[] = [inArray(findings.status, UNRESOLVED_STATUSES)];
      if (request.query.repo_id) {
        conditions.push(eq(findings.repoId, Number(request.query.repo_id)));
      }
      const where = and(...conditions);

      const bySeverity = db
        .select({ severity: findings.severity, count: sql<number>`count(*)` })
        .from(findings)
        .where(where)
        .groupBy(findings.severity)
        .all();
      const byScanner = db
        .select({ scanner: findings.scanner, count: sql<number>`count(*)` })
        .from(findings)
        .where(where)
        .groupBy(findings.scanner)
        .all();
      const byCategory = db
        .select({ category: findings.category, count: sql<number>`count(*)` })
        .from(findings)
        .where(where)
        .groupBy(findings.category)
        .all();
      const byQualification = db
        .select({
          qualification: findings.qualification,
          count: sql<number>`count(*)`,
        })
        .from(findings)
        .where(where)
        .groupBy(findings.qualification)
        .all();

      return { bySeverity, byScanner, byCategory, byQualification };
    },
  );

  app.get<{ Querystring: { repo_id?: string } }>(
    "/api/stats/timeline",
    (request) => {
      const conditions: SQL[] = [eq(scans.status, "completed")];
      if (request.query.repo_id) {
        conditions.push(eq(scans.repoId, Number(request.query.repo_id)));
      }
      return db
        .select({
          scanId: scans.id,
          repoId: scans.repoId,
          finishedAt: scans.finishedAt,
          countsNew: scans.countsNew,
          countsResolved: scans.countsResolved,
          countsOpen: scans.countsOpen,
        })
        .from(scans)
        .where(and(...conditions))
        .orderBy(asc(scans.id))
        .all();
    },
  );
}
