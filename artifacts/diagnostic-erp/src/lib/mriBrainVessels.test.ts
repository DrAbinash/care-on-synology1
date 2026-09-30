/**
 * mriBrainVessels.test.ts — one identity per vessel (mra/mrv spec §5, §11, §12).
 *
 * The registry exists because the ledger keys a slot on region + concept + level +
 * laterality. If "R M1" and "right MCA M1 segment" arrive as two levels, one vessel
 * holds two observations, both survive, and the printed report contradicts itself.
 * So these tests assert collision first, and then assert the opposite failure:
 * a name that does NOT uniquely identify a structure must resolve to null rather
 * than quietly pick a segment, a side, or a territory.
 */

import { describe, expect, it } from "vitest";

import { contentPackForConcept } from "@/lib/conceptCanon/contentPacks";

import {
  VESSEL_DEFINITIONS,
  canonicalVesselSlot,
  isAneurysmCapableVessel,
  resolveVessel,
  sideFromText,
  vesselBaseKey,
  vesselByKey,
  vesselConceptEntries,
  vesselConceptId,
  vesselsForSystem,
  vesselsForTerritory,
} from "@/lib/mriBrainVessels";

describe("mriBrainVessels — the definition table", () => {
  it("gives every vessel one unique key", () => {
    const keys = VESSEL_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => /^[a-z0-9-]+$/.test(k))).toBe(true);
  });

  it("gives paired vessels exactly a right and a left, never an unsided row", () => {
    const byBase = new Map<string, string[]>();
    for (const d of VESSEL_DEFINITIONS) {
      const base = d.side === "unpaired" ? d.key : d.key.replace(/-(right|left)$/, "");
      byBase.set(base, [...(byBase.get(base) ?? []), d.side]);
    }
    for (const [base, sides] of byBase) {
      if (sides.includes("unpaired")) {
        expect(sides, base).toEqual(["unpaired"]);
      } else {
        expect([...sides].sort(), base).toEqual(["left", "right"]);
      }
    }
  });

  it("covers all three reporting territories", () => {
    expect(vesselsForTerritory("intracranialArterial").length).toBeGreaterThan(20);
    expect(vesselsForTerritory("neckArterial").length).toBeGreaterThan(8);
    expect(vesselsForTerritory("venous").length).toBeGreaterThan(12);
  });

  it("keeps anatomic variants flagged so they are not treated as pathology", () => {
    const variants = VESSEL_DEFINITIONS.filter((d) => d.variantOnly).map((d) => d.key);
    expect(variants).toContain("transverse-sinus-hypoplasia-right");
    expect(variants).toContain("fetal-pca-left");
    expect(variants).toContain("pica-termination-variant-right");
    expect(variants).not.toContain("basilar");
  });
});

describe("mriBrainVessels — spellings collapse onto one identity", () => {
  it("resolves the three ways a radiologist names the right MCA M1 to one row", () => {
    const spellings = [
      "R M1",
      "right MCA M1",
      "middle cerebral artery, M1 segment, right",
      "Right middle cerebral artery M1",
      "MCA M1 right",
    ];
    for (const raw of spellings) {
      expect(resolveVessel(raw, { territory: "intracranialArterial" })?.key, raw).toBe(
        "mca-m1-right",
      );
    }
  });

  it("puts every spelling of one vessel in exactly one ledger slot", () => {
    const slots = [
      canonicalVesselSlot("R M1", { territory: "intracranialArterial" }),
      canonicalVesselSlot("right MCA M1", { territory: "intracranialArterial" }),
      canonicalVesselSlot("middle cerebral artery, M1 segment, right"),
    ].map((slot) => {
      expect(slot).not.toBeNull();
      return `${slot!.level}::${slot!.laterality}`;
    });
    expect(new Set(slots).size).toBe(1);
    expect(slots[0]).toBe("MCA-M1-RIGHT::right");
  });

  it("round-trips the slot level back to the same definition", () => {
    const slot = canonicalVesselSlot("left sigmoid sinus");
    expect(slot?.level).toBe("SIGMOID-SINUS-LEFT");
    expect(vesselByKey(slot?.level)?.key).toBe("sigmoid-sinus-left");
    expect(slot?.laterality).toBe("left");
  });

  it("never gives an unpaired structure a side", () => {
    for (const raw of ["basilar artery", "superior sagittal sinus", "SSS", "vein of Galen"]) {
      const slot = canonicalVesselSlot(raw);
      expect(slot, raw).not.toBeNull();
      expect(slot!.laterality, raw).toBe("");
      expect(slot!.vessel.side, raw).toBe("unpaired");
    }
    expect(canonicalVesselSlot("basilar artery")?.level).toBe("BASILAR");
  });

  it("resolves the venous sinuses of the MRV order", () => {
    expect(resolveVessel("superior sagittal sinus", { territory: "venous" })?.key).toBe("sss");
    expect(resolveVessel("right transverse sinus")?.key).toBe("transverse-sinus-right");
    expect(resolveVessel("straight sinus")?.key).toBe("straight-sinus");
    expect(resolveVessel("torcular herophili")?.key).toBe("torcular");
    expect(resolveVessel("internal cerebral veins, left")?.key).toBe("internal-cerebral-vein-left");
    expect(resolveVessel("great cerebral vein")?.key).toBe("vein-of-galen");
  });

  it("resolves the neck arteries separately from the intracranial ones", () => {
    expect(resolveVessel("right ICA", { territory: "intracranialArterial" })?.key).toBe(
      "ica-intracranial-right",
    );
    expect(resolveVessel("right ICA", { territory: "neckArterial" })).toBeNull();
    expect(resolveVessel("cervical segment of the right ICA")?.key).toBe("ica-cervical-right");
    expect(resolveVessel("right carotid bulb")?.key).toBe("carotid-bulb-right");
    expect(resolveVessel("bifurcation of the common carotid artery, left")?.key).toBe(
      "carotid-bifurcation-left",
    );
  });

  it("resolves the vertebral origin row without stealing the vertebral artery row", () => {
    expect(resolveVessel("vertebral artery origin, right")?.key).toBe("vertebral-origin-right");
    expect(
      resolveVessel("vertebral artery origin", { territory: "neckArterial", side: "left" })?.key,
    ).toBe("vertebral-origin-left");
  });

  it("does not care where in the phrase the side is written", () => {
    expect(resolveVessel("cervical segment of the right internal carotid artery")?.key).toBe(
      "ica-cervical-right",
    );
    expect(resolveVessel("right cervical segment of the internal carotid artery")?.key).toBe(
      "ica-cervical-right",
    );
    expect(resolveVessel("internal carotid artery, cervical segment, right")?.key).toBe(
      "ica-cervical-right",
    );
  });
});

