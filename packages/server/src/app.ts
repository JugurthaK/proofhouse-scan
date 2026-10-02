import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { getLocalConfig, openDb, type Db } from "@proofhouse-scan/core";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { registerAuth, resolveAuthConfig } from "./auth.js";
import { registerActionRoutes } from "./routes/actions.js";
import { registerFindingRoutes } from "./routes/findings.js";
import { registerIngestRoutes } from "./routes/ingest.js";
import { registerRepoRoutes } from "./routes/repos.js";
import { registerScanRoutes } from "./routes/scans.js";
import { registerStatsRoutes } from "./routes/stats.js";

function findWebDist(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../web/dist"), // from server/src or cli/dist
    resolve(here, "../../../web/dist"), // from server/src/... nested builds
    resolve(process.cwd(), "packages/web/dist"),
  ];
  return candidates.find((c) => existsSync(resolve(c, "index.html"))) ?? null;
}

export function buildApp(db?: Db): FastifyInstance {
  const config = getLocalConfig();
  const database = db ?? openDb(config.dbPath);
  // SARIF payloads are large; limit applies to the decompressed body.
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });

  // Auth hook + /api/auth/* routes FIRST so every later-registered route
  // (incl. static/SPA fallback) inherits the hook. Nothing configured => open,
  // which keeps local dev friction-free.
  const auth = resolveAuthConfig(config);
  if (auth.apiToken && !auth.github) {
    console.warn(
      "PROOFHOUSE_SCAN_API_TOKEN is set but GitHub OAuth is not: the web UI signs in " +
        "with GitHub only. Set GITHUB_OAUTH_CLIENT_ID/SECRET (see .env.example).",
    );
  }
  registerAuth(app, database, auth);

  // Transparent gzip request bodies (the composite action compresses SARIF).
  app.addHook("preParsing", async (request, _reply, payload) => {
    if (request.headers["content-encoding"] === "gzip") {
      // content-length describes the compressed body; drop it so Fastify
      // doesn't reject the (longer) decompressed stream.
      delete request.headers["content-length"];
      delete request.headers["content-encoding"];
      const gunzip = createGunzip();
      payload.pipe(gunzip);
      return gunzip;
    }
    return payload;
  });

  // Credentials stay disabled, so cross-origin pages can never read
  // cookie-authenticated responses (and the auth hook origin-checks unsafe
  // ones); reflected origins only serve bearer-token clients.
  app.register(fastifyCors, { origin: true });

  app.get("/api/health", () => ({ ok: true }));

  registerRepoRoutes(app, database);
  registerScanRoutes(app, database);
  registerFindingRoutes(app, database);
  registerStatsRoutes(app, database);
  registerActionRoutes(app, database);
  registerIngestRoutes(app, database);

  const webDist = findWebDist();
  if (webDist) {
    app.register(fastifyStatic, { root: webDist });
    // SPA fallback: serve index.html for non-API routes.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        reply.code(404).send({ error: "Not found" });
      } else {
        reply.sendFile("index.html");
      }
    });
  }

  return app;
}

export async function startServer(
  port: number,
  host?: string,
): Promise<FastifyInstance> {
  const app = buildApp();
  await app.listen({ port, host: host ?? getLocalConfig().host });
  return app;
}
