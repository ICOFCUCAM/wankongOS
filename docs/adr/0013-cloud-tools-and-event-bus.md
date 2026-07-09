# ADR-0013: Native cloud tool-calling and the outbound event bus

- Status: Accepted
- Date: 2026-07-09

## Context

The agent loop (ADR-0011) and MCP bridge (ADR-0012) ran tools with the local
provider's trigger heuristics; production models must decide tool use natively
and construct schema-true arguments. Separately, companies building on the OS
need to react to what the workforce does without polling.

## Decision

**Native tool-calling per provider.** The neutral `ChatMessage` carries
structured tool history (`toolCalls` on assistant turns; `toolCallId`/`toolName`
on results), and each provider maps it to its wire format:
- *Anthropic*: `tools[].input_schema`; streamed `tool_use` blocks assembled from
  `input_json_delta` fragments; history as `tool_use`/`tool_result` blocks.
- *OpenAI*: `tools[].function`; streamed `tool_calls` fragments accumulated by
  index; history as `tool_calls`/`role:"tool"` messages.
- *Gemini*: `functionDeclarations`; `functionCall` parts (ids synthesized —
  Gemini has none); history as `functionCall`/`functionResponse` parts.
Providers are fixture-tested: stubbed `fetch` returns genuine SSE bodies and
tests assert both the parsed tool calls and the outbound request mapping.

**Outbound event bus.** Domain events (`task.created`, `employee.hired`,
`approval.decided`, `workflow.run.*`) deliver to registered webhooks as JSON
with an `x-wankong-signature: sha256=<HMAC(secret, rawBody)>` header. Webhooks
subscribe to specific types or `*`; secrets are shown once at creation.
Delivery is awaited with a 3s bound; failures are audited and never break the
emitting operation. A queued, retrying dispatcher arrives with `apps/worker`.

## Consequences

- The same agent loop now works identically across local, Anthropic, OpenAI,
  and Gemini backends — including schema-true MCP tool arguments.
- Receivers can verify event authenticity offline (recompute the HMAC).
- Synchronous delivery adds bounded latency to emitting requests; accepted
  until the worker exists, and capped by the 3-second timeout.
