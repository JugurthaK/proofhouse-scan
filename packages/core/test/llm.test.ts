import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { extractJson, generateStructured } from "../src/llm/generate.js";
import { ollamaApiUrl } from "../src/llm/provider.js";
import { qualificationSchema } from "../src/llm/schemas.js";

const verdict = {
  verdict: "false_positive",
  confidence: 0.9,
  reasoning: "Only reached from test/server.test.js.",
};

function textResult(text: string, finish: "stop" | "length" = "stop") {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: finish, raw: finish },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 10, text: 10, reasoning: 0 },
    },
    warnings: [],
  };
}

function apiError(statusCode: number) {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: "http://localhost:8000/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });
}

const call = (model: MockLanguageModelV4) =>
  generateStructured({ model, schema: qualificationSchema, system: "sys", prompt: "p" });

describe("extractJson", () => {
  it("strips think blocks, fences and prose", () => {
    const text = `<think>maybe {not this}</think>Sure! Here it is:\n\`\`\`json\n{"a": {"b": 1}}\n\`\`\`\nHope that helps.`;
    expect(extractJson(text)).toBe('{"a": {"b": 1}}');
  });

  it("returns null when there is no object", () => {
    expect(extractJson("I cannot help with that.")).toBeNull();
  });
});

describe("generateStructured", () => {
  it("repairs chatty output without a second call", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: textResult("```json\n" + JSON.stringify(verdict) + "\n```"),
    });
    await expect(call(model)).resolves.toMatchObject(verdict);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("retries with the validation error when the shape is wrong", async () => {
    // Small models often answer confidence as a percentage.
    const model = new MockLanguageModelV4({
      doGenerate: [
        textResult(JSON.stringify({ ...verdict, confidence: 85 })),
        textResult(JSON.stringify(verdict)),
      ],
    });
    await expect(call(model)).resolves.toMatchObject(verdict);
    expect(model.doGenerateCalls).toHaveLength(2);
    const retry = model.doGenerateCalls[1]!;
    expect(retry.responseFormat?.type).toBe("json");
    const retryPrompt = JSON.stringify(retry.prompt);
    expect(retryPrompt).toContain("expected number to be <=1");
    expect(retryPrompt).toContain("JSON Schema");
  });

  it("falls back to plain text when the server rejects the response_format", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        if (calls++ === 0) throw apiError(400);
        return textResult(`Here you go: ${JSON.stringify(verdict)}`);
      },
    });
    await expect(call(model)).resolves.toMatchObject(verdict);
    const retry = model.doGenerateCalls[1]!;
    expect(retry.responseFormat?.type ?? "text").toBe("text");
    expect(JSON.stringify(retry.prompt)).toContain("JSON Schema");
  });

  it("reports invalid JSON from the plain-text fallback", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        if (calls++ === 0) throw apiError(400);
        return textResult('{"verdict": "true_positive",}');
      },
    });
    await expect(call(model)).rejects.toThrow(/did not return valid JSON/);
  });

  it("does not retry auth errors", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw apiError(401);
      },
    });
    await expect(call(model)).rejects.toThrow("HTTP 401");
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("reports truncated output instead of retrying", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: textResult('{"verdict": "true_pos', "length"),
    });
    await expect(call(model)).rejects.toThrow(/LLM_NUM_CTX/);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("fails clearly when the retry is still invalid", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [textResult("nope"), textResult('{"verdict": "maybe"}')],
    });
    await expect(call(model)).rejects.toThrow(/still invalid after a retry: it did not match/);
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain("was not valid JSON");
  });
});

describe("ollamaApiUrl", () => {
  it("normalizes server roots and API paths", () => {
    expect(ollamaApiUrl("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434/api");
    expect(ollamaApiUrl("http://gpu-box:11434/")).toBe("http://gpu-box:11434/api");
    expect(ollamaApiUrl("http://gpu-box:11434/api")).toBe("http://gpu-box:11434/api");
    expect(ollamaApiUrl("http://gpu-box:11434/v1")).toBe("http://gpu-box:11434/api");
  });
});
