import type { ToolDefinition } from "./types.js";

/** Execution context handed to every tool so it can act on behalf of an employee. */
export interface ToolContext {
  organizationId: string;
  employeeId: string;
  /** Permissions the employee holds; tools must check before privileged acts. */
  permissions: readonly string[];
}

export interface Tool<Args = Record<string, unknown>> {
  definition: ToolDefinition;
  /** Permission required to run, if any. */
  requires?: string;
  run(args: Args, ctx: ToolContext): Promise<unknown>;
}

export class ToolError extends Error {}

/**
 * A registry of tools an employee can call. Kept provider-neutral: the same
 * tool definitions are exposed to any model backend, and execution is gated on
 * the employee's permissions so a model can never exceed its authorization.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(id: string, tool: Tool): this {
    this.tools.set(id, tool);
    return this;
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  /** All registered (id, tool) pairs — lets callers compose registries. */
  entries(): IterableIterator<[string, Tool]> {
    return this.tools.entries();
  }

  /** Definitions for a subset of tool ids (an employee's `toolIds`). */
  definitionsFor(ids: readonly string[]): ToolDefinition[] {
    return ids.map((id) => this.tools.get(id)?.definition).filter((d): d is ToolDefinition => !!d);
  }

  async execute(id: string, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
    const tool = this.tools.get(id);
    if (!tool) throw new ToolError(`Unknown tool: ${id}`);
    if (tool.requires && !ctx.permissions.includes(tool.requires)) {
      throw new ToolError(`Tool "${id}" requires permission "${tool.requires}"`);
    }
    return tool.run(args, ctx);
  }
}
