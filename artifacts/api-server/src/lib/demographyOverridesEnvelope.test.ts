/**
 * Behaviour pins for the demography-override envelope (PR #1171) — the pure
 * halves of persistence: sanitize, tolerant read, compose round-trip, and the
 * save-draft write-signal.
 *
 * The defect: `demographyOverrides` was radiologist-local component state
 * (useWorkspaceClinicalUi.tsx:610). The demography card's "Apply to report"
 * edited the preview, the client PDF and the Word export — and then the
 * correction evaporated: the save-draft payload carried no demography, the
 * server re-derived identity from the worklist/billed-study/patient-master at
 * sign and froze THAT, so the signed report printed the uncorrected values and
 * a reopen showed a blank card. Every envelope neighbour (linkedStudy,
 * spineReporting, reportFormatIdentity…) round-trips; this key joins them.
 */
import { describe, expect, it } from "vitest";
import {
  CARE_DEMOGRAPHY_OVERRIDES_KIND,
  DEMOGRAPHY_OVERRIDE_FIELDS,
  buildCareStructuredJsonPatch,
  composeStructuredJsonColumn,
  demographyOverrideValue,
  extractCareDemographyOverrides,
  sanitizeCareDemographyOverrides,
  STRUCTURED_JSON_ENVELOPE_KIND,
} from "./structuredJsonColumn";

const OVER = {
  patientName: "CORRECTED NAME",
  age: "35 Yrs",
  sex: "F",
  uhid: "UH-9001",
  studyDescription: "MRI BRAIN WITH CONTRAST",
  studyDate: "01/02/2026",
  referringDoctor: "DR. REFERRER",
  dateOfBirth: "1990-04-01",
};

describe("sanitizeCareDemographyOverrides — what may count as an override", () => {
  it("1. keeps the eight editable fields, trimmed, with the envelope kind", () => {
    const out = sanitizeCareDemographyOverrides(OVER)!;
    expect(out).not.toBeNull();
    expect(out.kind).toBe(CARE_DEMOGRAPHY_OVERRIDES_KIND);
    expect(out.patientName).toBe("CORRECTED NAME");
    expect(out.referringDoctor).toBe("DR. REFERRER");
  });

  it("2. drops blank values — a blank override is not an override (client merge semantics)", () => {
    const out = sanitizeCareDemographyOverrides({ patientName: "   ", age: "", uhid: "UH-1" });
    expect(out?.uhid).toBe("UH-1");
    expect(out).not.toHaveProperty("patientName");
    expect(out).not.toHaveProperty("age");
  });

  it("3. drops unknown keys — the stored shape can never grow surprise fields", () => {
    const out = sanitizeCareDemographyOverrides({ patientName: "A", patientId: "42", __proto__: "x" } as Record<string, unknown>)!;
    expect(out).not.toHaveProperty("patientId");
    expect(Object.keys(out).sort()).toEqual(["kind", "patientName"].sort());
  });

  it("4. nothing left after sanitize is null — the caller clears the stored key", () => {
    expect(sanitizeCareDemographyOverrides({})).toBeNull();
    expect(sanitizeCareDemographyOverrides({ patientName: "  " })).toBeNull();
    expect(sanitizeCareDemographyOverrides("nonsense")).toBeNull();
    expect(sanitizeCareDemographyOverrides(null)).toBeNull();
  });
});

describe("extractCareDemographyOverrides — tolerant read from a stored column", () => {
  it("5. reads the key out of an envelope", () => {
    const stored = composeStructuredJsonColumn({
      existing: null,
      demographyOverrides: sanitizeCareDemographyOverrides(OVER),
    }) as Record<string, unknown>;
    expect(stored.kind).toBe(STRUCTURED_JSON_ENVELOPE_KIND);
    expect(extractCareDemographyOverrides(stored)?.patientName).toBe("CORRECTED NAME");
  });

  it("6. a bare array column, an empty envelope, and a non-object all read as null", () => {
    expect(extractCareDemographyOverrides([{ findingId: 1 }])).toBeNull();
    expect(extractCareDemographyOverrides({ kind: STRUCTURED_JSON_ENVELOPE_KIND })).toBeNull();
    expect(extractCareDemographyOverrides(null)).toBeNull();
  });
});

