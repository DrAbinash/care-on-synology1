import { describe, it, expect } from "vitest";
import {
  isValidKey, assertValidKey, normalizeText, findDuplicates, isAliasCollision,
  findOrphanReferences, wouldCreateCycle, detectHierarchyCycle,
  assertStatusTransition, assertVersionTransition, assertExpectedVersion, isValidStatus,
  CatalogValidationError,
} from "./validation";

describe("catalog validation — keys", () => {
  it("accepts lowercase dotted/colon/hyphen slugs", () => {
    for (const k of ["echogenicity", "liver.cyst", "yaml_pack:abdomen", "grade-1", "a", "x1.2_3:4-5"]) {
      expect(isValidKey(k)).toBe(true);
    }
  });
  it("rejects invalid keys", () => {
    for (const k of ["", " ", "UPPER", "has space", "-leading", ".start", "emoji😀", "a".repeat(129), 5 as unknown, null]) {
      expect(isValidKey(k as string)).toBe(false);
    }
  });
  it("assertValidKey throws INVALID_KEY with the field name", () => {
    try { assertValidKey("Bad Key", "key"); expect.unreachable(); }
    catch (e) { expect(e).toBeInstanceOf(CatalogValidationError); expect((e as CatalogValidationError).code).toBe("INVALID_KEY"); expect((e as CatalogValidationError).status).toBe(400); }
  });
});

describe("catalog validation — normalization & duplicates", () => {
  it("normalizeText lowercases, trims, collapses whitespace", () => {
    expect(normalizeText("  Simple   HEPATIC  Cyst ")).toBe("simple hepatic cyst");
  });
  it("findDuplicates returns repeated values only", () => {
    expect(findDuplicates(["a", "b", "a", "c", "c", "c"]).sort()).toEqual(["a", "c"]);
    expect(findDuplicates([1, 2, 3])).toEqual([]);
  });
  it("isAliasCollision detects an existing normalized alias", () => {
    const live = new Set(["renal cyst", "hepatic cyst"]);
    expect(isAliasCollision(live, "renal cyst")).toBe(true);
    expect(isAliasCollision(live, "splenic cyst")).toBe(false);
  });
});

describe("catalog validation — reference integrity", () => {
  it("findOrphanReferences flags bindings whose parent is not live", () => {
    const bindings = [{ id: 1, refId: 10 }, { id: 2, refId: 20 }, { id: 3, refId: 99 }];
    expect(findOrphanReferences(bindings, new Set([10, 20]))).toEqual([3]);
    expect(findOrphanReferences(bindings, new Set([10, 20, 99]))).toEqual([]);
  });
});

describe("catalog validation — cycles", () => {
  const parentMap = new Map<number, number | null>([[1, null], [2, 1], [3, 2]]);
  const parentOf = (id: number) => parentMap.get(id) ?? null;

  it("wouldCreateCycle: setting a node's parent to its own descendant is a cycle", () => {
    // making 1's parent = 3 (a descendant of 1) closes the loop 1→3→2→1
    expect(wouldCreateCycle(1, 3, parentOf)).toBe(true);
  });
  it("wouldCreateCycle: self-parent is a cycle", () => {
    expect(wouldCreateCycle(2, 2, parentOf)).toBe(true);
  });
  it("wouldCreateCycle: a fresh parent up a clean chain is fine", () => {
    expect(wouldCreateCycle(null, 3, parentOf)).toBe(false);
    expect(wouldCreateCycle(4, 1, parentOf)).toBe(false);
  });
  it("detectHierarchyCycle finds a cycle in a full graph and returns null when acyclic", () => {
    expect(detectHierarchyCycle([{ id: 1, parentId: 2 }, { id: 2, parentId: 3 }, { id: 3, parentId: 1 }])).not.toBeNull();
    expect(detectHierarchyCycle([{ id: 1, parentId: null }, { id: 2, parentId: 1 }, { id: 3, parentId: 2 }])).toBeNull();
  });
});

describe("catalog validation — lifecycle transitions", () => {
  it("isValidStatus", () => {
    expect(isValidStatus("active")).toBe(true);
    expect(isValidStatus("archived")).toBe(false);
  });
  it("allows forward status transitions only", () => {
    expect(() => assertStatusTransition("draft", "active")).not.toThrow();
    expect(() => assertStatusTransition("draft", "deprecated")).not.toThrow();
    expect(() => assertStatusTransition("active", "deprecated")).not.toThrow();
    expect(() => assertStatusTransition("active", "active")).not.toThrow();
  });
  it("rejects backward/illegal status transitions", () => {
    for (const [from, to] of [["active", "draft"], ["deprecated", "active"], ["deprecated", "draft"]] as const) {
      try { assertStatusTransition(from, to); expect.unreachable(); }
      catch (e) { expect((e as CatalogValidationError).code).toBe("INVALID_STATUS_TRANSITION"); }
    }
  });
  it("version must advance by exactly 1", () => {
    expect(() => assertVersionTransition(1, 2)).not.toThrow();
    for (const [c, n] of [[1, 1], [1, 3], [2, 1], [1, 0]] as const) {
      try { assertVersionTransition(c, n); expect.unreachable(); }
      catch (e) { expect((e as CatalogValidationError).code).toBe("INVALID_VERSION"); }
    }
  });
  it("assertExpectedVersion is optimistic-lock", () => {
    expect(() => assertExpectedVersion(4, 4)).not.toThrow();
    expect(() => assertExpectedVersion(4, undefined)).not.toThrow();
    try { assertExpectedVersion(4, 3); expect.unreachable(); }
    catch (e) { expect((e as CatalogValidationError).code).toBe("VERSION_CONFLICT"); expect((e as CatalogValidationError).status).toBe(409); }
  });
});
