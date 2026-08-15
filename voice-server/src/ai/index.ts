import type { Env } from "../env.js";
import { AnthropicProvider } from "./anthropic.js";
import { GroqProvider } from "./groq.js";
import type { AIProvider } from "./provider.js";

export type { AIProvider, ConversationTurn } from "./provider.js";
export { AIProviderError } from "./provider.js";
export { boundHistory, MAX_HISTORY_MESSAGES } from "./history.js";

export function createAIProvider(env: Env): AIProvider {
  switch (env.AI_PROVIDER) {
    case "groq":
      // Validated together in env.ts: AI_PROVIDER=groq requires GROQ_API_KEY.
      return new GroqProvider(env.GROQ_API_KEY!, env.GROQ_MODEL);
    case "anthropic":
      // Validated together in env.ts: AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY.
      return new AnthropicProvider(env.ANTHROPIC_API_KEY!, env.ANTHROPIC_MODEL);
    default:
      throw new Error(`Unsupported AI_PROVIDER: ${env.AI_PROVIDER satisfies never}`);
  }
}
