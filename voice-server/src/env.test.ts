import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const BASE_ENV = {
  DATABASE_URL: "postgres://localhost/test",
  TWILIO_AUTH_TOKEN: "twilio-token",
  VOICE_SERVER_SHARED_SECRET: "a-very-long-shared-secret-value",
  PUBLIC_APP_URL: "https://scamsink.example.com",
};

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  // Start from a clean slate so leftover ANTHROPIC_/GROQ_ vars from the
  // real environment don't leak into these tests.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GROQ_") || key.startsWith("ANTHROPIC_") || key === "AI_PROVIDER") {
      delete process.env[key];
    }
  }
  Object.assign(process.env, BASE_ENV);
});

afterEach(() => {
  process.env = originalEnv;
});

describe("loadEnv", () => {
  it("defaults AI_PROVIDER to groq", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    expect(loadEnv().AI_PROVIDER).toBe("groq");
  });

  it("defaults GROQ_MODEL to openai/gpt-oss-20b", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    expect(loadEnv().GROQ_MODEL).toBe("openai/gpt-oss-20b");
  });

  it("requires GROQ_API_KEY when AI_PROVIDER=groq", () => {
    process.env.AI_PROVIDER = "groq";
    expect(() => loadEnv()).toThrow(/GROQ_API_KEY is required/);
  });

  it("does not require ANTHROPIC_API_KEY when AI_PROVIDER=groq", () => {
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk_test";
    expect(() => loadEnv()).not.toThrow();
  });

  it("requires ANTHROPIC_API_KEY when AI_PROVIDER=anthropic", () => {
    process.env.AI_PROVIDER = "anthropic";
    expect(() => loadEnv()).toThrow(/ANTHROPIC_API_KEY is required/);
  });

  it("does not require GROQ_API_KEY when AI_PROVIDER=anthropic", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(() => loadEnv()).not.toThrow();
    expect(loadEnv().GROQ_API_KEY).toBeUndefined();
  });

  it("accepts the anthropic provider explicitly with its key set", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const env = loadEnv();
    expect(env.AI_PROVIDER).toBe("anthropic");
    expect(env.ANTHROPIC_MODEL).toBe("claude-haiku-4-5");
  });

  it("rejects an unknown AI_PROVIDER value", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.GROQ_API_KEY = "gsk_test";
    expect(() => loadEnv()).toThrow();
  });
});
