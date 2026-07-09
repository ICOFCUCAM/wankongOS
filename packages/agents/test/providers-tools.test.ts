import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnthropicProvider,
  GoogleProvider,
  OpenAIProvider,
  drain,
  type ChatMessage,
  type ToolDefinition,
} from "@wankong/agents";

/** Build an SSE Response from data payloads. */
function sse(...payloads: unknown[]): Response {
  const body = payloads.map((p) => `data: ${JSON.stringify(p)}\n`).join("\n") + "\ndata: [DONE]\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const TOOLS: ToolDefinition[] = [
  {
    name: "lookup_order",
    description: "Look up an order",
    parameters: { type: "object", properties: { text: { type: "string" } } },
  },
];

const TOOL_HISTORY: ChatMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "where is my order?" },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "call_1", name: "lookup_order", arguments: { text: "order" } }],
  },
  { role: "tool", content: "Order shipped.", toolCallId: "call_1", toolName: "lookup_order" },
];

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response) {
  const spy = vi.fn(async () => response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("Anthropic native tool use", () => {
  it("parses streamed tool_use blocks and maps tools + history on the wire", async () => {
    const spy = stubFetch(
      sse(
        { type: "message_start", message: { usage: { input_tokens: 11 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "lookup_order" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"text":"o' } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'rder 7"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
      ),
    );

    const provider = new AnthropicProvider({ apiKey: "sk-test" });
    const result = await drain(provider, { messages: TOOL_HISTORY, tools: TOOLS });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      { id: "toolu_1", name: "lookup_order", arguments: { text: "order 7" } },
    ]);
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 9 });

    const body = JSON.parse((spy.mock.calls[0] as unknown[])[1]!["body" as never]);
    expect(body.tools[0].input_schema).toEqual(TOOLS[0]!.parameters);
    // Assistant tool call mapped to a tool_use block; result to a tool_result block.
    expect(body.messages[1].content[0]).toMatchObject({ type: "tool_use", id: "call_1" });
    expect(body.messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "call_1" });
  });
});

describe("OpenAI native tool calling", () => {
  it("accumulates streamed tool_call fragments and maps tools + history", async () => {
    const spy = stubFetch(
      sse(
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_x", function: { name: "lookup_order", arguments: '{"te' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'xt":"order 7"}' } }] }, finish_reason: "tool_calls" }] },
        { usage: { prompt_tokens: 5, completion_tokens: 3 }, choices: [] },
      ),
    );

    const provider = new OpenAIProvider({ apiKey: "sk-test" });
    const result = await drain(provider, { messages: TOOL_HISTORY, tools: TOOLS });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      { id: "call_x", name: "lookup_order", arguments: { text: "order 7" } },
    ]);

    const body = JSON.parse((spy.mock.calls[0] as unknown[])[1]!["body" as never]);
    expect(body.tools[0]).toMatchObject({ type: "function", function: { name: "lookup_order" } });
    expect(body.messages[2].tool_calls[0]).toMatchObject({ id: "call_1", type: "function" });
    expect(body.messages[3]).toMatchObject({ role: "tool", tool_call_id: "call_1" });
  });
});

describe("Gemini native function calling", () => {
  it("emits functionCall parts as tool calls and maps declarations + history", async () => {
    const spy = stubFetch(
      sse(
        {
          candidates: [
            { content: { parts: [{ functionCall: { name: "lookup_order", args: { text: "order 7" } } }] } },
          ],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
        },
      ),
    );

    const provider = new GoogleProvider({ apiKey: "g-test" });
    const result = await drain(provider, { messages: TOOL_HISTORY, tools: TOOLS });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls[0]).toMatchObject({
      name: "lookup_order",
      arguments: { text: "order 7" },
    });

    const body = JSON.parse((spy.mock.calls[0] as unknown[])[1]!["body" as never]);
    expect(body.tools[0].functionDeclarations[0].name).toBe("lookup_order");
    expect(body.contents[1].parts[0].functionCall.name).toBe("lookup_order");
    expect(body.contents[2].parts[0].functionResponse).toMatchObject({
      name: "lookup_order",
      response: { result: "Order shipped." },
    });
  });

  it("plain text responses still stream as before", async () => {
    stubFetch(
      sse({
        candidates: [{ content: { parts: [{ text: "Hello there." }] } }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 },
      }),
    );
    const provider = new GoogleProvider({ apiKey: "g-test" });
    const result = await drain(provider, {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("Hello there.");
    expect(result.finishReason).toBe("stop");
  });
});
