import { describe, it, expect } from "vitest";
import { recommendIncrement, DEFAULT_INCREMENT_BANDS } from "./incrementEngine";

describe("recommendIncrement", () => {
  it("maps scores to the correct advisory band", () => {
    expect(recommendIncrement(95)?.recommendation).toBe("Exceptional increment or promotion review");
    expect(recommendIncrement(87)?.recommendation).toBe("Higher increment");
    expect(recommendIncrement(80)?.recommendation).toBe("Standard increment");
    expect(recommendIncrement(70)?.recommendation).toBe("Limited increment");
    expect(recommendIncrement(60)?.recommendation).toBe("Increment deferred");
    expect(recommendIncrement(40)?.recommendation).toBe("No increment; performance review");
  });

  it("returns band labels aligned with the policy doc", () => {
    expect(recommendIncrement(90)?.band).toBe("90–100");
    expect(recommendIncrement(55)?.band).toBe("55–64");
  });

  it("handles boundaries (inclusive lower bound)", () => {
    expect(recommendIncrement(85)?.recommendation).toBe("Higher increment");
    expect(recommendIncrement(84.99)?.recommendation).toBe("Standard increment");
  });

  it("has six bands covering 0..100", () => {
    expect(DEFAULT_INCREMENT_BANDS).toHaveLength(6);
    expect(recommendIncrement(0)).not.toBeNull();
  });
});
