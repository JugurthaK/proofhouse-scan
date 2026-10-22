import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { nowIso } from "../db/client.js";
import {
  findings,
  qualifications,
  repos,
  scans,
  type QualificationRow,
} from "../db/schema.js";
import { gatherContext } from "./context.js";
import { generateStructured } from "./generate.js";
import { buildQualifyPrompt, QUALIFY_SYSTEM } from "./prompts.js";
import { getModel, getModelName } from "./provider.js";
import { qualificationSchema } from "./schemas.js";

export function loadFindingBundle(db: Db, findingId: number) {
  const finding = db.select().from(findings).where(eq(findings.id, findingId)).get();
  if (!finding) throw new Error(`Finding ${findingId} not found`);
  const repo = db.select().from(repos).where(eq(repos.id, finding.repoId)).get();
  if (!repo) throw new Error(`Repo ${finding.repoId} not found`);
  const scan =
    db.select().from(scans).where(eq(scans.id, finding.lastSeenScanId)).get() ?? null;
  return { finding, repo, scan };
}

/**
 * Human-triggered LLM triage of one finding. Writes a qualifications history
 * row and updates the finding's denormalized qualification status.
 */
export async function qualifyFinding(
  db: Db,
  findingId: number,
): Promise<QualificationRow> {
  const { finding, repo, scan } = loadFindingBundle(db, findingId);

  const row = db
    .insert(qualifications)
    .values({
      findingId,
      status: "running",
      model: getModelName(),
      createdAt: nowIso(),
    })
    .returning()
    .get();
  db.update(findings)
    .set({ qualification: "qualifying", updatedAt: nowIso() })
    .where(eq(findings.id, findingId))
    .run();

  try {
    const context = await gatherContext(finding, repo, scan);
    const object = await generateStructured({
      model: getModel(),
      schema: qualificationSchema,
      system: QUALIFY_SYSTEM,
      prompt: buildQualifyPrompt(finding, repo, context.text),
    });

    const updated = db
      .update(qualifications)
      .set({
        status: "done",
        verdict: object.verdict,
        confidence: object.confidence,
        reasoning: object.reasoning,
        exploitScenario: object.exploit_scenario ?? null,
        contextFiles: JSON.stringify(context.files),
      })
      .where(eq(qualifications.id, row.id))
      .returning()
      .get();
    db.update(findings)
      .set({ qualification: object.verdict, updatedAt: nowIso() })
      .where(eq(findings.id, findingId))
      .run();
    return updated;
  } catch (err) {
    db.update(qualifications)
      .set({ status: "failed", error: String(err) })
      .where(eq(qualifications.id, row.id))
      .run();
    db.update(findings)
      .set({ qualification: "unqualified", updatedAt: nowIso() })
      .where(eq(findings.id, findingId))
      .run();
    throw err;
  }
}
