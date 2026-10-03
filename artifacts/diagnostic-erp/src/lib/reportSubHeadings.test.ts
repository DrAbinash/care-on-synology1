import { describe, expect, it } from "vitest";
import {
  findingsBodyForTemplate,
  findingsTextFromSections,
  headingsForTemplate,
  headingsInFindings,
  retitleFindingsDocument,
  sectionsFromTemplateJson,
} from "./reportSubHeadings";

const V1 = JSON.stringify({
  technique: "MRI Lumbo-sacral Spine.",
  findingsItems: [
    { label: "Alignment", normal: "Normal lumbar lordosis." },
    { label: "Vertebral Body", normal: "Normal heights and marrow signal." },
    { label: "Disc Level Analysis", normal: "L1-L2: Normal.\nL2-L3: Normal." },
  ],
});

const V2 = JSON.stringify({
  schemaVersion: 2,
  sections: [
    { id: "a", label: "Alignment", normalText: "Normal lordosis." },
    { id: "b", label: "Facets & Ligaments", normalText: "No arthropathy." },
  ],
});

const V2_NO_NORMALS = JSON.stringify({
  schemaVersion: 2,
  sections: [{ id: "a", label: "Alignment" }, { id: "b", label: "Facets & Ligaments" }],
});

describe("sectionsFromTemplateJson", () => {
  it("reads the v1 findingsItems shape", () => {
    expect(sectionsFromTemplateJson(V1).map((s) => s.label))
      .toEqual(["Alignment", "Vertebral Body", "Disc Level Analysis"]);
  });

  it("reads the v2 sections shape, which names a section label", () => {
    expect(sectionsFromTemplateJson(V2).map((s) => s.label))
      .toEqual(["Alignment", "Facets & Ligaments"]);
  });

  it("returns nothing rather than throwing on junk or an absent format", () => {
    expect(sectionsFromTemplateJson("{not json")).toEqual([]);
    expect(sectionsFromTemplateJson(null)).toEqual([]);
    expect(sectionsFromTemplateJson(JSON.stringify({ other: 1 }))).toEqual([]);
  });
});

describe("findingsTextFromSections", () => {
  it("builds the sub-headed document the format's sections describe", () => {
    const text = findingsTextFromSections(sectionsFromTemplateJson(V1));
    expect(text).toContain("Alignment:\nNormal lumbar lordosis.");
    expect(headingsInFindings(text)).toEqual(["Alignment", "Vertebral Body", "Disc Level Analysis"]);
  });

  it("yields nothing when no section carries normal wording, so the caller keeps its fallback", () => {
    expect(findingsTextFromSections(sectionsFromTemplateJson(V2_NO_NORMALS))).toBe("");
  });

  it("uses a v2 format's own normalText, which is what the Templates screen writes", () => {
    const text = findingsTextFromSections(sectionsFromTemplateJson(V2));
    expect(text).toBe("Alignment:\nNormal lordosis.\n\nFacets & Ligaments:\nNo arthropathy.");
  });
});

describe("findingsBodyForTemplate", () => {
  it("keeps authored sub-headed text ahead of the section list", () => {
    const structured = "Alignment:\nCurated wording.";
    const body = findingsBodyForTemplate({ sectionsJson: V1, defaultFindings: structured });
    expect(body).toBe(structured);
  });

  it("falls back to the format's sections when the authored text is one paragraph", () => {
    // This is the case that makes a Templates-screen edit change the report:
    // the section list is what the format declares, so it becomes the layout.
    const body = findingsBodyForTemplate({
      sectionsJson: V1,
      defaultFindings: "Lumbar lordosis preserved. Disc heights maintained.",
    });
    expect(headingsInFindings(body)).toEqual(["Alignment", "Vertebral Body", "Disc Level Analysis"]);
  });

  it("returns the legacy paragraph when a format declares no sections", () => {
    const legacy = "Liver is normal in size and echotexture.";
    expect(findingsBodyForTemplate({ sectionsJson: null, defaultFindings: legacy })).toBe(legacy);
    expect(findingsBodyForTemplate(null)).toBe("");
  });

  it("reports the headings a format will print with", () => {
    expect(headingsForTemplate({ sectionsJson: V1, defaultFindings: "Alignment:\nNormal." }))
      .toEqual(["Alignment"]);
    expect(headingsForTemplate({ sectionsJson: V1, defaultFindings: "One flat paragraph." }))
      .toEqual(["Alignment", "Vertebral Body", "Disc Level Analysis"]);
  });
});

describe("retitleFindingsDocument", () => {
  const SPINE = [
    "Alignment:",
    "Normal lumbar lordosis maintained.",
    "",
    "Disc Level Analysis:",
    "L1-L2: Normal.",
    "",
    "Canal Diameter:",
    "| Level | AP Canal (mm) |",
    "| L1-L2 | — |",
    "",
    "A sentence typed before any heading existed.",
  ].join("\n\n");

  it("renames a heading without losing the body underneath it", () => {
    const out = retitleFindingsDocument(SPINE, ["Vertebral Alignment", "Disc Level Analysis", "Canal Diameter"]);
    expect(out).toContain("Vertebral Alignment:");
    expect(/(^|\n)Alignment:/m.test(out)).toBe(false);
    // The body still survives, in the section that now owns it.
    expect(out).toContain("Normal lumbar lordosis maintained.");
  });

  it("keeps free text that was never under a heading", () => {
    const out = retitleFindingsDocument(SPINE, ["Alignment", "Disc Level Analysis"]);
    expect(out).toContain("A sentence typed before any heading existed.");
  });

  it("carries the canal table with the heading it belonged to", () => {
    const out = retitleFindingsDocument(SPINE, ["Alignment", "Canal Diameter"]);
    const canalIdx = out.indexOf("Canal Diameter:");
    const tableIdx = out.indexOf("| Level | AP Canal (mm) |");
    expect(canalIdx).toBeGreaterThan(-1);
    expect(tableIdx).toBeGreaterThan(canalIdx);
  });

  it("adds a new heading with an empty body instead of inventing clinical text", () => {
    const out = retitleFindingsDocument(SPINE, ["Alignment", "Disc Level Analysis", "Sacrum"]);
    expect(out).toContain("Sacrum:");
    // Nothing may be fabricated into a spine report.
    expect(out).not.toMatch(/Sacrum:\n\s*(Normal|Unremarkable)/i);
  });

  it("never deletes the body of a heading the list dropped", () => {
    const out = retitleFindingsDocument(SPINE, ["Alignment"]);
    expect(out).toContain("L1-L2: Normal.");
    expect(out).toContain("Retained notes:");
  });

  it("leaves the text alone when given an empty heading list", () => {
    expect(retitleFindingsDocument(SPINE, [])).toBe(SPINE.trim());
  });

  it("matches headings case- and space-insensitively", () => {
    const out = retitleFindingsDocument("alignment:\nNormal lordosis.", ["Alignment"]);
    expect(out).toContain("Alignment:\nNormal lordosis.");
  });
});
