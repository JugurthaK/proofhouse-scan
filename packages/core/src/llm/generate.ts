import {
  APICallError,
  generateObject,
  generateText,
  NoObjectGeneratedError,
  TypeValidationError,
  type LanguageModel,
} from "ai";
import { z } from "zod";

const TRUNCATED =
  "The model's output was cut off before the JSON was complete. With Ollama, " +
  "raise LLM_NUM_CTX; otherwise use a model with a larger context/output limit.";
const GIVE_UP = "Try a larger or more capable model.";

interface StructuredRequest<SCHEMA extends z.ZodType> {
  model: LanguageModel;
  schema: SCHEMA;
  system: string;
  prompt: string;
}

/**
 * generateObject with a fallback for models that are weak at structured output
 * (small local models, OpenAI-compatible servers without json_schema support).
 * Chatty output is repaired in place; a response that fails validation gets one
 * retry that tells the model what was wrong; a server that rejects the schema
 * request gets one plain-text attempt with the schema inlined.
 */
export async function generateStructured<SCHEMA extends z.ZodType>(
  request: StructuredRequest<SCHEMA>,
): Promise<z.infer<SCHEMA>> {
  const { model, schema, system, prompt } = request;
  const attempt = async (feedback?: string) => {
    const { object } = await generateObject({
      model,
      schema,
      system: feedback ? `${system}\n\n${feedback}\n\n${jsonInstructions(schema)}` : system,
      prompt,
      repairText: async ({ text }) => extractJson(text),
    });
    return object as z.infer<SCHEMA>;
  };

  try {
    return await attempt();
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      // A retry would be truncated the same way.
      if (err.finishReason === "length") throw new Error(TRUNCATED, { cause: err });
      try {
        return await attempt(`Your previous response was rejected: ${describeInvalid(err)}`);
      } catch (retryErr) {
        if (!NoObjectGeneratedError.isInstance(retryErr)) throw retryErr;
        if (retryErr.finishReason === "length") throw new Error(TRUNCATED, { cause: retryErr });
        throw new Error(
          `The model's response was still invalid after a retry: ${describeInvalid(retryErr)}\n${GIVE_UP}`,
          { cause: retryErr },
        );
      }
    }
    // Request rejected outright, typically "response_format json_schema not supported".
    if (APICallError.isInstance(err) && (err.statusCode === 400 || err.statusCode === 422)) {
      return generateFromText(request);
    }
    throw err;
  }
}

async function generateFromText<SCHEMA extends z.ZodType>({
  model,
  schema,
  system,
  prompt,
}: StructuredRequest<SCHEMA>): Promise<z.infer<SCHEMA>> {
  const { text, finishReason } = await generateText({
    model,
    system: `${system}\n\n${jsonInstructions(schema)}`,
    prompt,
  });
  if (finishReason === "length") throw new Error(TRUNCATED);
  const json = extractJson(text);
  const value = json === null ? undefined : safeJsonParse(json);
  if (value === undefined) throw new Error(`The model did not return valid JSON.\n${GIVE_UP}`);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `The model's response did not match the schema:\n${z.prettifyError(parsed.error)}\n${GIVE_UP}`,
    );
  }
  return parsed.data;
}

/** Short enough to feed back to the model (the raw error embeds the whole response). */
function describeInvalid(err: NoObjectGeneratedError): string {
  const cause = err.cause;
  if (TypeValidationError.isInstance(cause) && cause.cause instanceof z.ZodError) {
    return `it did not match the schema:\n${z.prettifyError(cause.cause)}`;
  }
  return "it was not valid JSON.";
}

function jsonInstructions(schema: z.ZodType): string {
  return `Respond with a single JSON object conforming to this JSON Schema. Output only the JSON — no markdown fences, no commentary.

${JSON.stringify(z.toJSONSchema(schema), null, 2)}`;
}

/** Pull a JSON object out of chatty output: <think> blocks, markdown fences, prose. */
export function extractJson(text: string): string | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return start !== -1 && end > start ? cleaned.slice(start, end + 1) : null;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
