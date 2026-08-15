import OpenAI, { APIConnectionTimeoutError, RateLimitError } from "openai";
import { SYSTEM_PROMPT } from "../persona.js";
import { AIProviderError, type AIProvider, type ConversationTurn } from "./provider.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const MAX_REPLY_TOKENS = 200;
// A live phone call can't tolerate a hung request — fail fast rather than
// leaving the caller in silence.
const REQUEST_TIMEOUT_MS = 8_000;

export class GroqProvider implements AIProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL, timeout: REQUEST_TIMEOUT_MS });
    this.model = model;
  }

  async streamReply(
    history: ConversationTurn[],
    onToken: (token: string) => void,
  ): Promise<string> {
    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: MAX_REPLY_TOKENS,
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history.map((turn) => ({ role: turn.role, content: turn.content }) as const),
        ],
      });

      let full = "";
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content;
        if (token) {
          full += token;
          onToken(token);
        }
      }
      return full;
    } catch (error) {
      if (error instanceof RateLimitError) {
        throw new AIProviderError("Groq rate limit exceeded", error);
      }
      if (error instanceof APIConnectionTimeoutError) {
        throw new AIProviderError("Groq request timed out", error);
      }
      throw new AIProviderError("Groq API request failed", error);
    }
  }
}
