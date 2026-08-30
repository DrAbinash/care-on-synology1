import { describe, expect, it } from "vitest";
import { framesAnchorStudyAllowed } from "./framesJumpBack";

describe("FRAMES jump-back study guard", () => {
  it("allows when provenance study matches loaded study", () => {
    expect(framesAnchorStudyAllowed("1.2.3", "1.2.3")).toBe(true);
  });

  it("rejects wrong-study provenance", () => {
    expect(framesAnchorStudyAllowed("1.2.3", "9.9.9")).toBe(false);
  });

  it("allows when either side lacks study UID (graceful degrade)", () => {
    expect(framesAnchorStudyAllowed("1.2.3", null)).toBe(true);
    expect(framesAnchorStudyAllowed(null, "1.2.3")).toBe(true);
  });
});
