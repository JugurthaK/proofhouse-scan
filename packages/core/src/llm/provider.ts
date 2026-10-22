import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import { getConfig, type ProofhouseScanConfig } from "../config.js";

type LlmProvider = ProofhouseScanConfig["LLM_PROVIDER"];

const DEFAULT_MODELS: Partial<Record<LlmProvider, string>> = {
  anthropic: "claude-opus-5",
};

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

/**
 * Resolve the configured LLM. Provider-agnostic by design: swap providers via
 * LLM_PROVIDER/LLM_MODEL (+ LLM_BASE_URL for local/self-hosted models) in
 * .env without touching call sites.
 */
export function getModel(): LanguageModel {
  const config = getConfig();
  const model = config.LLM_MODEL || DEFAULT_MODELS[config.LLM_PROVIDER];
  if (!model) {
    throw new Error(`LLM_MODEL is required when LLM_PROVIDER=${config.LLM_PROVIDER}`);
  }
  switch (config.LLM_PROVIDER) {
    case "anthropic": {
      if (!config.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic");
      }
      const anthropic = createAnthropic({ apiKey: config.ANTHROPIC_API_KEY });
      return anthropic(model);
    }
    case "openai": {
      if (!config.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai");
      }
      const openai = createOpenAI({ apiKey: config.OPENAI_API_KEY });
      return openai(model);
    }
    case "ollama": {
      const ollama = createOllama({
        baseURL: ollamaApiUrl(config.LLM_BASE_URL || DEFAULT_OLLAMA_URL),
        headers: config.LLM_API_KEY
          ? { Authorization: `Bearer ${config.LLM_API_KEY}` }
          : undefined,
      });
      // Ollama's default context window is small and silently truncates the
      // prompt — too small for remediation, which sends and returns whole files.
      return wrapLanguageModel({
        model: ollama(model),
        middleware: defaultSettingsMiddleware({
          settings: {
            providerOptions: { ollama: { options: { num_ctx: config.LLM_NUM_CTX } } },
          },
        }),
      });
    }
    case "openai-compatible": {
      if (!config.LLM_BASE_URL) {
        throw new Error("LLM_BASE_URL is required when LLM_PROVIDER=openai-compatible");
      }
      const provider = createOpenAICompatible({
        name: "openai-compatible",
        baseURL: config.LLM_BASE_URL,
        apiKey: config.LLM_API_KEY || undefined,
        // Send the JSON schema (response_format: json_schema). Servers that
        // reject or ignore it are handled by generateStructured's fallback.
        supportsStructuredOutputs: true,
      });
      return provider.chatModel(model);
    }
  }
}

export function getModelName(): string {
  const config = getConfig();
  const model = config.LLM_MODEL || DEFAULT_MODELS[config.LLM_PROVIDER] || "unset";
  return `${config.LLM_PROVIDER}/${model}`;
}

/** Accepts the server root (as in OLLAMA_HOST) or a URL already ending in /api or /v1. */
export function ollamaApiUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "").replace(/\/(api|v1)$/, "")}/api`;
}
