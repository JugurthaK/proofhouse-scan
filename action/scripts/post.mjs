// Assembles the SARIF payload produced by the action's scanner steps and
// POSTs it (gzipped) to the proofhouse-scan backend. Configuration comes exclusively
// from environment variables so the token never appears in argv or logs.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const apiUrl = (process.env.PROOFHOUSE_SCAN_API_URL ?? "").replace(/\/$/, "");
const token = process.env.PROOFHOUSE_SCAN_TOKEN ?? "";
const failOn = (process.env.PROOFHOUSE_SCAN_FAIL_ON ?? "").trim().toLowerCase();
const scanners = (process.env.PROOFHOUSE_SCAN_SCANNERS ?? "opengrep,trivy,gitleaks")
  .split(",")
  .map((s) => s.trim());
const runnerTemp = process.env.RUNNER_TEMP ?? "/tmp";

if (!apiUrl || !token) {
  console.error("::error::PROOFHOUSE_SCAN_API_URL and PROOFHOUSE_SCAN_TOKEN are required");
  process.exit(1);
}

const sarif = {};
for (const scanner of ["opengrep", "trivy", "gitleaks"]) {
  if (!scanners.includes(scanner)) continue;
  const file = join(runnerTemp, `${scanner}.sarif`);
  if (existsSync(file)) sarif[scanner] = readFileSync(file, "utf8");
  else console.warn(`::warning::${scanner}.sarif not found — skipping`);
}
if (Object.keys(sarif).length === 0) {
  console.error("::error::No SARIF output found to send");
  process.exit(1);
}

const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const repo = process.env.GITHUB_REPOSITORY ?? "";
const runId = process.env.GITHUB_RUN_ID;
const payload = {
  repo,
  commit_sha: process.env.GITHUB_SHA ?? null,
  ref: process.env.GITHUB_REF_NAME ?? null,
  run_id: runId ? Number(runId) : null,
  run_url: runId ? `${serverUrl}/${repo}/actions/runs/${runId}` : null,
  sarif,
};

const body = gzipSync(Buffer.from(JSON.stringify(payload)));
console.log(
  `Sending ${Object.keys(sarif).join(", ")} results for ${repo}@${payload.commit_sha?.slice(0, 8)} ` +
    `(${(body.length / 1024).toFixed(0)} KiB gzipped) to ${apiUrl}`,
);

const res = await fetch(`${apiUrl}/api/ingest`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "content-encoding": "gzip",
  },
  body,
});

const text = await res.text();
if (!res.ok) {
  console.error(`::error::proofhouse-scan ingest failed: HTTP ${res.status} — ${text}`);
  process.exit(1);
}

const result = JSON.parse(text);
const counts = result.counts ?? {};
const newBySeverity = result.new_by_severity ?? {};
console.log(
  `Ingested as scan #${result.scan_id}: ${counts.new ?? 0} new, ` +
    `${counts.open ?? 0} still open, ${counts.reopened ?? 0} reopened, ` +
    `${counts.resolved ?? 0} resolved — ${counts.totalOpen ?? 0} open total`,
);

if (process.env.GITHUB_STEP_SUMMARY) {
  const sevRow = ["critical", "high", "medium", "low", "info"]
    .map((s) => `| ${s} | ${newBySeverity[s] ?? 0} |`)
    .join("\n");
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## proofhouse-scan scan\n\n` +
      `Scan **#${result.scan_id}** — ${counts.new ?? 0} new, ${counts.resolved ?? 0} resolved, ` +
      `**${counts.totalOpen ?? 0} open total**\n\n` +
      `### New findings by severity\n\n| severity | count |\n|---|---|\n${sevRow}\n`,
  );
}

if (failOn) {
  const order = ["critical", "high", "medium", "low"];
  const threshold = order.indexOf(failOn);
  if (threshold === -1) {
    console.warn(`::warning::Unknown fail_on value "${failOn}" — ignoring`);
  } else {
    const failing = order
      .slice(0, threshold + 1)
      .reduce((sum, sev) => sum + (newBySeverity[sev] ?? 0), 0);
    if (failing > 0) {
      console.error(
        `::error::${failing} new finding(s) at or above "${failOn}" severity`,
      );
      process.exit(1);
    }
  }
}
