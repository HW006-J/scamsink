export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AIProvider {
  /**
   * Streams a reply token-by-token (so callers can start TTS playback before
   * the full response is ready) and resolves with the complete text.
   */
  streamReply(history: ConversationTurn[], onToken: (token: string) => void): Promise<string>;
}

/** Thrown when the configured AI provider fails or is unreachable. Never caught and papered over with a fake reply. */
export class AIProviderError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AIProviderError";
  }
}
