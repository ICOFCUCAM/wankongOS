import type { AIProvider, CompletionChunk, CompletionRequest } from "../types.js";
import { ProviderError } from "../types.js";
import { parseSSE } from "./sse.js";

export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  anthropicVersion?: string;
}

/**
 * Anthropic Messages API provider (streaming), implemented with `fetch` so the
 * package carries no SDK dependency. Reads secrets from config only — never
 * from ambient globals — so callers control credential flow.
 */
export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;
  readonly defaultModel: string;
  private readonly baseUrl: string;
  private readonly version: string;

  constructor(private readonly config: AnthropicConfig) {
    if (!config.apiKey) throw new ProviderError("anthropic", "apiKey is required");
    this.defaultModel = config.defaultModel ?? "claude-sonnet-5";
    this.baseUrl = config.baseUrl ?? "https://api.anthropic.com";
    this.version = config.anthropicVersion ?? "2023-06-01";
  }

  async *stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const messages = request.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": this.version,
      },
      body: JSON.stringify({
        model: request.model ?? this.defaultModel,
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature,
        system: system || undefined,
        messages,
        stream: true,
      }),
      signal: request.signal,
    });

    if (!res.ok || !res.body) {
      throw new ProviderError("anthropic", await safeError(res), res.status);
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: "stop" | "tool_calls" | "length" = "stop";

    for await (const data of parseSSE(res.body)) {
      const event = safeJson(data);
      if (!event) continue;
      switch (event.type) {
        case "message_start":
          inputTokens = event.message?.usage?.input_tokens ?? 0;
          break;
        case "content_block_delta":
          if (event.delta?.type === "text_delta") {
            yield { type: "text", delta: event.delta.text ?? "" };
          }
          break;
        case "message_delta":
          outputTokens = event.usage?.output_tokens ?? outputTokens;
          if (event.delta?.stop_reason === "max_tokens") finishReason = "length";
          break;
      }
    }

    yield { type: "done", usage: { inputTokens, outputTokens }, finishReason };
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
