import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { nowIso } from "../db/client.js";
import { repos, scans, type Scanner } from "../db/schema.js";
import { normalizeSarif, type NormalizedFinding } from "../sarif/normalize.js";
import { parseSarif } from "../sarif/parse.js";
import {
  dispatchRepoScan,
  downloadRepoScanArtifacts,
  fetchRepoMeta,
  waitForRepoScan,
} from "../scm/index.js";
import { parseRepoRef } from "../scm/ref.js";
import { reconcileFindings, type ReconcileResult } from "./reconcile.js";

const SARIF_ARTIFACTS: Record<string, Scanner> = {
  "sarif-opengrep": "opengrep",
  "sarif-trivy": "trivy",
  "sarif-gitleaks": "gitleaks",
};

export interface ScanSummary {
  scanId: number;
  repoId: number;
  targetRepo: string;
  commitSha: string | null;
  runUrl: string;
  scannersIngested: Scanner[];
  scannersMissing: Scanner[];
  counts: ReconcileResult;
}

/**
 * Ensure a repos row exists (fetching metadata from GitHub or GitLab) and
 * return it. `targetRepo` is owner/repo, or host/group/project for GitLab.
 */
export async function upsertRepo(db: Db, targetRepo: string) {
  const meta = await fetchRepoMeta(parseRepoRef(targetRepo));

  const existing = db
    .select()
    .from(repos)
    .where(eq(repos.fullName, meta.fullName))
    .get();
  if (existing) {
    db.update(repos)
      .set({ defaultBranch: meta.defaultBranch, isPrivate: meta.isPrivate })
      .where(eq(repos.id, existing.id))
      .run();
    return { ...existing, defaultBranch: meta.defaultBranch };
  }
  return db
    .insert(repos)
    .values({ ...meta, createdAt: nowIso() })
    .returning()
    .get();
}

/**
 * Full pipeline: dispatch the scan (GitHub scan.yml, or a GitLab pipeline in
 * the host's scan project) → wait → download SARIF artifacts → normalize →
 * reconcile into the database.
 */
export async function runScan(
  db: Db,
  options: {
    targetRepo: string;
    targetRef?: string;
    timeoutMs?: number;
    onProgress?: (msg: string) => void;
  },
): Promise<ScanSummary> {
  const progress = options.onProgress ?? (() => {});
  const repo = await upsertRepo(db, options.targetRepo);

  const scan = db
    .insert(scans)
    .values({
      repoId: repo.id,
      correlationId: "pending",
      status: "dispatched",
      startedAt: nowIso(),
    })
    .returning()
    .get();

  try {
    const run = await dispatchRepoScan(repo, {
      targetRef: options.targetRef,
      onProgress: progress,
    });
    db.update(scans)
      .set({
        correlationId: run.correlationId,
        workflowRunId: run.runId,
        status: "running",
      })
      .where(eq(scans.id, scan.id))
      .run();

    const completed = await waitForRepoScan(repo, run, {
      timeoutMs: options.timeoutMs,
      onProgress: progress,
    });
    progress(`Run finished with conclusion: ${completed.conclusion}`);

    const artifacts = await downloadRepoScanArtifacts(repo, run);

    let commitSha: string | null = null;
    const metaRaw = artifacts["scan-meta"];
    if (metaRaw) {
      try {
        commitSha = (JSON.parse(metaRaw) as { commit_sha?: string }).commit_sha ?? null;
      } catch {
        progress("Warning: could not parse scan-meta artifact");
      }
    }

    const allFindings: NormalizedFinding[] = [];
    const ingested: Scanner[] = [];
    const missing: Scanner[] = [];
    for (const [artifactName, scanner] of Object.entries(SARIF_ARTIFACTS)) {
      const raw = artifacts[artifactName];
      if (!raw) {
        missing.push(scanner);
        continue;
      }
      try {
        const normalized = normalizeSarif(parseSarif(raw), scanner);
        allFindings.push(...normalized);
        ingested.push(scanner);
        progress(`${scanner}: ${normalized.length} findings`);
      } catch (err) {
        missing.push(scanner);
        progress(`Warning: failed to parse ${artifactName}: ${String(err)}`);
      }
    }
    if (ingested.length === 0) {
      throw new Error("No SARIF artifacts could be ingested from the run");
    }

    const counts = reconcileFindings(db, repo.id, scan.id, allFindings);

    db.update(scans)
      .set({
        status: "completed",
        commitSha,
        finishedAt: nowIso(),
        error:
          missing.length > 0
            ? `Missing/failed scanner artifacts: ${missing.join(", ")}`
            : null,
      })
      .where(eq(scans.id, scan.id))
      .run();
    db.update(repos)
      .set({ lastScannedAt: nowIso() })
      .where(eq(repos.id, repo.id))
      .run();

    return {
      scanId: scan.id,
      repoId: repo.id,
      targetRepo: repo.fullName,
      commitSha,
      runUrl: run.htmlUrl,
      scannersIngested: ingested,
      scannersMissing: missing,
      counts,
    };
  } catch (err) {
    db.update(scans)
      .set({ status: "failed", finishedAt: nowIso(), error: String(err) })
      .where(eq(scans.id, scan.id))
      .run();
    throw err;
  }
}
