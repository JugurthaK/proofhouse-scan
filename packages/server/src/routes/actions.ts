import {
  findings,
  qualifyFinding,
  remediateFinding,
  type Db,
} from "@proofhouse-scan/core";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

// One in-flight LLM action per finding; the UI polls GET /api/findings/:id.
const inFlight = new Set<string>();

export function registerActionRoutes(app: FastifyInstance, db: Db): void {
  app.post<{ Params: { id: string } }>(
    "/api/findings/:id/qualify",
    (request, reply) => {
      const id = Number(request.params.id);
      const finding = db.select().from(findings).where(eq(findings.id, id)).get();
      if (!finding) return reply.code(404).send({ error: "Finding not found" });

      const key = `qualify:${id}`;
      if (inFlight.has(key)) {
        return reply.code(409).send({ error: "Qualification already running" });
      }
      inFlight.add(key);
      qualifyFinding(db, id)
        .catch((err) => console.error(`Qualification of finding ${id} failed:`, err))
        .finally(() => inFlight.delete(key));
      return reply.code(202).send({ started: true, findingId: id });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/findings/:id/remediate",
    (request, reply) => {
      const id = Number(request.params.id);
      const finding = db.select().from(findings).where(eq(findings.id, id)).get();
      if (!finding) return reply.code(404).send({ error: "Finding not found" });

      const key = `remediate:${id}`;
      if (inFlight.has(key)) {
        return reply.code(409).send({ error: "Remediation already running" });
      }
      inFlight.add(key);
      remediateFinding(db, id)
        .catch((err) => console.error(`Remediation of finding ${id} failed:`, err))
        .finally(() => inFlight.delete(key));
      return reply.code(202).send({ started: true, findingId: id });
    },
  );
}
