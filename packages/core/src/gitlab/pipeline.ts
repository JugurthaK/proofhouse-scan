import { randomUUID } from "node:crypto";
import { getConfig } from "../config.js";
import type { ArtifactContents, CompletedRun, DispatchedRun } from "../github/workflow.js";
import { parseRepoRef, type RepoRef } from "../scm/ref.js";
import { gitlabFetch, GitlabApiError, gitlabJson, projectApi } from "./client.js";

// Dispatch-pipeline job → its artifact file, named like the GitHub workflow's
// artifacts so run-scan.ts handles both the same way.
const JOB_ARTIFACTS: Record<string, { name: string; file: string }> = {
  meta: { name: "scan-meta", file: "meta.json" },
  opengrep: { name: "sarif-opengrep", file: "opengrep.sarif" },
  trivy: { name: "sarif-trivy", file: "trivy.sarif" },
  gitleaks: { name: "sarif-gitleaks", file: "gitleaks.sarif" },
};

const FINISHED = new Set(["success", "failed", "canceled", "skipped"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The project whose .gitlab-ci.yml runs dispatched scans on `host`. Scans run
 * on the target's own instance, so runners can reach firewalled targets.
 */
export function getGitlabScanProject(host: string): RepoRef {
  const path = getConfig().gitlabScanProjects.get(host);
  if (!path) {
    throw new Error(
      `No GitLab scan project configured for ${host} — set GITLAB_SCAN_PROJECTS=${host}=<group>/proofhouse-scan (see .env.example)`,
    );
  }
  return parseRepoRef(`${host}/${path}`, "gitlab");
}

/**
 * Create a scan pipeline in the host's scan project. Unlike GitHub's
 * workflow dispatch, the API returns the pipeline, so no correlation polling
 * is needed; the correlation id still names the pipeline for humans.
 */
export async function dispatchGitlabScan(options: {
  target: RepoRef;
  targetRef?: string;
  onProgress?: (msg: string) => void;
}): Promise<DispatchedRun> {
  const scanProject = getGitlabScanProject(options.target.host);
  const progress = options.onProgress ?? (() => {});
  const correlationId = randomUUID();

  const { default_branch } = await gitlabJson<{ default_branch: string | null }>(
    scanProject.host,
    "GET",
    projectApi(scanProject),
  );
  if (!default_branch) {
    throw new Error(`Scan project ${scanProject.fullName} has no default branch — push this repo to it`);
  }
  let pipeline: { id: number; web_url: string };
  try {
    pipeline = await gitlabJson(scanProject.host, "POST", `${projectApi(scanProject)}/pipeline`, {
      ref: default_branch,
      inputs: {
        target_project: options.target.path,
        target_ref: options.targetRef ?? "",
        correlation_id: correlationId,
      },
    });
  } catch (err) {
    if (err instanceof GitlabApiError && err.status === 400) {
      throw new Error(
        `${err.message}. Check that ${scanProject.fullName} contains this repo's .gitlab-ci.yml on ${default_branch}.`,
      );
    }
    throw err;
  }
  progress(`Dispatched scan of ${options.target.fullName} (${correlationId})`);
  progress(`Started pipeline ${pipeline.id}: ${pipeline.web_url}`);
  return { correlationId, runId: pipeline.id, htmlUrl: pipeline.web_url };
}

/** Poll a scan pipeline until it finishes (default cap 30 minutes). */
export async function waitForGitlabPipeline(
  target: RepoRef,
  run: DispatchedRun,
  options: { timeoutMs?: number; pollMs?: number; onProgress?: (msg: string) => void } = {},
): Promise<CompletedRun> {
  const scanProject = getGitlabScanProject(target.host);
  const progress = options.onProgress ?? (() => {});
  const deadline = Date.now() + (options.timeoutMs ?? 30 * 60 * 1000);
  let lastStatus = "";

  while (Date.now() < deadline) {
    const { status } = await gitlabJson<{ status: string }>(
      scanProject.host,
      "GET",
      `${projectApi(scanProject)}/pipelines/${run.runId}`,
    );
    if (status !== lastStatus) {
      lastStatus = status;
      progress(`Pipeline status: ${status}`);
    }
    if (FINISHED.has(status)) return { ...run, conclusion: status };
    await sleep(options.pollMs ?? 10_000);
  }
  throw new Error(`Pipeline ${run.runId} did not complete in time`);
}

/** Download each scan job's artifact file (jobs without one are skipped). */
export async function downloadGitlabArtifacts(
  target: RepoRef,
  pipelineId: number,
): Promise<ArtifactContents> {
  const scanProject = getGitlabScanProject(target.host);
  const project = projectApi(scanProject);
  const jobs = await gitlabJson<{ id: number; name: string }[]>(
    scanProject.host,
    "GET",
    `${project}/pipelines/${pipelineId}/jobs?per_page=100`,
  );

  const contents: ArtifactContents = {};
  for (const job of jobs) {
    const artifact = JOB_ARTIFACTS[job.name];
    if (!artifact) continue;
    try {
      const res = await gitlabFetch(
        scanProject.host,
        "GET",
        `${project}/jobs/${job.id}/artifacts/${artifact.file}`,
      );
      contents[artifact.name] = await res.text();
    } catch (err) {
      if (!(err instanceof GitlabApiError && err.status === 404)) throw err;
    }
  }
  return contents;
}
