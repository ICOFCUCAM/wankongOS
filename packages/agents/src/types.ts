import type { ProviderId } from "@wankong/core";

/** A single turn in a model conversation. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** For role "tool": the id of the tool call this responds to. */
  toolCallId?: string;
  /** Display name of the speaker (e.g. the employee or human user). */
  name?: string;
}

/** A tool the model may call, described in a provider-neutral way. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
  /**
   * Regex sources the hermetic local provider uses to decide when to call this
   * tool (cloud models decide natively and ignore these). Explicit triggers
   * keep offline behaviour deterministic instead of fuzzy.
   */
  triggers?: string[];
}

/** A tool invocation emitted by the model. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  /** Abort the underlying request. */
  signal?: AbortSignal;
}

/** Streamed output units. */
export type CompletionChunk =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "done"; usage: TokenUsage; finishReason: "stop" | "tool_calls" | "length" };

export interface CompletionResult {
  text: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  finishReason: "stop" | "tool_calls" | "length";
  provider: ProviderId;
  model: string;
}

/**
 * The one interface every model backend implements. Nothing above this line
 * knows whether it's talking to Anthropic, OpenAI, Google, or a local model —
 * that is the whole point. Providers stream; `complete()` is a convenience that
 * drains the stream.
 */
export interface AIProvider {
  readonly id: ProviderId;
  readonly defaultModel: string;
  stream(request: CompletionRequest): AsyncIterable<CompletionChunk>;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderId,
    message: string,
    public readonly status?: number,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}

/** Rough token estimate (~4 chars/token) used for local/offline accounting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Drain a provider stream into a single accumulated result. */
export async function drain(
  provider: AIProvider,
  request: CompletionRequest,
): Promise<CompletionResult> {
  let text = "";
  const toolCalls: ToolCall[] = [];
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let finishReason: CompletionResult["finishReason"] = "stop";

  for await (const chunk of provider.stream(request)) {
    if (chunk.type === "text") text += chunk.delta;
    else if (chunk.type === "tool_call") toolCalls.push(chunk.call);
    else {
      usage = chunk.usage;
      finishReason = chunk.finishReason;
    }
  }

  return {
    text,
    toolCalls,
    usage,
    finishReason,
    provider: provider.id,
    model: request.model ?? provider.defaultModel,
  };
}
