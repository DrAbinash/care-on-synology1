import { describe, it, expect } from "vitest";
import { generateUsgFinding } from "./usgFindingBuilder";
import { findingDefById } from "./usgOrganLibrary";
import {
  emptySection, setOrganStatus, markNormal, addFinding, removeFinding,
  organStatus, composeFindingsSections, composeRawFindings, parseFindingsSections,
} from "./usgReportComposer";

const renalDef = findingDefById("renal_calculus")!;
const gbDef = findingDefById("gb_cholelithiasis")!;

describe("P2.4 persistent organ states", () => {
  it("not_applicable → no report text, persisted, no rawFindings text", () => {
    const s = setOrganStatus(emptySection("prostate", "Prostate"), "not_applicable");
    expect(organStatus(s)).toBe("not_applicable");
    expect(s.text).toBe("");
    expect(composeRawFindings([s])).toBe(""); // N/A emits no text
    const fs = composeFindingsSections([s]);
    expect(fs["Prostate"].status).toBe("not_applicable");
  });

  it("surgically_absent → keeps the clinical statement and shows in rawFindings", () => {
    const s = setOrganStatus(emptySection("gallbladder", "Gallbladder"), "surgically_absent", "Gallbladder is surgically absent (post-cholecystectomy).");
    expect(organStatus(s)).toBe("surgically_absent");
    expect(composeRawFindings([s])).toContain("surgically absent");
  });

  it("not_visualized → configured statement or empty", () => {
    const withText = setOrganStatus(emptySection("pancreas", "Pancreas"), "not_visualized", "Pancreas not adequately visualized due to bowel gas.");
    expect(organStatus(withText)).toBe("not_visualized");
    expect(withText.text).toMatch(/not adequately visualized/i);
    const noText = setOrganStatus(emptySection("pancreas", "Pancreas"), "not_visualized");
    expect(noText.text).toBe("");
  });

  it("findings dominate over an explicit status (→ abnormal)", () => {
    let s = setOrganStatus(emptySection("right_kidney", "Right kidney"), "not_visualized", "x");
    s = addFinding(s, generateUsgFinding(renalDef, { side: "Right", location: "Lower calyx", number: "Single", size: "5", hydronephrosis: "None" }).object);
    expect(organStatus(s)).toBe("abnormal");
    expect(s.status).toBeUndefined(); // cleared when a finding was added
  });

  it("removing the last abnormality does NOT silently mark the organ normal", () => {
    let s = addFinding(emptySection("gallbladder", "Gallbladder"),
      generateUsgFinding(gbDef, { number: "Single", largest: "5 mm", mobility: "Mobile", wall: "Normal", pericholecystic: "Absent", murphy: "Not assessed" }).object);
    expect(organStatus(s)).toBe("abnormal");
    s = removeFinding(s, 0);
    expect(organStatus(s)).toBe("untouched"); // NOT "normal"
    expect(s.normal).toBe(false);
  });

  it("markNormal clears any explicit status", () => {
    let s = setOrganStatus(emptySection("liver", "Liver"), "incomplete");
    s = markNormal(s, "Liver is normal.");
    expect(s.status).toBeUndefined();
    expect(organStatus(s)).toBe("normal");
  });

  it("status round-trips through the canonical findings_sections JSON", () => {
    const sections = [
      setOrganStatus(emptySection("prostate", "Prostate"), "not_applicable"),
      setOrganStatus(emptySection("gallbladder", "Gallbladder"), "surgically_absent", "Gallbladder is surgically absent (post-cholecystectomy)."),
    ];
    const json = JSON.stringify(composeFindingsSections(sections));
    const reloaded = parseFindingsSections(json, { "Prostate": "prostate", "Gallbladder": "gallbladder" });
    expect(reloaded.find((s) => s.organ === "prostate")!.status).toBe("not_applicable");
    expect(reloaded.find((s) => s.organ === "gallbladder")!.status).toBe("surgically_absent");
    expect(reloaded.find((s) => s.organ === "gallbladder")!.text).toContain("surgically absent");
  });
});
