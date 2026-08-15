import type { Env } from "../env.js";
import { AnthropicProvider } from "./anthropic.js";
import type { AIProvider } from "./provider.js";

export type { AIProvider, ConversationTurn } from "./provider.js";
export { AIProviderError } from "./provider.js";

export function createAIProvider(env: Env): AIProvider {
  switch (env.AI_PROVIDER) {
    case "anthropic":
      return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
    default:
      throw new Error(`Unsupported AI_PROVIDER: ${env.AI_PROVIDER satisfies never}`);
  }
}
