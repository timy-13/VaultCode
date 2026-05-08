import type { HarnessConfig } from "../config/config.js";
import { MockProvider } from "./mock-provider.js";
import { OpenAiProvider } from "./openai-provider.js";
import { OpenCodeProvider } from "./opencode-provider.js";
import type { ProviderAdapter } from "./types.js";

export function createProvider(config: HarnessConfig): ProviderAdapter {
  switch (config.provider) {
    case "mock":
      return new MockProvider();
    case "openai":
      return new OpenAiProvider(config);
    case "opencode":
      return new OpenCodeProvider(config);
    case "anthropic":
      throw new Error("Provider anthropic is not implemented yet.");
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}
