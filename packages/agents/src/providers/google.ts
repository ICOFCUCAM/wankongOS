import type { AIProvider, CompletionChunk, CompletionRequest } from "../types.js";
import { ProviderError } from "../types.js";
import { parseSSE } from "./sse.js";

export interface GoogleConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

/** Google Gemini provider (streaming `generateContent`) via `fetch`. */
export class GoogleProvider implements AIProvider {
  readonly id = "google" as const;
  readonly defaultModel: string;
  private readonly baseUrl: string;

  constructor(private readonly config: GoogleConfig) {
    if (!config.apiKey) throw new ProviderError("google", "apiKey is required");
    this.defaultModel = config.defaultModel ?? "gemini-1.5-pro";
    this.baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  async *stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const model = request.model ?? this.defaultModel;
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const contents = request.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(
      this.config.apiKey,
    )}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: request.maxTokens,
        },
      }),
      signal: request.signal,
    });

    if (!res.ok || !res.body) {
      throw new ProviderError("google", await safeError(res), res.status);
    }

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const data of parseSSE(res.body)) {
      const event = safeJson(data);
      if (!event) continue;
      const text = event.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? "")
        .join("");
      if (text) yield { type: "text", delta: text };
      if (event.usageMetadata) {
        inputTokens = event.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = event.usageMetadata.candidatesTokenCount ?? outputTokens;
      }
    }

    yield { type: "done", usage: { inputTokens, outputTokens }, finishReason: "stop" };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

async function safeError(res: Response): Promise<string> {
  try {
    const body = await res.text();
    return body.slice(0, 500) || res.statusText;
  } catch {
    return res.statusText;
  }
}
