import type {
  AIProvider,
  ChatMessage,
  CompletionChunk,
  CompletionRequest,
  ToolCall,
} from "../types.js";
import { ProviderError } from "../types.js";
import { parseSSE } from "./sse.js";

export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  anthropicVersion?: string;
}

/**
 * Anthropic Messages API provider (streaming, native tool use), implemented
 * with `fetch` so the package carries no SDK dependency. Reads secrets from
 * config only — never from ambient globals — so callers control credentials.
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
        messages: mapMessages(request.messages),
        tools: request.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
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
    // Accumulate tool_use blocks: id/name from content_block_start, args from
    // input_json_delta chunks, emitted on content_block_stop.
    const pendingTool = new Map<number, { id: string; name: string; json: string }>();

    for await (const data of parseSSE(res.body)) {
      const event = safeJson(data);
      if (!event) continue;
      switch (event.type) {
        case "message_start":
          inputTokens = event.message?.usage?.input_tokens ?? 0;
          break;
        case "content_block_start":
          if (event.content_block?.type === "tool_use") {
            pendingTool.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              json: "",
            });
          }
          break;
        case "content_block_delta":
          if (event.delta?.type === "text_delta") {
            yield { type: "text", delta: event.delta.text ?? "" };
          } else if (event.delta?.type === "input_json_delta") {
            const pending = pendingTool.get(event.index);
            if (pending) pending.json += event.delta.partial_json ?? "";
          }
          break;
        case "content_block_stop": {
          const pending = pendingTool.get(event.index);
          if (pending) {
            pendingTool.delete(event.index);
            yield {
              type: "tool_call",
              call: {
                id: pending.id,
                name: pending.name,
                arguments: safeJson(pending.json || "{}") ?? {},
              },
            };
          }
          break;
        }
        case "message_delta":
          outputTokens = event.usage?.output_tokens ?? outputTokens;
          if (event.delta?.stop_reason === "max_tokens") finishReason = "length";
          if (event.delta?.stop_reason === "tool_use") finishReason = "tool_calls";
          break;
      }
    }

    yield { type: "done", usage: { inputTokens, outputTokens }, finishReason };
  }
}

/** Map neutral messages to Anthropic content blocks, including tool history. */
function mapMessages(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...m.toolCalls.map((call: ToolCall) => ({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.arguments,
          })),
        ],
      });
    } else if (m.role === "tool") {
      out.push({
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content },
        ],
      });
    } else if (m.role === "user" || m.role === "assistant") {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
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
