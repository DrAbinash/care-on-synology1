import { describe, it, expect } from "vitest";
import { isFeatureEnabled } from "./staffSession";
import { generateUsgFinding } from "./usgFindingBuilder";
import { findingDefById, organByKey, organsForStudy } from "./usgOrganLibrary";
import {
  emptySection,
  organStatus,
  markNormal,
  addFinding,
  applyNormalToRemaining,
  composeImpression,
  composeFindingsSections,
  composeRawFindings,
  parseFindingsSections,
  buildUsgDraftPayload,
  type UsgOrganSection,
} from "./usgReportComposer";

const renalDef = findingDefById("renal_calculus")!;
const gbDef = findingDefById("gb_cholelithiasis")!;
const prostateDef = findingDefById("prostatomegaly")!;

function sectionFor(key: string): UsgOrganSection {
  return emptySection(key, organByKey(key)!.label);
}

describe("feature flag off behaviour", () => {
  it("ff_radiology_usg_workspace defaults OFF (no regression when disabled)", () => {
    expect(isFeatureEnabled("ff_radiology_usg_workspace")).toBe(false);
  });
});

describe("one-click Normal", () => {
  it("marks a single organ normal with its baseline statement", () => {
    const liver = markNormal(sectionFor("liver"), organByKey("liver")!.normalText);
    expect(liver.normal).toBe(true);
    expect(organStatus(liver)).toBe("normal");
    expect(liver.text).toContain("Liver is normal");
  });
});

describe("normal-all-remaining — non-destructive merge", () => {
  it("fills blank organs but never overwrites abnormal or typed text", () => {
    const organs = organsForStudy({ sex: "M", preset: "whole_abdomen" });
    const normalByOrgan = Object.fromEntries(organs.map((o) => [o.key, o.normalText]));

    // Right kidney is abnormal (has a finding); CBD has radiologist free-text.
    let rk = sectionFor("right_kidney");
    rk = addFinding(rk, generateUsgFinding(renalDef, { side: "Right", location: "Lower calyx", number: "Single", size: "5", hydronephrosis: "None" }).object);
    const cbd: UsgOrganSection = { ...sectionFor("cbd"), text: "CBD measures 9 mm — mildly prominent." };

    const sections = organs.map((o) => {
      if (o.key === "right_kidney") return rk;
      if (o.key === "cbd") return cbd;
      return sectionFor(o.key);
    });

    const filled = applyNormalToRemaining(sections, normalByOrgan);
    const byKey = Object.fromEntries(filled.map((s) => [s.organ, s]));

    // abnormal kidney untouched
    expect(byKey.right_kidney.normal).toBe(false);
    expect(byKey.right_kidney.findings.length).toBe(1);
    // typed CBD text preserved, not normalised
    expect(byKey.cbd.text).toBe("CBD measures 9 mm — mildly prominent.");
    expect(byKey.cbd.normal).toBe(false);
    // a previously-blank organ is now normal
    expect(byKey.liver.normal).toBe(true);
    expect(byKey.liver.text).toContain("Liver is normal");
  });

  it("is idempotent — re-running does not duplicate the normal statement", () => {
    const organs = organsForStudy({ sex: "F", preset: "pelvis" });
    const normalByOrgan = Object.fromEntries(organs.map((o) => [o.key, o.normalText]));
    let sections = organs.map((o) => sectionFor(o.key));
    sections = applyNormalToRemaining(sections, normalByOrgan);
    sections = applyNormalToRemaining(sections, normalByOrgan);
    for (const s of sections) {
      const normalText = organByKey(s.organ)!.normalText;
      const occurrences = s.text.split(normalText).length - 1;
      expect(occurrences, `${s.label} should carry its normal statement exactly once`).toBe(1);
    }
  });
});

describe("organ abnormal state is not overwritten by adding then normalising elsewhere", () => {
  it("adding a finding clears the normal baseline for that organ only", () => {
    let gbSection = markNormal(sectionFor("gallbladder"), organByKey("gallbladder")!.normalText);
    expect(gbSection.normal).toBe(true);
    gbSection = addFinding(gbSection, generateUsgFinding(gbDef, { number: "Multiple", largest: "3", mobility: "Mobile", wall: "Normal", pericholecystic: "Absent", murphy: "Negative" }).object);
    expect(gbSection.normal).toBe(false);
    expect(gbSection.text).toContain("Multiple mobile calculi");
    expect(gbSection.text).not.toContain("normally distended"); // baseline replaced, not appended
  });
});

