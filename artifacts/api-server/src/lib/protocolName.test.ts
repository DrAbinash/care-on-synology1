import { describe, expect, it } from "vitest";
import { normalizeProtocolName } from "./protocolName";

describe("normalizeProtocolName", () => {
  it("trims and lowercases for scoped duplicate checks", () => {
    expect(normalizeProtocolName("  Standard Routine  ")).toBe("standard routine");
  });

  it("coerces nullish to empty string", () => {
    expect(normalizeProtocolName(null)).toBe("");
    expect(normalizeProtocolName(undefined)).toBe("");
  });
});