describe("mriBrainVessels — ambiguity is refused, not guessed", () => {
  it("refuses the bare vertebral artery until the caller says which vessel it means", () => {
    expect(resolveVessel("vertebral artery")).toBeNull();
    expect(resolveVessel("vertebral artery", { territory: "intracranialArterial" })).toBeNull();
    expect(
      resolveVessel("vertebral artery", { territory: "intracranialArterial", side: "right" })?.key,
    ).toBe("vertebral-intracranial-right");
    expect(
      resolveVessel("vertebral artery", { territory: "neckArterial", side: "right" })?.key,
    ).toBe("vertebral-cervical-right");
  });

  it("refuses a vessel name that does not identify a segment", () => {
    expect(resolveVessel("right MCA", { territory: "intracranialArterial" })).toBeNull();
    expect(resolveVessel("MCA")).toBeNull();
  });

  it("refuses a paired vessel named without a side", () => {
    expect(resolveVessel("middle cerebral artery M1")).toBeNull();
    expect(resolveVessel("transverse sinus")).toBeNull();
    expect(
      resolveVessel("internal carotid artery", { territory: "intracranialArterial" }),
    ).toBeNull();
  });

  it("refuses unknown wording instead of matching the nearest vessel", () => {
    expect(resolveVessel("arteria of nowhere")).toBeNull();
    expect(resolveVessel("")).toBeNull();
    expect(resolveVessel(null)).toBeNull();
    expect(resolveVessel("optic chiasm", { territory: "intracranialArterial" })).toBeNull();
  });

  it("refuses a vessel that is not in the territory being reported", () => {
    expect(resolveVessel("basilar artery", { territory: "neckArterial" })).toBeNull();
    expect(resolveVessel("basilar artery", { territory: "venous" })).toBeNull();
    expect(resolveVessel("superior sagittal sinus", { territory: "intracranialArterial" })).toBeNull();
  });

  it("refuses a panel side that contradicts the written side", () => {
    expect(resolveVessel("right MCA M1", { side: "left" })).toBeNull();
    expect(resolveVessel("right MCA M1", { side: "right" })?.key).toBe("mca-m1-right");
  });

  it("refuses one phrase that names both sides", () => {
    expect(resolveVessel("right and left transverse sinus thrombosis")).toBeNull();
    expect(resolveVessel("bilateral transverse sinus")).toBeNull();
    expect(canonicalVesselSlot("bilateral transverse sinus")).toBeNull();
  });

  it("does not invent a side for bilateral or unsided text", () => {
    expect(sideFromText("bilateral transverse sinus thrombosis")).toBeNull();
    expect(sideFromText("right transverse sinus")).toBe("right");
    expect(sideFromText("L M2")).toBe("left");
    expect(sideFromText("basilar artery")).toBeNull();
  });

  it("keeps an unpaired vessel unpaired even when a side is typed at it", () => {
    const slot = canonicalVesselSlot("right basilar artery");
    expect(slot?.level).toBe("BASILAR");
    expect(slot?.laterality).toBe("");
    expect(slot?.vessel.side).toBe("unpaired");
  });

  it("still finds the vessel inside descriptive prose", () => {
    expect(
      resolveVessel("abrupt cut-off of flow in the right ICA terminus", {
        territory: "intracranialArterial",
      })?.key,
    ).toBe("ica-terminus-right");
    expect(
      resolveVessel("marked asymmetry of the left PCA P1 segment", {
        territory: "intracranialArterial",
      })?.key,
    ).toBe("pca-p1-left");
  });

  it("reads the anterior communicating artery as one unpaired region", () => {
    expect(resolveVessel("ACom", { territory: "intracranialArterial" })?.key).toBe("acom");
    expect(canonicalVesselSlot("anterior communicating artery")?.laterality).toBe("");
  });

  it("keeps the transverse sinus hypoplasia variant as its own slot", () => {
    const slot = canonicalVesselSlot("hypoplastic left transverse sinus");
    expect(slot?.level).toBe("TRANSVERSE-SINUS-HYPOPLASIA-LEFT");
    expect(slot?.vessel.variantOnly).toBe(true);
  });
});

