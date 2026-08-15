import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "../persona.js";
import { AIProviderError, type AIProvider, type ConversationTurn } from "./provider.js";

const MAX_REPLY_TOKENS = 200;

export class AnthropicProvider implements AIProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async streamReply(
    history: ConversationTurn[],
    onToken: (token: string) => void,
  ): Promise<string> {
    try {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: MAX_REPLY_TOKENS,
        system: SYSTEM_PROMPT,
        messages: history.map((turn) => ({ role: turn.role, content: turn.content })),
      });

      stream.on("text", (delta) => {
        if (delta) onToken(delta);
      });

      const finalMessage = await stream.finalMessage();
      const textBlock = finalMessage.content.find((block) => block.type === "text");
      return textBlock && textBlock.type === "text" ? textBlock.text : "";
    } catch (error) {
      throw new AIProviderError("Anthropic API request failed", error);
    }
  }
}
