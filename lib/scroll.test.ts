import { describe, expect, it } from "vitest";
import { isNearBottom } from "./scroll";

describe("isNearBottom", () => {
  it("is true when scrolled exactly to the bottom", () => {
    expect(isNearBottom(400, 500, 100)).toBe(true); // 500-400-100 = 0
  });

  it("is true within the default threshold above the bottom", () => {
    expect(isNearBottom(350, 500, 100)).toBe(true); // distance = 50 < 80
  });

  it("is false once scrolled further than the default threshold above the bottom", () => {
    expect(isNearBottom(300, 500, 100)).toBe(false); // distance = 100, not < 80
  });

  it("is false when scrolled far away (e.g. to the top)", () => {
    expect(isNearBottom(0, 5000, 100)).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(isNearBottom(200, 500, 100, 250)).toBe(true); // distance = 200 < 250
    expect(isNearBottom(200, 500, 100, 150)).toBe(false); // distance = 200, not < 150
  });

  it("is true when content is shorter than the viewport (nothing to scroll)", () => {
    expect(isNearBottom(0, 50, 100)).toBe(true); // distance is negative, always < threshold
  });

  it("does not rely on exact equality — near-bottom values on either side of a pixel or two both count", () => {
    expect(isNearBottom(421, 500, 100, 80)).toBe(true); // distance = -21
    expect(isNearBottom(419, 500, 100, 80)).toBe(true); // distance = -19
  });
});
