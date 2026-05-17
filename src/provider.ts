import pc from "picocolors";
import type { ResolvedProvider } from "./config.js";
import type { ChatMessage, StreamThemeResult } from "./manifest.js";

function extractReasoningChunk(reasoningDetail: unknown): string {
  if (typeof reasoningDetail === "string") return reasoningDetail;
  if (typeof reasoningDetail !== "object" || reasoningDetail === null) return "";
  const detail = reasoningDetail as { text?: unknown; summary?: unknown };
  if (typeof detail.text === "string") return detail.text;
  if (typeof detail.summary === "string") return detail.summary;
  return "";
}

function shouldFallbackToNonReasoning(status: number, body: string): boolean {
  if (status === 401 || status === 402 || status === 403) return false;
  const lower = body.toLowerCase();
  if (
    lower.includes("reasoning") || lower.includes("thinking") || lower.includes("unsupported") ||
    lower.includes("unknown field") || lower.includes("invalid parameter") || lower.includes("not support")
  ) return true;
  return status === 400 || status === 422;
}

export async function streamThemeManifest(
  provider: ResolvedProvider,
  messages: ChatMessage[],
  configuredThinking: { effort: string } | null,
  allowImageFallback = false
): Promise<StreamThemeResult> {
  const runStream = async (thinking: { effort: string } | null): Promise<StreamThemeResult> => {
    const startedAt = performance.now();
    const requestBody: Record<string, unknown> = {
      model: provider.model,
      stream: true,
      messages,
    };
    if (thinking) {
      requestBody.reasoning = { effort: thinking.effort };
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${provider.key}`,
      "Content-Type": "application/json",
      ...provider.headers,
    };

    const url = provider.url.endsWith("/chat/completions")
      ? provider.url
      : `${provider.url.replace(/\/$/, "")}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Provider request failed (${response.status}): ${body}`);
    }

    if (!response.body) {
      throw new Error("Provider response body is empty");
    }

    const generationId = response.headers.get("x-generation-id") ?? response.headers.get("x-request-id") ?? null;
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    let contentBuffer = "";
    let usage: StreamThemeResult["usage"] = null;
    let responseModel: string | null = null;
    let timeToThinkingMs: number | null = null;

    const processSseLine = (rawLine: string): boolean => {
      const line = rawLine.trim();
      if (!line || line.startsWith(":")) return false;
      if (!line.startsWith("data:")) return false;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return true;
      if (!payload) return false;

      let parsed: any;
      try { parsed = JSON.parse(payload); } catch { return false; }

      if (parsed?.usage && typeof parsed.usage === "object") usage = parsed.usage as StreamThemeResult["usage"];
      if (typeof parsed?.model === "string") responseModel = parsed.model;

      const delta = parsed?.choices?.[0]?.delta;
      const reasoningDetails = delta?.reasoning_details;
      const content = delta?.content;

      const printChunk = (chunk: string) => {
        if (!chunk) return;
        if (timeToThinkingMs === null) timeToThinkingMs = performance.now() - startedAt;
        process.stdout.write(pc.dim(chunk));
      };

      if (Array.isArray(reasoningDetails)) {
        for (const detail of reasoningDetails) printChunk(extractReasoningChunk(detail));
      } else {
        printChunk(extractReasoningChunk(reasoningDetails));
      }

      if (typeof content === "string") contentBuffer += content;
      return false;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        if (processSseLine(rawLine)) {
          return {
            rawManifest: contentBuffer,
            generationId,
            responseModel,
            usage,
            requestDurationMs: performance.now() - startedAt,
            timeToThinkingMs,
            requestedThinking: thinking,
            usedThinking: thinking,
            thinkingFallbackUsed: false,
            imageFallbackUsed: false,
          };
        }
      }
    }

    if (buffer.length > 0) processSseLine(buffer);

    return {
      rawManifest: contentBuffer,
      generationId,
      responseModel,
      usage,
      requestDurationMs: performance.now() - startedAt,
      timeToThinkingMs,
      requestedThinking: thinking,
      usedThinking: thinking,
      thinkingFallbackUsed: false,
      imageFallbackUsed: false,
    };
  };

  const requestedThinking = configuredThinking;

  try {
    const result = await runStream(requestedThinking);
    return { ...result, requestedThinking, usedThinking: requestedThinking, thinkingFallbackUsed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/^Provider request failed \((\d+)\):\s*(.*)$/s);
    if (requestedThinking && match) {
      const status = Number(match[1]);
      const body = match[2] ?? "";
      if (shouldFallbackToNonReasoning(status, body)) {
        console.log("Reasoning mode not supported for this model/request. Retrying without reasoning.");
        const fallbackResult = await runStream(null);
        return {
          ...fallbackResult,
          requestedThinking,
          usedThinking: null,
          thinkingFallbackUsed: true,
          imageFallbackUsed: false,
        };
      }
    }

    if (allowImageFallback && match) {
      const status = Number(match[1]);
      const body = (match[2] ?? "").toLowerCase();
      const mentionsImageIssue =
        body.includes("image") || body.includes("vision") || body.includes("content part") ||
        body.includes("input modality") || body.includes("unsupported") || body.includes("not support");

      if ((status === 400 || status === 422) && mentionsImageIssue) {
        const strippedMessages = messages.map((msg) => {
          if (!Array.isArray(msg.content)) return msg;
          const textParts = msg.content.filter((part): part is { type: "text"; text: string } => part.type === "text");
          return { ...msg, content: textParts.length > 0 ? textParts.map((p) => p.text).join("\n\n") : "" };
        });
        console.log("Model rejected image inputs for this request. Retrying without image references.");
        const noImageResult = await streamThemeManifest({ ...provider }, strippedMessages, configuredThinking, false);
        return { ...noImageResult, requestedThinking, imageFallbackUsed: true };
      }
    }

    throw error;
  }
}

export async function fetchGenerationMetadata(
  provider: ResolvedProvider,
  generationId: string | null
): Promise<import("./manifest.js").GenerationMetadata | null> {
  if (!generationId) return null;

  const isOpenRouter = provider.url.includes("openrouter.ai");
  if (!isOpenRouter) return null;

  const url = new URL("https://openrouter.ai/api/v1/generation");
  url.searchParams.set("id", generationId);

  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${provider.key}` },
      });
      if (!response.ok) {
        if ((response.status === 404 || response.status === 429) && attempt < 11) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        return null;
      }
      const json = (await response.json()) as {
        data?: {
          id?: unknown; model?: unknown; provider_name?: unknown; total_cost?: unknown;
          usage?: unknown; tokens_prompt?: unknown; tokens_completion?: unknown;
          native_tokens_reasoning?: unknown; generation_time?: unknown; latency?: unknown;
        };
      };
      const data = json.data;
      if (!data || typeof data !== "object") return null;
      return {
        id: typeof data.id === "string" ? data.id : generationId,
        model: typeof data.model === "string" ? data.model : "unknown",
        provider_name: typeof data.provider_name === "string" ? data.provider_name : null,
        total_cost: typeof data.total_cost === "number" ? data.total_cost : 0,
        usage: typeof data.usage === "number" ? data.usage : 0,
        tokens_prompt: typeof data.tokens_prompt === "number" ? data.tokens_prompt : null,
        tokens_completion: typeof data.tokens_completion === "number" ? data.tokens_completion : null,
        native_tokens_reasoning: typeof data.native_tokens_reasoning === "number" ? data.native_tokens_reasoning : null,
        generation_time: typeof data.generation_time === "number" ? data.generation_time : null,
        latency: typeof data.latency === "number" ? data.latency : null,
      };
    } catch {
      if (attempt < 11) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      return null;
    }
  }
  return null;
}

export async function modelSupportsImageInputs(provider: ResolvedProvider): Promise<boolean | null> {
  if (!provider.model) return null;
  if (!provider.url.includes("openrouter.ai")) return null;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models");
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: Array<Record<string, unknown>> };
    const allModels = Array.isArray(payload.data) ? payload.data : [];
    const target = allModels.find((item) => {
      const id = typeof item.id === "string" ? item.id : "";
      const slug = typeof item.slug === "string" ? item.slug : "";
      return id === provider.model || slug === provider.model;
    });
    if (!target) return null;

    const candidates = [
      (target.architecture as { input_modalities?: unknown } | undefined)?.input_modalities,
      target.input_modalities,
      target.modalities,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        const normalized = candidate.filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase());
        if (normalized.some((v) => v.includes("image"))) return true;
        if (normalized.length > 0) return false;
      }
    }
    return null;
  } catch {
    return null;
  }
}
