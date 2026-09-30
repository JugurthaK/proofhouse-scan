import { getConfig, openDb, runScan } from "@proofhouse-scan/core";
import type { Command } from "commander";

function parseTimeout(value: string): number {
  const match = value.match(/^(\d+)(s|m|h)?$/);
  if (!match) throw new Error(`Invalid timeout "${value}" (e.g. 30m, 900s, 1h)`);
  const n = Number(match[1]);
  const unit = match[2] ?? "m";
  return n * (unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000);
}

export function registerScanCommand(program: Command): void {
  program
    .command("scan")
    .description("Dispatch the scan workflow for a repo and ingest its findings")
    .argument("<repo>", "target repository as owner/repo")
    .option("--ref <ref>", "branch, tag, or commit to scan (default: default branch)")
    .option("--timeout <duration>", "max wait for the workflow run", "30m")
    .action(async (repo: string, options: { ref?: string; timeout: string }) => {
      const config = getConfig();
      const db = openDb(config.dbPath);
      const summary = await runScan(db, {
        targetRepo: repo,
        targetRef: options.ref,
        timeoutMs: parseTimeout(options.timeout),
        onProgress: (msg) => console.log(`  ${msg}`),
      });

      console.log(`\nScan #${summary.scanId} of ${summary.targetRepo} complete`);
      if (summary.commitSha) console.log(`  Commit:   ${summary.commitSha}`);
      console.log(`  Run:      ${summary.runUrl}`);
      console.log(`  Scanners: ${summary.scannersIngested.join(", ")}`);
      if (summary.scannersMissing.length > 0) {
        console.log(`  Missing:  ${summary.scannersMissing.join(", ")} (job failed?)`);
      }
      const c = summary.counts;
      console.log(
        `  Findings: ${c.new} new, ${c.open} still open, ${c.reopened} reopened, ` +
          `${c.resolved} resolved — ${c.totalOpen} open total`,
      );
      console.log(`\nBrowse them with: proofhouse-scan serve`);
    });
}
