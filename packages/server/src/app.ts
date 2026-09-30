import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { getLocalConfig, openDb, type Db } from "@proofhouse-scan/core";
import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
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

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildApp(db?: Db): FastifyInstance {
  const config = getLocalConfig();
  const database = db ?? openDb(config.dbPath);
  // SARIF payloads are large; limit applies to the decompressed body.
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });

  // Auth hook FIRST so every later-registered route (incl. static/SPA
  // fallback) inherits it. Static assets stay public; data does not.
  // Tokens unset => open, which keeps local dev friction-free.
  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0] ?? request.url;
    if (!url.startsWith("/api/")) return;
    if (url === "/api/health") return;
    // Ingest falls back to the api token so enabling auth never leaves it open.
    const required = url.startsWith("/api/ingest")
      ? (config.ingestToken ?? config.apiToken)
      : config.apiToken;
    if (!required) return;
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!tokenMatches(token, required)) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

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

  // Bearer-token auth (no cookies), so reflected CORS origins carry no
  // ambient-credential risk.
  app.register(fastifyCors, { origin: true });

  app.get("/api/health", () => ({ ok: true }));
  // Protected by the auth hook — the web login validates tokens against it.
  app.get("/api/auth/check", () => ({ ok: true }));

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