describe("integration — build the canonical draft, round-trip, no parallel store", () => {
  it("composes findings_sections + impression + rawFindings and reloads structured findings", () => {
    const organs = organsForStudy({ sex: "M", preset: "whole_abdomen" });
    const normalByOrgan = Object.fromEntries(organs.map((o) => [o.key, o.normalText]));

    // 3. liver normal; 4. right middle-calyceal calculus 5.5mm; 5. GB multiple calculi 3cm; 6. prostate volume
    let sections = organs.map((o) => sectionFor(o.key));
    const put = (key: string, s: UsgOrganSection) => { sections = sections.map((x) => (x.organ === key ? s : x)); };

    put("liver", markNormal(sectionFor("liver"), normalByOrgan.liver));
    put("right_kidney", addFinding(sectionFor("right_kidney"),
      generateUsgFinding(renalDef, { side: "Right", location: "Middle calyx", number: "Single", size: "5.5", shadowing: "Present", hydronephrosis: "None" }).object));
    put("gallbladder", addFinding(sectionFor("gallbladder"),
      generateUsgFinding(gbDef, { number: "Multiple", largest: "3", mobility: "Mobile", wall: "Normal", pericholecystic: "Absent", murphy: "Negative" }).object));
    put("prostate", addFinding(sectionFor("prostate"),
      generateUsgFinding(prostateDef, { ap: "3.4", tr: "3.1", cc: "2.4" }).object));

    sections = applyNormalToRemaining(sections, normalByOrgan);

    const payload = buildUsgDraftPayload({
      draftId: null, studyId: 42, worklistId: 7, patientId: 100, modality: "US", studyName: "USG Whole Abdomen",
      clinicalHistory: "RUQ pain", sections,
    });

    // 7/10. Uses the canonical draft fields ONLY — no invented store keys.
    expect(Object.keys(payload).sort()).toEqual([
      "clinicalHistory", "findings", "findingsSections", "id", "impression",
      "modality", "patientId", "rawFindings", "recommendation", "studyId", "studyName", "templateId", "worklistId",
    ].sort());
    expect(payload.findings).toEqual([]); // structured findings live INSIDE findings_sections, not the DB-id array

    const fs = payload.findingsSections as Record<string, { normal: boolean; text: string; findings?: unknown[] }>;
    expect(fs["Liver"].normal).toBe(true);
    expect(fs["Right kidney"].findings).toHaveLength(1);
    expect(fs["Gallbladder"].findings).toHaveLength(1);
    expect(fs["Prostate"].findings).toHaveLength(1);

    const impression = payload.impression as string[];
    expect(impression).toContain("Right nephrolithiasis without hydronephrosis.");
    expect(impression).toContain("Cholelithiasis without sonographic evidence of acute cholecystitis.");
    expect(composeRawFindings(sections)).toContain("RIGHT KIDNEY:");

    // 8. Persist as the server would (JSON string) and reload → structured findings survive.
    const persisted = JSON.stringify(payload.findingsSections);
    const labelToKey = Object.fromEntries(organs.map((o) => [o.label, o.key]));
    const reloaded = parseFindingsSections(persisted, labelToKey);
    const rk = reloaded.find((s) => s.organ === "right_kidney")!;
    expect(rk.findings).toHaveLength(1);
    expect(rk.findings[0].findingDefId).toBe("renal_calculus");
    expect(rk.findings[0].parameters.size).toBe("5.5");
  });
});

describe("composeImpression dedupes identical contributions", () => {
  it("collapses two identical impression lines", () => {
    const mk = () => addFinding(sectionFor("right_kidney"),
      generateUsgFinding(renalDef, { side: "Right", location: "Lower calyx", number: "Single", size: "5", hydronephrosis: "None" }).object);
    expect(composeImpression([mk(), mk()])).toEqual(["Right nephrolithiasis without hydronephrosis."]);
  });
});
