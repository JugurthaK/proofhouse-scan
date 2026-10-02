import { repos, scans, type Db } from "@proofhouse-scan/core";
import { desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

// Unresolved = new, open, reopened (UNRESOLVED_STATUSES in core).
const SUMMARY = {
  openFindings: sql<number>`(
    select count(*) from findings f
    where f.repo_id = repos.id and f.status in ('new','open','reopened')
  )`.as("open_findings"),
  criticalOrHigh: sql<number>`(
    select count(*) from findings f
    where f.repo_id = repos.id and f.status in ('new','open','reopened')
      and f.severity in ('critical','high')
  )`.as("critical_or_high"),
};

const REPO_FIELDS = {
  id: repos.id,
  owner: repos.owner,
  name: repos.name,
  fullName: repos.fullName,
  defaultBranch: repos.defaultBranch,
  isPrivate: repos.isPrivate,
  lastScannedAt: repos.lastScannedAt,
  ...SUMMARY,
};

export function registerRepoRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/repos", () => {
    return db.select(REPO_FIELDS).from(repos).all();
  });

  app.get<{ Params: { id: string } }>("/api/repos/:id", (request, reply) => {
    const id = Number(request.params.id);
    const repo = db.select(REPO_FIELDS).from(repos).where(eq(repos.id, id)).get();
    if (!repo) return reply.code(404).send({ error: "Repo not found" });
    const scanHistory = db
      .select()
      .from(scans)
      .where(eq(scans.repoId, id))
      .orderBy(desc(scans.id))
      .all();
    return { ...repo, scans: scanHistory };
  });
}
