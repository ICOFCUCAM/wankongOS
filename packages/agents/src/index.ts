/**
 * @wankong/agents — the provider-agnostic AI runtime.
 *
 * One `AIProvider` interface, four backends (Anthropic, OpenAI, Google, and a
 * hermetic local fallback), a registry that selects among them, and an
 * `EmployeeRuntime` that turns a domain `Employee` into a running worker. No
 * app code should ever import a vendor SDK directly — it goes through here.
 */
export * from "./types.js";
export * from "./registry.js";
export * from "./prompt.js";
export * from "./tools.js";
export * from "./runtime.js";
export { LocalProvider } from "./providers/local.js";
export { AnthropicProvider, type AnthropicConfig } from "./providers/anthropic.js";
export { OpenAIProvider, type OpenAIConfig } from "./providers/openai.js";
export { GoogleProvider, type GoogleConfig } from "./providers/google.js";