describe("mriBrainVessels — grouping used by the panels", () => {
  it("splits the circle of Willis from the posterior circulation", () => {
    const anterior = vesselsForSystem("anteriorCirculation").map((d) => d.key);
    const posterior = vesselsForSystem("posteriorCirculation").map((d) => d.key);
    expect(anterior).toContain("mca-m1-right");
    expect(anterior).toContain("acom");
    expect(anterior).not.toContain("basilar");
    expect(posterior).toContain("basilar");
    expect(posterior).toContain("pica-origin-left");
    expect(posterior).not.toContain("mca-m1-right");
  });

  it("keeps deep venous structures out of the dural sinus group", () => {
    const deep = vesselsForSystem("deepVenous").map((d) => d.key);
    expect(deep).toContain("vein-of-galen");
    expect(deep).toContain("internal-cerebral-vein-left");
    expect(deep).not.toContain("sss");
  });
});

describe("mriBrainVessels — concept identity is the real slot key", () => {
  it("gives each vessel one concept, shared by its sides and distinct across segments", () => {
    // The ledger discards a non-spine `level`, so identity lives here: same vessel
    // spellings collide, different segments and territories never do.
    expect(vesselConceptId(vesselByKey("mca-m1-right")!)).toBe("mra_vessel_mca_m1");
    expect(vesselConceptId(vesselByKey("mca-m1-left")!)).toBe("mra_vessel_mca_m1");
    expect(vesselConceptId(vesselByKey("mca-m2-right")!)).toBe("mra_vessel_mca_m2");
    expect(vesselConceptId(vesselByKey("ica-cervical-right")!)).toBe("mra_neck_vessel_ica_cervical");
    expect(vesselConceptId(vesselByKey("sss")!)).toBe("mrv_vessel_sss");
    expect(
      vesselConceptId(vesselByKey("transverse-sinus-hypoplasia-left")!, { variant: true }),
    ).toBe("mrv_vessel_transverse_sinus_hypoplasia_variant");
  });

  it("registers exactly one concept per vessel family, plus a variant concept per variant slot and an aneurysm concept per artery", () => {
    const entries = vesselConceptEntries();
    const concepts = entries.map((e) => e.concept);
    expect(new Set(concepts).size).toBe(concepts.length);
    const families = new Set(VESSEL_DEFINITIONS.map((d) => vesselBaseKey(d)));
    const variantFamilies = new Set(
      VESSEL_DEFINITIONS.filter((d) => d.variantOnly).map((d) => vesselBaseKey(d)),
    );
    const arterialFamilies = new Set(
      VESSEL_DEFINITIONS.filter(isAneurysmCapableVessel).map((d) => vesselBaseKey(d)),
    );
    expect(concepts.length).toBe(
      families.size + variantFamilies.size + arterialFamilies.size,
    );
    // Aneurysms are arterial (§6).
    expect(concepts.filter((c) => c.startsWith("mrv_aneurysm_"))).toEqual([]);
    for (const entry of entries) {
      expect(contentPackForConcept(entry.concept), entry.concept).toBeTruthy();
      // A side-free concept must not be labelled as one side.
      expect(entry.label).not.toMatch(/\b(right|left)\b/);
    }
    // Variants are non-pathologic, so they are registered but never impression-worthy
    // as an abnormality (§10).
    expect(entries.filter((e) => !e.impressionworthyAbnormal).length).toBeGreaterThan(5);
  });
});
