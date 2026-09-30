import {
  findings,
  getLocalConfig,
  openDb,
  repos,
  type Finding,
} from "@proofhouse-scan/core";
import type { Command } from "commander";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";

const SEVERITY_ORDER = "CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END";

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List findings from the local database")
    .option("--repo <owner/repo>", "filter by repository")
    .option("--scanner <scanner>", "opengrep | trivy | gitleaks")
    .option("--severity <severity>", "critical | high | medium | low | info")
    .option("--status <status>", "new | open | resolved | reopened")
    .option("--json", "output JSON instead of a table")
    .action(
      (options: {
        repo?: string;
        scanner?: string;
        severity?: string;
        status?: string;
        json?: boolean;
      }) => {
        const db = openDb(getLocalConfig().dbPath);
        const conditions: SQL[] = [];
        if (options.repo) {
          const repo = db
            .select()
            .from(repos)
            .where(eq(repos.fullName, options.repo))
            .get();
          if (!repo) {
            console.error(`Unknown repo ${options.repo} — scan it first`);
            process.exit(1);
          }
          conditions.push(eq(findings.repoId, repo.id));
        }
        if (options.scanner)
          conditions.push(eq(findings.scanner, options.scanner as Finding["scanner"]));
        if (options.severity)
          conditions.push(eq(findings.severity, options.severity as Finding["severity"]));
        if (options.status)
          conditions.push(eq(findings.status, options.status as Finding["status"]));

        const rows = db
          .select({
            id: findings.id,
            repo: repos.fullName,
            scanner: findings.scanner,
            severity: findings.severity,
            status: findings.status,
            qualification: findings.qualification,
            rule: findings.ruleId,
            file: findings.filePath,
            line: findings.startLine,
          })
          .from(findings)
          .innerJoin(repos, eq(findings.repoId, repos.id))
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(sql.raw(SEVERITY_ORDER), desc(findings.id))
          .all();

        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        if (rows.length === 0) {
          console.log("No findings match.");
          return;
        }
        console.table(
          rows.map((r) => ({
            ...r,
            rule: r.rule.length > 40 ? r.rule.slice(0, 37) + "..." : r.rule,
            file: r.file.length > 40 ? "..." + r.file.slice(-37) : r.file,
          })),
        );
        console.log(`${rows.length} finding(s)`);
      },
    );
}
