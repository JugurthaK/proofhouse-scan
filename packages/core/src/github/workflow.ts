import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import { getConfig } from "../config.js";
import { getOctokit } from "./client.js";

const WORKFLOW_FILE = "scan.yml";

export interface DispatchedRun {
  correlationId: string;
  runId: number;
  htmlUrl: string;
}

export interface CompletedRun extends DispatchedRun {
  conclusion: string | null;
}

/** SARIF payloads by artifact name, e.g. { "sarif-trivy": "<json>", "scan-meta": "<json>" }. */
export type ArtifactContents = Record<string, string>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Dispatch scan.yml with a client-generated correlation UUID, then find the
 * resulting run by matching the UUID embedded in its run-name (the dispatch
 * API returns no run id).
 */
export async function dispatchScan(options: {
  targetRepo: string;
  targetRef?: string;
  onProgress?: (msg: string) => void;
}): Promise<DispatchedRun> {
  const octokit = getOctokit();
  const { proofhouseScanOwner, proofhouseScanRepo } = getConfig();
  const correlationId = randomUUID();
  const progress = options.onProgress ?? (() => {});

  const { data: repoInfo } = await octokit.rest.repos.get({
    owner: proofhouseScanOwner,
    repo: proofhouseScanRepo,
  });

  await octokit.rest.actions.createWorkflowDispatch({
    owner: proofhouseScanOwner,
    repo: proofhouseScanRepo,
    workflow_id: WORKFLOW_FILE,
    ref: repoInfo.default_branch,
    inputs: {
      target_repo: options.targetRepo,
      target_ref: options.targetRef ?? "",
      correlation_id: correlationId,
    },
  });
  progress(`Dispatched scan of ${options.targetRepo} (${correlationId})`);

  // Correlate: poll recent workflow_dispatch runs until one's run-name
  // contains our UUID. Cap at 2 minutes.
  const deadline = Date.now() + 2 * 60 * 1000;
  while (Date.now() < deadline) {
    const { data } = await octokit.rest.actions.listWorkflowRuns({
      owner: proofhouseScanOwner,
      repo: proofhouseScanRepo,
      workflow_id: WORKFLOW_FILE,
      event: "workflow_dispatch",
      per_page: 20,
    });
    const run = data.workflow_runs.find((r) =>
      (r.name ?? "").includes(correlationId),
    );
    if (run) {
      progress(`Found workflow run ${run.id}: ${run.html_url}`);
      return { correlationId, runId: run.id, htmlUrl: run.html_url };
    }
    await sleep(5000);
  }
  throw new Error(
    `Timed out finding the workflow run for correlation ${correlationId}. ` +
      `Check that ${proofhouseScanOwner}/${proofhouseScanRepo} contains .github/workflows/${WORKFLOW_FILE}.`,
  );
}

/** Poll a run until it completes (default cap 30 minutes). */
export async function waitForRun(
  run: DispatchedRun,
  options: { timeoutMs?: number; onProgress?: (msg: string) => void } = {},
): Promise<CompletedRun> {
  const octokit = getOctokit();
  const { proofhouseScanOwner, proofhouseScanRepo } = getConfig();
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
  const progress = options.onProgress ?? (() => {});
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";

  while (Date.now() < deadline) {
    const { data } = await octokit.rest.actions.getWorkflowRun({
      owner: proofhouseScanOwner,
      repo: proofhouseScanRepo,
      run_id: run.runId,
    });
    if (data.status !== lastStatus) {
      lastStatus = data.status ?? "";
      progress(`Run status: ${lastStatus}`);
    }
    if (data.status === "completed") {
      return { ...run, conclusion: data.conclusion };
    }
    await sleep(10_000);
  }
  throw new Error(`Workflow run ${run.runId} did not complete in time`);
}

/**
 * Download all artifacts of a run and extract each artifact's first file as a
 * UTF-8 string. Artifacts can be listed late after completion — retry briefly.
 */
export async function downloadArtifacts(runId: number): Promise<ArtifactContents> {
  const octokit = getOctokit();
  const { proofhouseScanOwner, proofhouseScanRepo } = getConfig();

  let artifacts: { id: number; name: string }[] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data } = await octokit.rest.actions.listWorkflowRunArtifacts({
      owner: proofhouseScanOwner,
      repo: proofhouseScanRepo,
      run_id: runId,
      per_page: 50,
    });
    artifacts = data.artifacts;
    if (artifacts.length > 0) break;
    await sleep(5000);
  }

  const contents: ArtifactContents = {};
  for (const artifact of artifacts) {
    const { data } = await octokit.rest.actions.downloadArtifact({
      owner: proofhouseScanOwner,
      repo: proofhouseScanRepo,
      artifact_id: artifact.id,
      archive_format: "zip",
    });
    const zip = new AdmZip(Buffer.from(data as ArrayBuffer));
    const entry = zip.getEntries().find((e) => !e.isDirectory);
    if (entry) contents[artifact.name] = entry.getData().toString("utf8");
  }
  return contents;
}
