import { describe, expect, it, vi, beforeEach } from "vitest";

const { createMock, RateLimitError, APIConnectionTimeoutError, OpenAIMock } = vi.hoisted(() => {
  class RateLimitError extends Error {}
  class APIConnectionTimeoutError extends Error {}
  const createMock = vi.fn();
  class OpenAIMock {
    chat = { completions: { create: createMock } };
  }
  return { createMock, RateLimitError, APIConnectionTimeoutError, OpenAIMock };
});

vi.mock("openai", () => ({
  default: OpenAIMock,
  RateLimitError,
  APIConnectionTimeoutError,
}));

import { SYSTEM_PROMPT } from "../persona.js";
import { AIProviderError } from "./provider.js";
import { GroqProvider } from "./groq.js";

/** Builds a fake OpenAI-compatible streaming response from a list of token strings. */
function fakeStream(tokens: string[]): AsyncIterable<{ choices: [{ delta: { content?: string } }] }> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const token of tokens) {
        yield { choices: [{ delta: { content: token } }] };
      }
    },
  };
}

describe("GroqProvider", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("streams tokens back and returns the full concatenated reply", async () => {
    createMock.mockResolvedValue(fakeStream(["Oh dear. ", "Which account ", "was that?"]));
    const provider = new GroqProvider("gsk_test", "openai/gpt-oss-20b");

    const seen: string[] = [];
    const full = await provider.streamReply(
      [{ role: "user", content: "Suspicious activity on your account." }],
      (token) => seen.push(token),
    );

    expect(full).toBe("Oh dear. Which account was that?");
    expect(seen).toEqual(["Oh dear. ", "Which account ", "was that?"]);
  });

  it("sends the ScamSink system prompt as the first message, and the given model", async () => {
    createMock.mockResolvedValue(fakeStream(["hi"]));
    const provider = new GroqProvider("gsk_test", "openai/gpt-oss-20b");

    await provider.streamReply([{ role: "user", content: "hello" }], () => {});

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-oss-20b",
        stream: true,
        messages: expect.arrayContaining([{ role: "system", content: SYSTEM_PROMPT }]),
      }),
    );
    const call = createMock.mock.calls[0][0];
    expect(call.messages[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
  });

  it("wraps a rate-limit error as AIProviderError without leaking the API key", async () => {
    createMock.mockRejectedValue(new RateLimitError("429 rate limited"));
    const provider = new GroqProvider("gsk_super_secret_key", "openai/gpt-oss-20b");

    await expect(provider.streamReply([{ role: "user", content: "hi" }], () => {})).rejects.toThrow(
      AIProviderError,
    );
    try {
      await provider.streamReply([{ role: "user", content: "hi" }], () => {});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).message).toMatch(/rate limit/i);
      expect((err as AIProviderError).message).not.toContain("gsk_super_secret_key");
    }
  });

  it("wraps a timeout error as AIProviderError", async () => {
    createMock.mockRejectedValue(new APIConnectionTimeoutError("timed out"));
    const provider = new GroqProvider("gsk_test", "openai/gpt-oss-20b");

    await expect(provider.streamReply([{ role: "user", content: "hi" }], () => {})).rejects.toThrow(
      /timed out/i,
    );
  });

  it("wraps a generic provider error as AIProviderError", async () => {
    createMock.mockRejectedValue(new Error("boom"));
    const provider = new GroqProvider("gsk_test", "openai/gpt-oss-20b");

    await expect(provider.streamReply([{ role: "user", content: "hi" }], () => {})).rejects.toBeInstanceOf(
      AIProviderError,
    );
  });
});