describe("compose round-trip — save, keep, clear", () => {
  it("7. a save that carries no signal keeps the stored overrides (old drafts keep theirs)", () => {
    const stored = composeStructuredJsonColumn({
      existing: null,
      demographyOverrides: sanitizeCareDemographyOverrides(OVER),
    });
    const after = composeStructuredJsonColumn({ existing: stored });
    expect(extractCareDemographyOverrides(after)?.age).toBe("35 Yrs");
  });

  it("8. an empty object is a real clear signal — a radiologist who reverts a correction loses it", () => {
    const stored = composeStructuredJsonColumn({
      existing: null,
      demographyOverrides: sanitizeCareDemographyOverrides(OVER),
    });
    const after = composeStructuredJsonColumn({
      existing: stored,
      demographyOverrides: sanitizeCareDemographyOverrides({}),
    });
    expect(extractCareDemographyOverrides(after)).toBeNull();
  });

  it("9. the overrides do not evict the other envelope keys — neighbours survive the compose", () => {
    const withSibling = composeStructuredJsonColumn({
      existing: null,
      linkedStudy: { studyId: 7, title: "SECOND STUDY" },
    });
    const both = composeStructuredJsonColumn({
      existing: withSibling,
      demographyOverrides: sanitizeCareDemographyOverrides({ patientName: "A" }),
    }) as Record<string, unknown>;
    expect(both.careLinkedStudy).toBeTruthy();
    expect(both.careDemographyOverrides).toBeTruthy();
  });
});

describe("buildCareStructuredJsonPatch — the wire contract", () => {
  it("10. undefined keeps the stored value; a carried object is a write signal", () => {
    expect(buildCareStructuredJsonPatch({})).toEqual({});
    const patch = buildCareStructuredJsonPatch({ demographyOverrides: OVER });
    expect(patch.demographyOverrides?.patientName).toBe("CORRECTED NAME");
  });

  it("11. a carried-but-empty object sanitizes to null — the patch says CLEAR, not KEEP", () => {
    const patch = buildCareStructuredJsonPatch({ demographyOverrides: {} });
    expect(patch.demographyOverrides).toBeNull();
  });

  it("12. non-object garbage is not a write signal at all", () => {
    expect(buildCareStructuredJsonPatch({ demographyOverrides: "oops" })).toEqual({});
    expect(buildCareStructuredJsonPatch({ demographyOverrides: 42 })).toEqual({});
  });
});

describe("demographyOverrideValue — the precedence every server surface applies", () => {
  const RESOLVED: Record<string, string> = {
    patientName: "UNCORRECTED NAME",
    age: "61 Yrs",
    sex: "M",
    uhid: "UH-1001",
    studyDescription: "MRI BRAIN",
    studyDate: "02/02/2026",
    referringDoctor: "DR. ON THE WORKLIST",
    dateOfBirth: "1965-01-01",
  };

  it("13. all eight editable fields read back, so no surface has to pick a subset", () => {
    const ov = demographyOverrideValue(sanitizeCareDemographyOverrides(OVER));
    // The defect this pins: the draft print-preview consulted two of these eight,
    // so a NAME/AGE/SEX/UHID/DATE/DOCTOR correction printed on the letter-pad
    // (where the browser rewrites the block) and nowhere else.
    expect(DEMOGRAPHY_OVERRIDE_FIELDS.map((f) => ov(f, RESOLVED[f]))).toEqual(
      DEMOGRAPHY_OVERRIDE_FIELDS.map((f) => OVER[f]),
    );
  });

  it("14. no envelope at all leaves every resolved value standing, field by field", () => {
    for (const ov of [demographyOverrideValue(null), demographyOverrideValue(undefined)]) {
      for (const field of DEMOGRAPHY_OVERRIDE_FIELDS) {
        expect(ov(field, RESOLVED[field])).toBe(RESOLVED[field]);
      }
    }
  });

  it("15. a partial envelope corrects only the field it carries", () => {
    const ov = demographyOverrideValue({ kind: CARE_DEMOGRAPHY_OVERRIDES_KIND, sex: "F" });
    expect(ov("sex", RESOLVED.sex)).toBe("F");
    // The corrected sex beside an uncorrected age is the normal case (the card
    // holds one row for both), and the age must not become empty.
    expect(ov("age", RESOLVED.age)).toBe("61 Yrs");
  });

  it("16. blank, whitespace and non-string are not corrections — even un-sanitized input", () => {
    const ov = demographyOverrideValue({
      kind: CARE_DEMOGRAPHY_OVERRIDES_KIND,
      patientName: "   ",
      age: 41 as unknown as string,
      sex: " F ",
    });
    expect(ov("patientName", RESOLVED.patientName)).toBe("UNCORRECTED NAME");
    expect(ov("age", RESOLVED.age)).toBe("61 Yrs");
    // Trimmed here rather than trusted: a caller can hand this an object that
    // never passed through the sanitizer.
    expect(ov("sex", RESOLVED.sex)).toBe("F");
  });
});
