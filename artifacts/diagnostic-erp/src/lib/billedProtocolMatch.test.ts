/**
 * Auto-Technique from the protocol/billing row.
 *
 * The billed / catalog procedure name (`testName`, else `billedTestName`, from
 * the worklist row) already drives REGION resolution, but the Technique
 * auto-pick ignored it after that: it always loaded the Study Tab's default
 * protocol, so a billing row that names a specific acquisition ("MRI LS Spine
 * with Whole Spine Screening" — a protocol with exactly that name) still opened
 * with the generic "Standard Routine" and the radiologist switched it by hand
 * on every such study.
 *
 * `pickQuickProtocolForBilledName` lets the billing row name its own protocol,
 * in decreasing strength: exact normalized name → contiguous phrase inside the
 * billed string (price/code suffixes) → order-free token subset (anatomy
 * synonyms respected). Anything less than that fails closed to the existing
 * region-default pick — a Technique text that describes an acquisition that
 * was not ordered (contrast on a plain study) is worse than no auto-pick.
 */
import { describe, expect, it } from "vitest";
import { pickQuickProtocolForBilledName } from "./pickQuickProtocol";

const LS_TAB = 5;
const BRAIN_TAB = 4;

const LS_DEFAULT = {
  id: 1,
  name: "Standard Routine",
  studyType: "LS Spine",
  studyTabId: LS_TAB,
  techniqueText: "Routine LS spine technique.",
  isDefault: true,
  isGoldStandard: false,
  sortOrder: 10,
  isActive: true,
};

const LS_SCREENING = {
  id: 2,
  name: "MRI LS Spine with Whole Spine Screening",
  studyType: "LS Spine",
  studyTabId: LS_TAB,
  techniqueText: "Screening technique.",
  isDefault: false,
  isGoldStandard: false,
  sortOrder: 20,
  isActive: true,
};

const BRAIN_PLAIN = {
  id: 3,
  name: "MRI Brain",
  studyType: "Brain",
  studyTabId: BRAIN_TAB,
  techniqueText: "Brain technique.",
  isDefault: true,
  isGoldStandard: false,
  sortOrder: 10,
  isActive: true,
};

const BRAIN_CONTRAST = {
  id: 4,
  name: "MRI Brain with Contrast",
  studyType: "Brain",
  studyTabId: BRAIN_TAB,
  techniqueText: "Contrast technique.",
  isDefault: false,
  isGoldStandard: false,
  sortOrder: 20,
  isActive: true,
};

const BRAIN_EPILEPSY = {
  id: 5,
  name: "MRI Brain Epilepsy Protocol",
  studyType: "Brain",
  studyTabId: BRAIN_TAB,
  techniqueText: "Epilepsy technique.",
  isDefault: false,
  isGoldStandard: false,
  sortOrder: 30,
  isActive: true,
};

