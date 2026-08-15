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
  Object.assign(process.env, BASE_ENV);
});

afterEach(() => {
  process.env = originalEnv;
});

describe("loadEnv", () => {
  it("loads successfully with the required vars set", () => {
    expect(() => loadEnv()).not.toThrow();
  });

  it("requires DATABASE_URL", () => {
    delete process.env.DATABASE_URL;
    expect(() => loadEnv()).toThrow(/DATABASE_URL is required/);
  });

  it("requires TWILIO_AUTH_TOKEN", () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    expect(() => loadEnv()).toThrow(/TWILIO_AUTH_TOKEN is required/);
  });

  it("requires VOICE_SERVER_SHARED_SECRET to be at least 16 characters", () => {
    process.env.VOICE_SERVER_SHARED_SECRET = "too-short";
    expect(() => loadEnv()).toThrow(/VOICE_SERVER_SHARED_SECRET/);
  });

  it("requires PUBLIC_APP_URL to be a valid URL", () => {
    process.env.PUBLIC_APP_URL = "not-a-url";
    expect(() => loadEnv()).toThrow(/PUBLIC_APP_URL must be a valid URL/);
  });

  it("defaults PORT to 8080", () => {
    delete process.env.PORT;
    expect(loadEnv().PORT).toBe(8080);
  });

  it("trims stray whitespace from VOICE_SERVER_SHARED_SECRET", () => {
    process.env.VOICE_SERVER_SHARED_SECRET = "  a-very-long-shared-secret-value\n";
    expect(loadEnv().VOICE_SERVER_SHARED_SECRET).toBe("a-very-long-shared-secret-value");
  });

  it("no longer requires or references any AI provider configuration", () => {
    const env = loadEnv();
    expect(env).not.toHaveProperty("AI_PROVIDER");
    expect(env).not.toHaveProperty("GROQ_API_KEY");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });
});
