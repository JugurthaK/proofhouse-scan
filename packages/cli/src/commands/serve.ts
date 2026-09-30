import { getLocalConfig } from "@proofhouse-scan/core";
import { startServer } from "@proofhouse-scan/server";
import type { Command } from "commander";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the proofhouse-scan web UI and API")
    .option("--port <port>", "port to listen on")
    .option("--host <host>", "address to bind (default: HOST env or 127.0.0.1)")
    .action(async (options: { port?: string; host?: string }) => {
      const port = options.port ? Number(options.port) : getLocalConfig().port;
      await startServer(port, options.host);
      console.log(`proofhouse-scan UI running at http://localhost:${port}`);
    });
}
