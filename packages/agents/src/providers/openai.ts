import type {
  AIProvider,
  ChatMessage,
  CompletionChunk,
  CompletionRequest,
} from "../types.js";
import { ProviderError } from "../types.js";
import { parseSSE } from "./sse.js";

export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

/**
 * OpenAI Chat Completions provider (streaming, native tool calling) via
 * `fetch`. Works against any OpenAI-compatible endpoint by overriding
 * `baseUrl` (Azure, local gateways, etc.).
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
        tools: request.tools?.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        messages: mapMessages(request.messages),
      }),
      signal: request.signal,
    });

    if (!res.ok || !res.body) {
      throw new ProviderError("openai", await safeError(res), res.status);
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: "stop" | "tool_calls" | "length" = "stop";
    // Tool call fragments accumulate by index until the stream ends.
    const pending = new Map<number, { id: string; name: string; args: string }>();

    for await (const data of parseSSE(res.body)) {
      const event = safeJson(data);
      if (!event) continue;
      const choice = event.choices?.[0];
      if (choice?.delta?.content) {
        yield { type: "text", delta: choice.delta.content };
      }
      for (const frag of choice?.delta?.tool_calls ?? []) {
        const slot = pending.get(frag.index) ?? { id: "", name: "", args: "" };
        if (frag.id) slot.id = frag.id;
        if (frag.function?.name) slot.name += frag.function.name;
        if (frag.function?.arguments) slot.args += frag.function.arguments;
        pending.set(frag.index, slot);
      }
      if (choice?.finish_reason === "length") finishReason = "length";
      if (choice?.finish_reason === "tool_calls") finishReason = "tool_calls";
      if (event.usage) {
        inputTokens = event.usage.prompt_tokens ?? inputTokens;
        outputTokens = event.usage.completion_tokens ?? outputTokens;
      }
    }

    for (const [, slot] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
      yield {
        type: "tool_call",
        call: { id: slot.id, name: slot.name, arguments: safeJson(slot.args || "{}") ?? {} },
      };
    }

    yield { type: "done", usage: { inputTokens, outputTokens }, finishReason };
  }
}

/** Map neutral messages to OpenAI wire format, including tool history. */
function mapMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      };
    }
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content };
    }
    return { role: m.role, content: m.content };
  });
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
