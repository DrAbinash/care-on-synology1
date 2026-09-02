/**
 * conceptCanon/conceptCanon.test.ts — content-pack resolver tests.
 *
 * Verifies:
 *   - L. content-pack aliases resolve to the same canonical concepts as before
 *   - Unknown concepts fail conservatively (return null, not a wrong map)
 *   - Broad-anatomy words are NOT canonical aliases
 *   - The generated record is frozen / immutable
 *   - canonicalConceptTokens enumerates synonyms for sentence matching
 */
import { describe, expect, it } from "vitest";
import {
  resolveCanonicalConcept,
  canonicalAliasIndex,
  isKnownCanonicalConcept,
  canonicalConceptTokens,
  generateConceptCanonRecord,
  normaliseConceptKey,
} from "./conceptCanon";
import {
  CLINICAL_CONTENT_PACKS,
  isImpressionworthyAbnormal,
  isSystemOwnedBaseline,
  contentPackForConcept,
} from "./contentPacks";

describe("conceptCanon — content-pack-driven resolver", () => {
  describe("L. content-pack aliases resolve to the same canonical concepts as before", () => {
    it("disc bulge / protrusion / extrusion / herniation → disc_contour", () => {
      expect(resolveCanonicalConcept("disc bulge")).toBe("disc_contour");
      expect(resolveCanonicalConcept("disc protrusion")).toBe("disc_contour");
      expect(resolveCanonicalConcept("disc extrusion")).toBe("disc_contour");
      expect(resolveCanonicalConcept("disc herniation")).toBe("disc_contour");
      expect(resolveCanonicalConcept("herniation")).toBe("disc_contour");
      expect(resolveCanonicalConcept("diffuse disc bulge")).toBe("disc_contour");
    });

    it("disc-bulge / disc_bulge / Disc Bulge (case + separator insensitive)", () => {
      expect(resolveCanonicalConcept("disc-bulge")).toBe("disc_contour");
      expect(resolveCanonicalConcept("disc_bulge")).toBe("disc_contour");
      expect(resolveCanonicalConcept("Disc Bulge")).toBe("disc_contour");
      expect(resolveCanonicalConcept("  DISC  BULGE  ")).toBe("disc_contour");
    });

    it("disc desiccation → disc_signal", () => {
      expect(resolveCanonicalConcept("desiccation")).toBe("disc_signal");
      expect(resolveCanonicalConcept("disc desiccation")).toBe("disc_signal");
      expect(resolveCanonicalConcept("loss of t2 signal")).toBe("disc_signal");
    });

    it("foraminal narrowing / stenosis → foraminal_stenosis", () => {
      expect(resolveCanonicalConcept("foraminal narrowing")).toBe("foraminal_stenosis");
      expect(resolveCanonicalConcept("foraminal stenosis")).toBe("foraminal_stenosis");
      expect(resolveCanonicalConcept("neural foraminal stenosis")).toBe("foraminal_stenosis");
    });

    it("facet arthropathy → facet_joint", () => {
      expect(resolveCanonicalConcept("facet")).toBe("facet_joint");
      expect(resolveCanonicalConcept("facet arthropathy")).toBe("facet_joint");
      expect(resolveCanonicalConcept("facet hypertrophy")).toBe("facet_joint");
    });

    it("ligamentum flavum hypertrophy → ligamentum_flavum", () => {
      expect(resolveCanonicalConcept("ligamentum flavum")).toBe("ligamentum_flavum");
      expect(resolveCanonicalConcept("lf hypertrophy")).toBe("ligamentum_flavum");
      expect(resolveCanonicalConcept("lfh")).toBe("ligamentum_flavum");
    });

    it("hydrocephalus / ventricles → ventricles", () => {
      expect(resolveCanonicalConcept("hydrocephalus")).toBe("ventricles");
      expect(resolveCanonicalConcept("ventricles")).toBe("ventricles");
      expect(resolveCanonicalConcept("ventricular")).toBe("ventricles");
    });

    it("modic → endplate (preserved historical alias)", () => {
      expect(resolveCanonicalConcept("modic")).toBe("endplate");
      expect(resolveCanonicalConcept("modic type 1")).toBe("endplate");
    });

    it("normal study / normal mri / normal ct → normal_study", () => {
      expect(resolveCanonicalConcept("normal study")).toBe("normal_study");
      expect(resolveCanonicalConcept("normal mri")).toBe("normal_study");
      expect(resolveCanonicalConcept("normal ct")).toBe("normal_study");
    });
  });

  describe("conservative failure for unknown concepts", () => {
    it("returns null for empty input", () => {
      expect(resolveCanonicalConcept("")).toBeNull();
      expect(resolveCanonicalConcept(null)).toBeNull();
      expect(resolveCanonicalConcept(undefined)).toBeNull();
      expect(resolveCanonicalConcept("   ")).toBeNull();
    });

    it("returns null for an unknown alias", () => {
      // Not in any content pack — must NOT map to a wrong canonical.
      expect(resolveCanonicalConcept("random-c-disease")).toBeNull();
      expect(resolveCanonicalConcept("weird pathology name")).toBeNull();
    });

    it("returns null for broad anatomy words (anatomy is NOT a concept)", () => {
      expect(resolveCanonicalConcept("disc")).toBeNull();
      expect(resolveCanonicalConcept("spine")).toBeNull();
      expect(resolveCanonicalConcept("brain")).toBeNull();
      expect(resolveCanonicalConcept("cord")).toBeNull();
    });
  });

  describe("isKnownCanonicalConcept", () => {
    it("returns true for declared canonical concept ids", () => {
      expect(isKnownCanonicalConcept("disc_contour")).toBe(true);
      expect(isKnownCanonicalConcept("normal_study")).toBe(true);
      expect(isKnownCanonicalConcept("foraminal_stenosis")).toBe(true);
    });

    it("returns false for aliases (only canonical ids are 'known')", () => {
      expect(isKnownCanonicalConcept("disc bulge")).toBe(false);
      expect(isKnownCanonicalConcept("normal study")).toBe(false);
    });

    it("returns false for unknown / empty", () => {
      expect(isKnownCanonicalConcept("random-thing")).toBe(false);
      expect(isKnownCanonicalConcept("")).toBe(false);
      expect(isKnownCanonicalConcept(null)).toBe(false);
    });
  });

  describe("canonicalConceptTokens — sentence-match enumeration", () => {
    it("returns canonical id + all aliases for disc_contour", () => {
      const tokens = canonicalConceptTokens("disc_contour");
      expect(tokens).toContain("disc contour");
      expect(tokens).toContain("disc bulge");
      expect(tokens).toContain("disc protrusion");
      expect(tokens).toContain("herniation");
    });

    it("returns [] for unknown concept", () => {
      expect(canonicalConceptTokens("unknown-thing")).toEqual([]);
      expect(canonicalConceptTokens(null)).toEqual([]);
    });
  });

  describe("content-pack metadata accessors", () => {
    it("isImpressionworthyAbnormal returns true for disc_contour / fazekas / hemorrhage", () => {
      expect(isImpressionworthyAbnormal("disc_contour")).toBe(true);
      expect(isImpressionworthyAbnormal("fazekas")).toBe(true);
      expect(isImpressionworthyAbnormal("hemorrhage")).toBe(true);
    });

    it("isImpressionworthyAbnormal returns false for normal_study / disc_signal / disc_height", () => {
      expect(isImpressionworthyAbnormal("normal_study")).toBe(false);
      expect(isImpressionworthyAbnormal("disc_signal")).toBe(false);
      expect(isImpressionworthyAbnormal("disc_height")).toBe(false);
    });

    it("isImpressionworthyAbnormal returns false for unknown concepts", () => {
      expect(isImpressionworthyAbnormal("unknown-thing")).toBe(false);
      expect(isImpressionworthyAbnormal(null)).toBe(false);
    });

    it("isSystemOwnedBaseline returns true ONLY for normal_study", () => {
      expect(isSystemOwnedBaseline("normal_study")).toBe(true);
      expect(isSystemOwnedBaseline("disc_contour")).toBe(false);
      expect(isSystemOwnedBaseline(null)).toBe(false);
    });

    it("contentPackForConcept returns the pack for known concepts", () => {
      const pack = contentPackForConcept("disc_contour");
      expect(pack).toBeDefined();
      expect(pack?.label).toMatch(/disc contour/i);
      expect(pack?.aliases).toContain("disc bulge");
      expect(pack?.impressionworthyAbnormal).toBe(true);
    });
  });

  describe("generated canon record immutability", () => {
    it("generateConceptCanonRecord returns a frozen object", () => {
      const record = generateConceptCanonRecord();
      expect(Object.isFrozen(record)).toBe(true);
    });

    it("canonicalAliasIndex returns the same frozen instance", () => {
      const a = canonicalAliasIndex();
      const b = canonicalAliasIndex();
      expect(a).toBe(b); // same instance — no copy per call
      expect(Object.isFrozen(a)).toBe(true);
    });

    it("attempting to mutate the record throws in strict mode", () => {
      const record = generateConceptCanonRecord();
      expect(() => {
        // Strict-mode mutation of a frozen object throws.
        (record as Record<string, string>)["foo"] = "bar";
      }).toThrow();
    });
  });

  describe("normaliseConceptKey", () => {
    it("lowercases, trims, and collapses internal whitespace", () => {
      expect(normaliseConceptKey("  Disc   Bulge  ")).toBe("disc bulge");
    });

    it("normalises separators (_ and -) to spaces", () => {
      expect(normaliseConceptKey("disc_bulge")).toBe("disc bulge");
      expect(normaliseConceptKey("disc-bulge")).toBe("disc bulge");
    });

    it("returns empty for null/undefined", () => {
      expect(normaliseConceptKey(null)).toBe("");
      expect(normaliseConceptKey(undefined)).toBe("");
    });
  });

  describe("content pack coverage", () => {
    it("every pack has at least one alias beyond the canonical id", () => {
      for (const pack of CLINICAL_CONTENT_PACKS) {
        expect(pack.aliases.length).toBeGreaterThan(0);
      }
    });

    it("every pack has a non-empty label and description", () => {
      for (const pack of CLINICAL_CONTENT_PACKS) {
        expect(pack.label.trim()).toBeTruthy();
        expect(pack.description.trim()).toBeTruthy();
      }
    });

    it("exactly one system-owned baseline (normal_study)", () => {
      const baselines = CLINICAL_CONTENT_PACKS.filter((p) => p.systemOwnedBaseline);
      expect(baselines).toHaveLength(1);
      expect(baselines[0]?.concept).toBe("normal_study");
    });
  });
});
