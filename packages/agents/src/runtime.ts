import type { Employee } from "@wankong/core";
import type { ProviderRegistry } from "./registry.js";
import { buildSystemPrompt, type PromptContext } from "./prompt.js";
import { ToolError, type ToolContext, type ToolRegistry } from "./tools.js";
import {
  drain,
  type ChatMessage,
  type CompletionChunk,
  type CompletionResult,
  type ToolCall,
} from "./types.js";

export interface RunTools {
  registry: ToolRegistry;
  context: ToolContext;
}

export interface RunParams {
  employee: Employee;
  context: PromptContext;
  /** Prior turns (user/assistant), oldest first. */
  history?: ChatMessage[];
  /** The new user input for this turn. */
  input: string;
  /** When provided, the employee can call its tools (agent loop). */
  tools?: RunTools;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** A tool call the employee made this turn, with its outcome. */
export interface ExecutedTool {
  name: string;
  arguments: Record<string, unknown>;
  /** JSON-encoded result, or an error message when ok is false. */
  result: string;
  ok: boolean;
}

export interface RunResult extends CompletionResult {
  executedTools: ExecutedTool[];
}

/** Runtime chunks: provider chunks plus executed-tool notifications. */
export type RunChunk = CompletionChunk | { type: "tool_result"; tool: ExecutedTool };

const MAX_TOOL_ROUNDS = 3;

/**
 * Runs an AI employee for a single turn.
 *
 * The runtime is the seam between the domain (an `Employee` with its identity,
 * rules, and pinned model) and the raw provider interface. It assembles the
 * system prompt, chooses the employee's provider (or the org default), and —
 * when tools are supplied — drives the agent loop: model asks for a tool, the
 * registry executes it under the employee's permissions, the result is fed
 * back, and the model produces the final grounded reply.
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

  private toolDefinitions(params: RunParams) {
    if (!params.tools) return undefined;
    const defs = params.tools.registry.definitionsFor(params.employee.toolIds);
    return defs.length > 0 ? defs : undefined;
  }

  private async executeCall(
    call: ToolCall,
    tools: RunTools,
  ): Promise<ExecutedTool> {
    try {
      const result = await tools.registry.execute(call.name, call.arguments, tools.context);
      return {
        name: call.name,
        arguments: call.arguments,
        result: typeof result === "string" ? result : JSON.stringify(result),
        ok: true,
      };
    } catch (err) {
      const message =
        err instanceof ToolError ? err.message : err instanceof Error ? err.message : String(err);
      return { name: call.name, arguments: call.arguments, result: `Error: ${message}`, ok: false };
    }
  }

  /** Stream the employee's turn, including tool activity, chunk-by-chunk. */
  async *stream(params: RunParams): AsyncIterable<RunChunk> {
    const provider = this.registry.get(params.employee.provider);
    const tools = this.toolDefinitions(params);
    const messages = this.buildMessages(params);

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const pendingCalls: ToolCall[] = [];
      let finish: "stop" | "tool_calls" | "length" = "stop";

      for await (const chunk of provider.stream({
        messages,
        model: params.employee.model,
        temperature: params.employee.temperature,
        maxTokens: params.maxTokens,
        tools,
        signal: params.signal,
      })) {
        if (chunk.type === "tool_call") {
          pendingCalls.push(chunk.call);
          yield chunk;
        } else if (chunk.type === "done") {
          finish = chunk.finishReason;
          yield chunk;
        } else {
          yield chunk;
        }
      }

      if (finish !== "tool_calls" || pendingCalls.length === 0 || !params.tools) return;

      // One structured assistant turn carrying all calls, then their results —
      // providers map this to their native tool-history wire formats.
      messages.push({ role: "assistant", content: "", toolCalls: pendingCalls });
      for (const call of pendingCalls) {
        const executed = await this.executeCall(call, params.tools);
        yield { type: "tool_result", tool: executed };
        messages.push({
          role: "tool",
          content: executed.result,
          toolCallId: call.id,
          toolName: call.name,
        });
      }
    }
  }

  /** Run to completion, returning text, usage, and every tool executed. */
  async complete(params: RunParams): Promise<RunResult> {
    const executedTools: ExecutedTool[] = [];
    let text = "";
    let usage = { inputTokens: 0, outputTokens: 0 };
    let finishReason: CompletionResult["finishReason"] = "stop";

    for await (const chunk of this.stream(params)) {
      if (chunk.type === "text") text += chunk.delta;
      else if (chunk.type === "tool_result") executedTools.push(chunk.tool);
      else if (chunk.type === "done") {
        usage = {
          inputTokens: usage.inputTokens + chunk.usage.inputTokens,
          outputTokens: usage.outputTokens + chunk.usage.outputTokens,
        };
        finishReason = chunk.finishReason;
      }
    }

    const provider = this.registry.get(params.employee.provider);
    return {
      text,
      toolCalls: [],
      usage,
      finishReason,
      provider: provider.id,
      model: params.employee.model ?? provider.defaultModel,
      executedTools,
    };
  }
}

// `drain` remains exported from types.ts for direct provider use.
export { drain };
