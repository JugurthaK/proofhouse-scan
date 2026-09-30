import { getLocalConfig, openDb, repos } from "@proofhouse-scan/core";
import type { Command } from "commander";
import { sql } from "drizzle-orm";

export function registerReposCommand(program: Command): void {
  program
    .command("repos")
    .description("List scanned repositories with open-finding counts")
    .action(() => {
      const db = openDb(getLocalConfig().dbPath);
      const rows = db
        .select({
          id: repos.id,
          repo: repos.fullName,
          lastScanned: repos.lastScannedAt,
          openFindings: sql<number>`(
            select count(*) from findings f
            where f.repo_id = repos.id
              and f.status in ('new','open','reopened')
          )`.as("open_findings"),
        })
        .from(repos)
        .all();
      if (rows.length === 0) {
        console.log("No repos yet — run: proofhouse-scan scan <owner/repo>");
        return;
      }
      console.table(rows);
    });
}
