import { getConfig, openDb, remediateFinding } from "@proofhouse-scan/core";
import type { Command } from "commander";

export function registerRemediateCommand(program: Command): void {
  program
    .command("remediate")
    .description("Generate a fix for a finding and open a PR on the target repo")
    .argument("<finding-id>", "finding id (see proofhouse-scan list)")
    .action(async (findingId: string) => {
      const config = getConfig();
      const db = openDb(config.dbPath);
      const result = await remediateFinding(db, Number(findingId), {
        onProgress: (msg) => console.log(`  ${msg}`),
      });
      if (result.status === "pr_opened") {
        console.log(`\nPR opened: ${result.prUrl}`);
        if (result.usedFork) console.log(`(via fork ${result.forkFullName})`);
      } else if (result.status === "failed") {
        console.error(`\nRemediation failed: ${result.error}`);
        if (result.patchDiff) {
          console.log(`\nGenerated patch (apply manually):\n${result.patchDiff}`);
        }
        process.exit(1);
      }
    });
}
