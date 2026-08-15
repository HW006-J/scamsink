import type { ConversationTurn } from "./provider.js";

/**
 * Free-tier LLM providers (Groq included) cap tokens-per-minute, and a phone
 * call's transcript grows without bound — so every provider request uses a
 * bounded, most-recent slice of history rather than the full call so far.
 * The system/persona prompt is separate from this and always sent in full.
 */
export const MAX_HISTORY_MESSAGES = 20;

export function boundHistory(
  history: ConversationTurn[],
  maxMessages: number = MAX_HISTORY_MESSAGES,
): ConversationTurn[] {
  if (history.length <= maxMessages) return history;
  return history.slice(history.length - maxMessages);
}
