import {
  ingestSarifScan,
  SCANNERS,
  type Db,
  type Scanner,
} from "@proofhouse-scan/core";
import type { FastifyInstance } from "fastify";

interface IngestBody {
  repo?: string;
  commit_sha?: string;
  ref?: string;
  run_id?: number;
  run_url?: string;
  is_private?: boolean;
  default_branch?: string;
  sarif?: Record<string, unknown>;
}

export function registerIngestRoutes(app: FastifyInstance, db: Db): void {
  app.post<{ Body: IngestBody }>("/api/ingest", (request, reply) => {
    const body = request.body ?? {};
    if (!body.repo || !/^[^/\s]+\/[^/\s]+$/.test(body.repo)) {
      return reply.code(400).send({ error: "repo (owner/name) is required" });
    }
    const sarif: Partial<Record<Scanner, string>> = {};
    for (const scanner of SCANNERS) {
      const raw = body.sarif?.[scanner];
      if (typeof raw === "string" && raw.length > 0) sarif[scanner] = raw;
    }
    if (Object.keys(sarif).length === 0) {
      return reply.code(400).send({
        error: `sarif must contain at least one of: ${SCANNERS.join(", ")}`,
      });
    }

    try {
      const summary = ingestSarifScan(db, {
        repo: body.repo,
        commitSha: body.commit_sha ?? null,
        ref: body.ref ?? null,
        runId: body.run_id ?? null,
        isPrivate: body.is_private,
        defaultBranch: body.default_branch,
        sarif,
      });
      return reply.send({
        scan_id: summary.scanId,
        repo_id: summary.repoId,
        scanners_ingested: summary.scannersIngested,
        scanners_failed: summary.scannersFailed,
        counts: summary.counts,
        new_by_severity: summary.newBySeverity,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("No SARIF could be ingested")) {
        return reply.code(422).send({ error: message });
      }
      throw err;
    }
  });
}
