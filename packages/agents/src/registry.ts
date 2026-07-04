import type { ProviderId } from "@wankong/core";
import type { AIProvider } from "./types.js";
import { ProviderError } from "./types.js";
import { LocalProvider } from "./providers/local.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { GoogleProvider } from "./providers/google.js";

export interface RegistryConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  /** Provider used when an employee doesn't pin one. Defaults to `local`. */
  defaultProvider?: ProviderId;
}

/**
 * Selects a concrete provider by id. Because the local provider always exists,
 * the registry can always satisfy a request in development/CI; cloud providers
 * are constructed lazily and only when their key is present, so missing
 * credentials fail loudly at call time rather than at boot.
 */
export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, AIProvider>();
  readonly defaultProvider: ProviderId;

  constructor(config: RegistryConfig = {}) {
    this.providers.set("local", new LocalProvider());
    if (config.anthropicApiKey) {
      this.providers.set("anthropic", new AnthropicProvider({ apiKey: config.anthropicApiKey }));
    }
    if (config.openaiApiKey) {
      this.providers.set("openai", new OpenAIProvider({ apiKey: config.openaiApiKey }));
    }
    if (config.googleApiKey) {
      this.providers.set("google", new GoogleProvider({ apiKey: config.googleApiKey }));
    }
    this.defaultProvider = config.defaultProvider ?? "local";
  }

  /** Build a registry from environment variables. */
  static fromEnv(env: Record<string, string | undefined> = process.env): ProviderRegistry {
    return new ProviderRegistry({
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      openaiApiKey: env.OPENAI_API_KEY,
      googleApiKey: env.GOOGLE_API_KEY,
      defaultProvider: (env.DEFAULT_AI_PROVIDER as ProviderId) || "local",
    });
  }

  has(id: ProviderId): boolean {
    return this.providers.has(id);
  }

  available(): ProviderId[] {
    return [...this.providers.keys()];
  }

  /** Resolve a provider, falling back to the default, then erroring. */
  get(id?: ProviderId): AIProvider {
    const chosen = id && this.providers.has(id) ? id : this.defaultProvider;
    const provider = this.providers.get(chosen);
    if (!provider) {
      throw new ProviderError(
        chosen,
        `provider "${chosen}" is not configured (available: ${this.available().join(", ")})`,
      );
    }
    return provider;
  }
}