describe("pickQuickProtocolForBilledName", () => {
  it("1. billing row naming a protocol exactly beats the region default", () => {
    const match = pickQuickProtocolForBilledName(
      [LS_DEFAULT, LS_SCREENING],
      "MRI LS Spine With Whole Spine Screening",
      "LS Spine",
      LS_TAB,
    );
    expect(match?.id).toBe(LS_SCREENING.id);
  });

  it("2. case, punctuation and X-ray spellings normalize on both sides", () => {
    const chest = [
      { id: 10, name: "X-Ray Chest PA", studyType: "Chest", studyTabId: 9, techniqueText: "t", isDefault: true, isGoldStandard: false, sortOrder: 1, isActive: true },
    ];
    expect(pickQuickProtocolForBilledName(chest, "XRAY CHEST PA", "Chest", 9)?.id).toBe(10);
    expect(pickQuickProtocolForBilledName(chest, "x ray chest pa", "Chest", 9)?.id).toBe(10);
    expect(pickQuickProtocolForBilledName(chest, "X-Ray Chest PA", "Chest", 9)?.id).toBe(10);
  });

  it("3. containment: the billed row may carry price/code suffixes", () => {
    const match = pickQuickProtocolForBilledName(
      [LS_DEFAULT, { ...LS_SCREENING, name: "MRI LS Spine" }],
      "MRI LS SPINE (SPECIAL PRICE)",
      "LS Spine",
      LS_TAB,
    );
    expect(match?.id).toBe(LS_SCREENING.id);
  });

  it("4. containment picks the most specific phrase, not the shortest", () => {
    const match = pickQuickProtocolForBilledName(
      [BRAIN_PLAIN, BRAIN_EPILEPSY],
      "MRI BRAIN EPILEPSY PROTOCOL CODE 4412",
      "Brain",
      BRAIN_TAB,
    );
    expect(match?.id).toBe(BRAIN_EPILEPSY.id);
  });

  it("5. order-free token subset matches reordered protocol names", () => {
    const reordered = [
      { id: 6, name: "Screening MRI Brain", studyType: "Brain", studyTabId: BRAIN_TAB, techniqueText: "t", isDefault: false, isGoldStandard: false, sortOrder: 40, isActive: true },
    ];
    const match = pickQuickProtocolForBilledName(reordered, "MRI BRAIN SCREENING", "Brain", BRAIN_TAB);
    expect(match?.id).toBe(6);
  });

  it("6. anatomy synonyms bridge billing abbreviations both ways (ls ↔ lumbar)", () => {
    const lumbar = [
      { id: 7, name: "MRI Lumbar Spine", studyType: "LS Spine", studyTabId: LS_TAB, techniqueText: "t", isDefault: true, isGoldStandard: false, sortOrder: 1, isActive: true },
    ];
    expect(pickQuickProtocolForBilledName(lumbar, "MRI LS SPINE", "LS Spine", LS_TAB)?.id).toBe(7);

    const lsNamed = [
      { id: 8, name: "MRI LS Spine", studyType: "LS Spine", studyTabId: LS_TAB, techniqueText: "t", isDefault: true, isGoldStandard: false, sortOrder: 1, isActive: true },
    ];
    expect(pickQuickProtocolForBilledName(lsNamed, "MRI LUMBAR SPINE", "LS Spine", LS_TAB)?.id).toBe(8);
  });

  it("7. dotted abbreviations re-join (T.L.S. SPINE)", () => {
    const tls = [
      { id: 9, name: "TLS Spine", studyType: "Dorsal Spine", studyTabId: 6, techniqueText: "t", isDefault: true, isGoldStandard: false, sortOrder: 1, isActive: true },
    ];
    expect(pickQuickProtocolForBilledName(tls, "T.L.S. SPINE", "Dorsal Spine", 6)?.id).toBe(9);
  });

  it("8. no billed name → null (caller falls back to the region default)", () => {
    expect(pickQuickProtocolForBilledName([LS_DEFAULT], null, "LS Spine", LS_TAB)).toBeNull();
    expect(pickQuickProtocolForBilledName([LS_DEFAULT], "   ", "LS Spine", LS_TAB)).toBeNull();
  });

  it("9. contrast discipline: a plain billed study never selects a contrast protocol", () => {
    const match = pickQuickProtocolForBilledName(
      [BRAIN_PLAIN, BRAIN_CONTRAST],
      "MRI BRAIN",
      "Brain",
      BRAIN_TAB,
    );
    // "MRI Brain" phrase-containment lands on the plain protocol; the contrast
    // protocol must never win a billed row that does not say contrast.
    expect(match?.id).toBe(BRAIN_PLAIN.id);
    const only = pickQuickProtocolForBilledName([BRAIN_CONTRAST], "MRI BRAIN", "Brain", BRAIN_TAB);
    expect(only).toBeNull();
  });

  it("10. single-token protocol names never match fuzzily", () => {
    const screening = [
      { id: 11, name: "Screening", studyType: "Brain", studyTabId: BRAIN_TAB, techniqueText: "t", isDefault: false, isGoldStandard: false, sortOrder: 1, isActive: true },
    ];
    expect(pickQuickProtocolForBilledName(screening, "MRI BRAIN SCREENING", "Brain", BRAIN_TAB)).toBeNull();
  });

  it("11. protocols of other Study Tabs are never matched", () => {
    // The billed name equals a Brain-tab protocol exactly, but the open tab is LS.
    const match = pickQuickProtocolForBilledName(
      [LS_DEFAULT],
      "MRI Brain",
      "LS Spine",
      LS_TAB,
    );
    expect(match).toBeNull();
  });

  it("12. inactive protocols are invisible", () => {
    const pool = [{ ...LS_SCREENING, isActive: false }, LS_DEFAULT];
    const match = pickQuickProtocolForBilledName(
      pool,
      "MRI LS Spine with Whole Spine Screening",
      "LS Spine",
      LS_TAB,
    );
    // The named protocol is retired → no billed match (default fallback is the
    // caller's job, and returning the retired row would resurrect it).
    expect(match).toBeNull();
  });

  it("13. deterministic tie on token count → lower sortOrder wins", () => {
    const a = { id: 12, name: "MRI Brain Screening", studyType: "Brain", studyTabId: BRAIN_TAB, techniqueText: "t", isDefault: false, isGoldStandard: false, sortOrder: 5, isActive: true };
    const b = { id: 13, name: "Screening Brain MRI", studyType: "Brain", studyTabId: BRAIN_TAB, techniqueText: "t", isDefault: false, isGoldStandard: false, sortOrder: 2, isActive: true };
    // Neither name is a contiguous phrase of the billed string, so both land
    // in the order-free subset pass with equal token counts.
    const match = pickQuickProtocolForBilledName([a, b], "BRAIN MRI SCREENING STUDY", "Brain", BRAIN_TAB);
    expect(match?.id).toBe(13);
  });

  it("14. legacy name-only rows participate in the billed match", () => {
    const legacy = {
      id: 14,
      name: "MRI LS Spine",
      studyType: "LS Spine",
      studyTabId: null,
      techniqueText: "Legacy technique.",
      isDefault: false,
      isGoldStandard: false,
      sortOrder: 30,
      isActive: true,
    };
    const match = pickQuickProtocolForBilledName([legacy], "MRI LS SPINE", "LS Spine", LS_TAB);
    expect(match?.id).toBe(14);
  });
});
