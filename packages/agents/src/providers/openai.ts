import type { AIProvider, CompletionChunk, CompletionRequest } from "../types.js";
import { ProviderError } from "../types.js";
import { parseSSE } from "./sse.js";

export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

/**
 * OpenAI Chat Completions provider (streaming) via `fetch`. Works against any
 * OpenAI-compatible endpoint by overriding `baseUrl` (Azure, local gateways,
 * etc.), which keeps us from locking into a single vendor's hosting.
 */
export class OpenAIProvider implements AIProvider {
  readonly id = "openai" as const;
  readonly defaultModel: string;
  private readonly baseUrl: string;

  constructor(private readonly config: OpenAIConfig) {
    if (!config.apiKey) throw new ProviderError("openai", "apiKey is required");
    this.defaultModel = config.defaultModel ?? "gpt-4o";
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  }

  async *stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model ?? this.defaultModel,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        messages: request.messages.map((m) => ({
          role: m.role === "tool" ? "tool" : m.role,
          content: m.content,
          ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        })),
      }),
      signal: request.signal,
    });

    if (!res.ok || !res.body) {
      throw new ProviderError("openai", await safeError(res), res.status);
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: "stop" | "tool_calls" | "length" = "stop";

    for await (const data of parseSSE(res.body)) {
      const event = safeJson(data);
      if (!event) continue;
      const choice = event.choices?.[0];
      if (choice?.delta?.content) {
        yield { type: "text", delta: choice.delta.content };
      }
      if (choice?.finish_reason === "length") finishReason = "length";
      if (event.usage) {
        inputTokens = event.usage.prompt_tokens ?? inputTokens;
        outputTokens = event.usage.completion_tokens ?? outputTokens;
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
