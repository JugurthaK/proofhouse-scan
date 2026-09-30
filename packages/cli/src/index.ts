#!/usr/bin/env node
import { Command } from "commander";
import { registerListCommand } from "./commands/list.js";
import { registerQualifyCommand } from "./commands/qualify.js";
import { registerRemediateCommand } from "./commands/remediate.js";
import { registerReposCommand } from "./commands/repos.js";
import { registerScanCommand } from "./commands/scan.js";
import { registerServeCommand } from "./commands/serve.js";

const program = new Command("proofhouse-scan")
  .description(
    "Security scanning for GitHub repositories: SAST (Opengrep), IaC+SCA (Trivy), secrets (GitLeaks), with LLM-assisted triage and fix PRs",
  )
  .version("0.1.0");

registerScanCommand(program);
registerListCommand(program);
registerReposCommand(program);
registerServeCommand(program);
registerQualifyCommand(program);
registerRemediateCommand(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
