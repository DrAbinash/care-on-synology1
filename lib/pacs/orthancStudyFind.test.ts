import { describe, expect, it } from "vitest";
import { orthancEphemeralWorklistId } from "../../artifacts/api-server/src/lib/pacs/orthancStudyFind";

describe("orthancEphemeralWorklistId", () => {
  it("returns stable negative ids", () => {
    const uid = "1.2.840.113619.2.55.3.604688119.968.1756543210.123";
    expect(orthancEphemeralWorklistId(uid)).toBeLessThan(0);
    expect(orthancEphemeralWorklistId(uid)).toBe(orthancEphemeralWorklistId(uid));
  });
});
