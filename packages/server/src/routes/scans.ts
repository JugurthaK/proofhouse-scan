import { runScan, scans, type Db } from "@proofhouse-scan/core";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export function registerScanRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: { repo_id?: string } }>("/api/scans", (request) => {
    const repoId = request.query.repo_id ? Number(request.query.repo_id) : null;
    let query = db.select().from(scans).orderBy(desc(scans.id)).$dynamic();
    if (repoId !== null) query = query.where(eq(scans.repoId, repoId));
    return query.all();
  });

  // Fire-and-forget rescan from the UI; the client polls /api/scans.
  app.post<{ Body: { repo: string; ref?: string } }>(
    "/api/scans",
    async (request, reply) => {
      const { repo, ref } = request.body ?? {};
      if (!repo) return reply.code(400).send({ error: "repo is required" });
      runScan(db, { targetRepo: repo, targetRef: ref }).catch((err) => {
        app.log.error(err);
        console.error(`Scan of ${repo} failed:`, err);
      });
      return reply.code(202).send({ started: true, repo });
    },
  );
}
