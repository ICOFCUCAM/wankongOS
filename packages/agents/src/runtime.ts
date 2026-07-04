import type { Employee } from "@wankong/core";
import type { ProviderRegistry } from "./registry.js";
import { buildSystemPrompt, type PromptContext } from "./prompt.js";
import {
  drain,
  type ChatMessage,
  type CompletionChunk,
  type CompletionResult,
} from "./types.js";

export interface RunParams {
  employee: Employee;
  context: PromptContext;
  /** Prior turns (user/assistant), oldest first. */
  history?: ChatMessage[];
  /** The new user input for this turn. */
  input: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Runs an AI employee for a single turn.
 *
 * The runtime is the seam between the domain (an `Employee` with its identity,
 * rules, and pinned model) and the raw provider interface. It assembles the
 * system prompt, chooses the employee's provider (or the org default), streams
 * the completion, and reports token usage for cost tracking — without any
 * caller needing to know which model answered.
 */
export class EmployeeRuntime {
  constructor(private readonly registry: ProviderRegistry) {}

  private buildMessages(params: RunParams): ChatMessage[] {
    const system = buildSystemPrompt(params.employee, params.context);
    return [
      { role: "system", content: system },
      ...(params.history ?? []),
      { role: "user", content: params.input },
    ];
  }

  /** Stream the employee's response chunk-by-chunk. */
  stream(params: RunParams): AsyncIterable<CompletionChunk> {
    const provider = this.registry.get(params.employee.provider);
    return provider.stream({
      messages: this.buildMessages(params),
      model: params.employee.model,
      temperature: params.employee.temperature,
      maxTokens: params.maxTokens,
      tools: undefined,
      signal: params.signal,
    });
  }

  /** Run to completion, returning the full text, usage, and provider used. */
  async complete(params: RunParams): Promise<CompletionResult> {
    const provider = this.registry.get(params.employee.provider);
    return drain(provider, {
      messages: this.buildMessages(params),
      model: params.employee.model,
      temperature: params.employee.temperature,
      maxTokens: params.maxTokens,
      signal: params.signal,
    });
  }
}
