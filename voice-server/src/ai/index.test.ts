import { describe, expect, it } from "vitest";
import { createAIProvider } from "./index.js";
import { GroqProvider } from "./groq.js";
import { AnthropicProvider } from "./anthropic.js";
import type { Env } from "../env.js";

function envWith(overrides: Partial<Env>): Env {
  return {
    DATABASE_URL: "postgres://localhost/test",
    TWILIO_AUTH_TOKEN: "twilio-token",
    VOICE_SERVER_SHARED_SECRET: "a-very-long-shared-secret-value",
    PUBLIC_APP_URL: "https://scamsink.example.com",
    AI_PROVIDER: "groq",
    GROQ_API_KEY: "gsk_test",
    GROQ_MODEL: "openai/gpt-oss-20b",
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_MODEL: "claude-haiku-4-5",
    PORT: 8080,
    ...overrides,
  };
}

describe("createAIProvider", () => {
  it("selects GroqProvider when AI_PROVIDER=groq", () => {
    const provider = createAIProvider(envWith({ AI_PROVIDER: "groq", GROQ_API_KEY: "gsk_test" }));
    expect(provider).toBeInstanceOf(GroqProvider);
  });

  it("selects AnthropicProvider when AI_PROVIDER=anthropic", () => {
    const provider = createAIProvider(
      envWith({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-test" }),
    );
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });
});
