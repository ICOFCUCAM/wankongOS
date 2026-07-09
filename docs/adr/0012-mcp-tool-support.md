# ADR-0012: MCP tool support

- Status: Accepted
- Date: 2026-07-09

## Context

Building a bespoke connector per SaaS product is a treadmill. The Model Context
Protocol is the emerging standard for exposing tools to AI systems; supporting
it lets employees inherit an entire ecosystem of tools through one client.

## Decision

**Dependency-free MCP client** (`@wankong/integrations`) over Streamable HTTP:
JSON-RPC 2.0 `initialize` → `notifications/initialized` → `tools/list` /
`tools/call`, echoing the server's `mcp-session-id`, and handling both plain
JSON and SSE-framed responses.

**Integrations API.** `POST /v1/integrations {kind:"mcp", name, config.url}`
connects, discovers tools, and stores the integration (`connected`) with its
tool inventory; the response returns assignable ids `mcp.<server-slug>.<tool>`.
Unreachable servers are a 502 and nothing is stored. Disconnect deletes the
integration; its tools stop resolving on the next request.

**Composition, not registration.** The per-request tool registry is composed:
built-ins plus a proxy tool per connected MCP tool (ADR-0011's loop executes
them like any other tool, under employee permissions). MCP clients are cached
per server URL so sessions persist across requests. The local provider triggers
on the tool's name in the request and passes `{text}`; cloud models will
construct schema-true arguments natively when their wire formats land (M4c).

**Hermetic tests.** A protocol-faithful in-process MCP server (Hono on an
ephemeral port) exercises initialize/session/list/call — including the SSE
framing and error paths — with zero external dependencies.

## Consequences

- An org can point at any MCP server and grant its tools to specific employees
  in minutes — tool coverage scales with the ecosystem, not with our roadmap.
- Governance is preserved: MCP tools flow through the same permission-gated
  loop, appear in tool chips, and connect/disconnect are audited.
- Auth-protected MCP servers need header support (the client accepts custom
  headers; secret storage for them arrives with credentialed connectors, M4c).
