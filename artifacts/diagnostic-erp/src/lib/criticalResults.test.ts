import { describe, it, expect } from "vitest";
import { detectCriticalFindings, CRITICAL_TERMS } from "./criticalResults";
import { ANEURYSM_MACRO_IMPRESSION, CVST_MACRO_IMPRESSIONS } from "./mriBrainVascularProse";

describe("detectCriticalFindings (MRI PR 3 — Critical Results)", () => {
  it("detects a critical finding described in the Findings", () => {
    const hits = detectCriticalFindings("Restricted diffusion in the left MCA territory in keeping with an acute infarct.", []);
    expect(hits.map((h) => h.label)).toContain("acute infarct");
  });

  it("detects a critical finding described only in the Impression", () => {
    const hits = detectCriticalFindings("", ["Cord compression at C5-C6 with myelomalacia."]);
    expect(hits.map((h) => h.label)).toEqual(expect.arrayContaining(["cord compression", "myelomalacia"]));
  });

  it("ignores a clearly negated finding", () => {
    const hits = detectCriticalFindings("No acute infarct. No intracranial haemorrhage.", []);
    expect(hits).toEqual([]);
  });

  it("still flags a present finding alongside negated ones", () => {
    const hits = detectCriticalFindings("No acute infarct. There is cord compression at C4-C5.", []);
    const labels = hits.map((h) => h.label);
    expect(labels).toContain("cord compression");
    expect(labels).not.toContain("acute infarct");
  });

  it("de-duplicates British/American spellings to a single label", () => {
    const hits = detectCriticalFindings("Acute haemorrhage and further acute hemorrhage noted.", []);
    expect(hits.filter((h) => h.label === "acute haemorrhage")).toHaveLength(1);
  });

  it("uses the per-study watch list in addition to the built-in table", () => {
    const hits = detectCriticalFindings("Sella shows a pituitary adenoma with optic chiasma compression.", [], [
      "pituitary adenoma", "optic chiasma compression",
    ]);
    expect(hits.map((h) => h.label)).toEqual(expect.arrayContaining(["pituitary adenoma", "optic chiasma compression"]));
  });

  it("does not flag a specific term from a non-critical near-match", () => {
    // "disc herniation" must NOT match the critical "…herniation" entries,
    // which are all specific (tonsillar/uncal/transtentorial).
    const hits = detectCriticalFindings("Broad-based disc herniation at L4-L5 without canal stenosis.", []);
    expect(hits).toEqual([]);
  });

  it("returns nothing for an empty report", () => {
    expect(detectCriticalFindings("", [])).toEqual([]);
    expect(detectCriticalFindings("   ", [""])).toEqual([]);
  });

  it("every curated term carries a non-empty label", () => {
    for (const t of CRITICAL_TERMS) {
      expect(t.term.length).toBeGreaterThan(2);
      expect(t.label.length).toBeGreaterThan(0);
    }
  });
});

describe("§20 — the vascular reminders a dedicated MRA/MRV study adds", () => {
  /** The labels a report raises, deduplicated the way the dialog shows them. */
  const labels = (findings: string, impression: string[] = []) =>
    detectCriticalFindings(findings, impression).map((h) => h.label);

  it("reminds on a radiologist-stated arterial occlusion", () => {
    expect(labels("", ["Occlusion of the left MCA M1."])).toContain("vascular occlusion");
    expect(labels("There is acute arterial occlusion of the basilar artery.")).toContain(
      "vascular occlusion",
    );
  });

  it("reminds once, not four times, however the sentence is spelled", () => {
    const hits = detectCriticalFindings(
      "Large vessel occlusion. There is also large-vessel occlusion and arterial occlusion.",
      [],
    ).filter((h) => h.label === "vascular occlusion");
    expect(hits).toHaveLength(1);
  });

  it("reminds on the CVST macro's own impression lines", () => {
    const impression = [...CVST_MACRO_IMPRESSIONS];
    const found = labels("", impression);
    expect(found).toContain("dural venous sinus thrombosis");
    expect(found).toContain("venous infarction");
  });

  it("reminds on a ruptured aneurysm, and on a rupture that is only suspected", () => {
    expect(labels("", ["Ruptured aneurysm of the ACom region with subarachnoid haemorrhage."]))
      .toContain("ruptured aneurysm");
    expect(labels("Aneurysm with suspected rupture of the right MCA bifurcation."))
      .toContain("suspected aneurysm rupture");
  });

  it("reminds on the diagnosis, not on the moyamoya pattern alone (§18)", () => {
    expect(labels("", ["Moyamoya pattern of the terminal ICAs, without a stated diagnosis."]))
      .not.toContain("moyamoya disease");
    expect(labels("", ["Findings are diagnostic of Moyamoya disease."])).toContain(
      "moyamoya disease",
    );
  });

  it("stays quiet on an unruptured aneurysm and on a negated occlusion", () => {
    expect(labels("", [ANEURYSM_MACRO_IMPRESSION])).not.toContain("vascular occlusion");
    expect(labels("No occlusion of the intracranial arteries is demonstrated.")).toEqual([]);
    expect(
      labels("The dural venous sinuses are patent without filling defect or thrombosis."),
    ).toEqual([]);
  });
});
