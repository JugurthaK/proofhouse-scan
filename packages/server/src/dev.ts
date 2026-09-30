// Standalone dev entry: `pnpm --filter @proofhouse-scan/server dev`
import { getLocalConfig } from "@proofhouse-scan/core";
import { startServer } from "./app.js";

const { port } = getLocalConfig();
await startServer(port);
console.log(`proofhouse-scan API running at http://localhost:${port}`);
