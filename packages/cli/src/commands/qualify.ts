import { getConfig, openDb, qualifyFinding } from "@proofhouse-scan/core";
import type { Command } from "commander";

export function registerQualifyCommand(program: Command): void {
  program
    .command("qualify")
    .description("Run LLM triage on a finding (true positive vs false positive)")
    .argument("<finding-id>", "finding id (see proofhouse-scan list)")
    .action(async (findingId: string) => {
      const config = getConfig();
      const db = openDb(config.dbPath);
      console.log(`Qualifying finding ${findingId} with ${config.LLM_PROVIDER}/${config.LLM_MODEL}...`);
      const result = await qualifyFinding(db, Number(findingId));
      console.log(`\nVerdict:    ${result.verdict}`);
      console.log(`Confidence: ${result.confidence}`);
      console.log(`Reasoning:  ${result.reasoning}`);
      if (result.exploitScenario) {
        console.log(`Exploit:    ${result.exploitScenario}`);
      }
    });
}
