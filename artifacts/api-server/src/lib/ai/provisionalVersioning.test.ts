import { describe, it, expect } from "vitest";
import { nextProvisionalVersion } from "./provisionalVersioning";

describe("provisional report versioning (P3 patch)", () => {
  it("starts at version 1 when there are no drafts", () => {
    expect(nextProvisionalVersion([])).toBe(1);
  });

  it("regeneration creates a NEW version (max + 1), never overwriting", () => {
    expect(nextProvisionalVersion([1])).toBe(2);
    expect(nextProvisionalVersion([1, 2, 3])).toBe(4);
    expect(nextProvisionalVersion([3, 1, 2])).toBe(4); // order-independent
  });
});
