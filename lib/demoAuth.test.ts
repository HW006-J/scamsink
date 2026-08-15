import { describe, expect, it } from "vitest";
import { DEMO_SECRET_HEADER, isAuthorizedDemoOperator } from "./demoAuth";

function requestWithSecret(secret: string | null): Request {
  const headers = new Headers();
  if (secret !== null) headers.set(DEMO_SECRET_HEADER, secret);
  return new Request("https://scamsink.example.com/api/demo/start-call", {
    method: "POST",
    headers,
  });
}

describe("isAuthorizedDemoOperator", () => {
  const expected = "correct-horse-battery-staple";

  it("accepts a request with the matching secret", () => {
    expect(isAuthorizedDemoOperator(requestWithSecret(expected), expected)).toBe(true);
  });

  it("rejects a request with the wrong secret", () => {
    expect(isAuthorizedDemoOperator(requestWithSecret("wrong-secret"), expected)).toBe(false);
  });

  it("rejects a request with no secret header at all", () => {
    expect(isAuthorizedDemoOperator(requestWithSecret(null), expected)).toBe(false);
  });

  it("rejects an empty-string secret", () => {
    expect(isAuthorizedDemoOperator(requestWithSecret(""), expected)).toBe(false);
  });

  it("does not throw when the provided secret has a different length than expected", () => {
    expect(() => isAuthorizedDemoOperator(requestWithSecret("short"), expected)).not.toThrow();
    expect(isAuthorizedDemoOperator(requestWithSecret("short"), expected)).toBe(false);
  });
});
