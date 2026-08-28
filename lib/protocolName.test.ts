import { describe, expect, it } from "vitest";
import { normalizeProtocolName } from "../../../artifacts/api-server/src/lib/protocolName";

describe("normalizeProtocolName", () => {
  it("trims and lowercases for scoped duplicate checks", () => {
    expect(normalizeProtocolName("  Standard Routine  ")).toBe("standard routine");
  });
});
