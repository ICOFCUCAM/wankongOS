import type {
  AIProvider,
  ChatMessage,
  CompletionChunk,
  CompletionRequest,
} from "../types.js";
import { ProviderError } from "../types.js";
import { parseSSE } from "./sse.js";

export interface GoogleConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

/** Google Gemini provider (streaming `generateContent`, native function calling) via `fetch`. */
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

    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(
      this.config.apiKey,
    )}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: mapMessages(request.messages),
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        tools: request.tools?.length
          ? [
              {
                functionDeclarations: request.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                })),
              },
            ]
          : undefined,
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
    let sawFunctionCall = false;
    let callSeq = 0;

    for await (const data of parseSSE(res.body)) {
      const event = safeJson(data);
      if (!event) continue;
      for (const part of event.candidates?.[0]?.content?.parts ?? []) {
        if (typeof part.text === "string" && part.text) {
          yield { type: "text", delta: part.text };
        }
        if (part.functionCall?.name) {
          sawFunctionCall = true;
          yield {
            type: "tool_call",
            call: {
              // Gemini has no call ids; synthesize stable ones per position.
              id: `gcall_${++callSeq}_${part.functionCall.name}`,
              name: part.functionCall.name,
              arguments: part.functionCall.args ?? {},
            },
          };
        }
      }
      if (event.usageMetadata) {
        inputTokens = event.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = event.usageMetadata.candidatesTokenCount ?? outputTokens;
      }
    }

    yield {
      type: "done",
      usage: { inputTokens, outputTokens },
      finishReason: sawFunctionCall ? "tool_calls" : "stop",
    };
  }
}

/** Map neutral messages to Gemini contents, including tool history. */
function mapMessages(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "model",
        parts: [
          ...(m.content ? [{ text: m.content }] : []),
          ...m.toolCalls.map((call) => ({
            functionCall: { name: call.name, args: call.arguments },
          })),
        ],
      });
    } else if (m.role === "tool") {
      out.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: m.toolName ?? "tool",
              response: { result: m.content },
            },
          },
        ],
      });
    } else {
      out.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      });
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
