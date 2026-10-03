import { describe, expect, it } from "vitest";
import { parseStoredReportBody } from "./storedReportBody";
import { buildSignedReportBodyHtml } from "./radiologyReportPrintLiveMerge";

/**
 * `patient_reports.body` is signed report HTML (or, for the D5 structured
 * writer, plain labelled text) — never narrative findings text. Five writers
 * produce it and they do not agree on shape. Each case below is the exact
 * markup that writer emits, taken from source.
 */

const WORKSPACE_BODY = buildSignedReportBodyHtml({
  clinicalHistory: "Headache for 3 weeks.",
  technique: "MRI Brain with contrast",
  findingsText: "No acute intracranial lesion.\nMild mucosal thickening.",
  impressionText: "Normal MRI Brain",
  recommendationText: "Clinical correlation advised.",
});

describe("parseStoredReportBody — reporting workspace writer (.section-heading divs)", () => {
  it("recovers all five sections in document order", () => {
    const p = parseStoredReportBody(WORKSPACE_BODY, { title: "MRI Brain" });
    expect(p.clinicalHistory).toBe("Headache for 3 weeks.");
    expect(p.technique).toBe("MRI Brain with contrast");
    expect(p.findings).toBe("No acute intracranial lesion.\nMild mucosal thickening.");
    expect(p.impression).toBe("Normal MRI Brain");
    expect(p.recommendation).toBe("Clinical correlation advised.");
  });

  it("keeps fullText free of markup and in the order the signer saw", () => {
    const { fullText } = parseStoredReportBody(WORKSPACE_BODY, { title: "MRI Brain" });
    expect(fullText).not.toMatch(/</);
    expect(fullText.indexOf("CLINICAL HISTORY:")).toBeLessThan(fullText.indexOf("TECHNIQUE:"));
    expect(fullText.indexOf("TECHNIQUE:")).toBeLessThan(fullText.indexOf("No acute"));
    expect(fullText.indexOf("No acute")).toBeLessThan(fullText.indexOf("IMPRESSION:"));
    expect(fullText.indexOf("IMPRESSION:")).toBeLessThan(fullText.indexOf("RECOMMENDATION:"));
  });
});

describe("parseStoredReportBody — USG companion writer (<h2>/<h3>, organ sub-headings)", () => {
  const body = [
    "<h2>USG Abdomen</h2>",
    "<h3>Liver</h3><p>Normal size and echotexture.</p>",
    "<h3>Gallbladder</h3><p>Two calculi, largest 6 mm.</p>",
    "<h3>Impression</h3><ol><li>Cholelithiasis</li></ol>",
  ].join("\n");

  it("drops the document title, keeps organ cards as findings, keeps the impression list", () => {
    const p = parseStoredReportBody(body, { title: "USG Abdomen" });
    expect(p.findings).toBe("Liver\nNormal size and echotexture.\nGallbladder\nTwo calculi, largest 6 mm.");
    expect(p.impression).toBe("Cholelithiasis");
    expect(p.fullText).not.toContain("<h");
  });
});

describe("parseStoredReportBody — command centre writer (<h3>/<h4> + inline <strong>Label:</strong>)", () => {
  const esc = (v: string) => String(v ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const title = "MRI Brain + MRV";
  const body = `
        <div style="font-family: sans-serif; padding: 20px;">
          <h3 style="break-after:avoid-page;page-break-after:avoid;">Radiology Report: ${esc(title)}</h3>
          <p><strong>Patient Name:</strong> ${esc("Ramesh Kumar")}</p>
          <p><strong>Clinical History:</strong> ${esc("Seizure disorder").replaceAll("\n", "<br/>")}</p>
          <p><strong>Technique:</strong> ${esc("T1, T2, FLAIR").replaceAll("\n", "<br/>")}</p>
          <hr />
          <h4 style="break-after:avoid-page;page-break-after:avoid;">Findings</h4>
          <p style="white-space: pre-line;">${esc("Left temporal gliosis.")}</p>
          <h4 style="break-after:avoid-page;page-break-after:avoid;">Impression</h4>
          <ol><li>${esc("Old infarct")}</li></ol>
          <p><strong>Recommendation:</strong> ${esc("EEG correlation").replaceAll("\n", "<br/>")}</p>
        </div>
      `;

  it("routes the inline-labelled paragraphs to the right sections", () => {
    const p = parseStoredReportBody(body, { title });
    expect(p.clinicalHistory).toBe("Seizure disorder");
    expect(p.technique).toBe("T1, T2, FLAIR");
    expect(p.findings).toBe("Left temporal gliosis.");
    expect(p.impression).toBe("Old infarct");
    expect(p.recommendation).toBe("EEG correlation");
  });

  it("does not mistake the report title heading or the Patient Name line for a section", () => {
    const p = parseStoredReportBody(body, { title });
    expect(p.fullText).not.toContain("Radiology Report:");
    // "Patient Name:" is not a known label — it stays readable text, it is not
    // swallowed as a heading and it does not start a section of its own.
    expect(p.fullText).toContain("Patient Name: Ramesh Kumar");
    expect(p.clinicalHistory).not.toContain("Ramesh Kumar");
  });
});

describe("parseStoredReportBody — reporting studio writer (bare <h3>)", () => {
  const body = ["Technique", "Findings", "Impression", "Recommendation"]
    .map((h, i) => `<h3>${h}</h3>\n<p>${["Contrast study.", "Nephrolithiasis.", "Stone disease.", "Urology review."][i]}</p>`)
    .join("\n");

  it("recognises bare h3 headings it used to skip", () => {
    const p = parseStoredReportBody(body, { title: "CT KUB" });
    expect(p.technique).toBe("Contrast study.");
    expect(p.findings).toBe("Nephrolithiasis.");
    expect(p.impression).toBe("Stone disease.");
    expect(p.recommendation).toBe("Urology review.");
  });
});

describe("parseStoredReportBody — D5 structured writer (plain labelled text, no markup)", () => {
  const body = [
    "TECHNIQUE:",
    "T1 and T2 sagittal sequences.",
    "",
    "FINDINGS:",
    "There is a disc herniation.",
    "Mild canal narrowing.",
    "",
    "IMPRESSION:",
    "Disc herniation at L4-L5.",
  ].join("\n");

  it("splits the labelled plain-text body without any HTML", () => {
    const p = parseStoredReportBody(body, { title: "MRI LS Spine" });
    expect(p.technique).toBe("T1 and T2 sagittal sequences.");
    expect(p.findings).toBe("There is a disc herniation.\nMild canal narrowing.");
    expect(p.impression).toBe("Disc herniation at L4-L5.");
    expect(p.fullText).toContain("FINDINGS:");
  });
});

describe("parseStoredReportBody — legacy and hostile bodies", () => {
  it("reads a pre-R1.4 row whose tags were stripped into run-on text", () => {
    const p = parseStoredReportBody(
      "MRI Brain Findings: No lesion. Impression: Normal. Recommendation: nil",
      { title: "MRI Brain" },
    );
    // No markup to walk, so nothing is lost — the line survives in fullText.
    expect(p.fullText).toContain("Findings: No lesion. Impression: Normal.");
  });

  it("decodes the entities both escapers emit, including apostrophes", () => {
    const p = parseStoredReportBody(
      `<div class="section-heading">FINDINGS</div><p>Patient&apos;s scan &amp; prior &lt;study&gt; reviewed.</p>`,
      { title: "X-ray Chest" },
    );
    expect(p.findings).toBe("Patient's scan & prior <study> reviewed.");
  });

  it("never emits markup, and never throws on null / empty / unknown input", () => {
    for (const body of [null, undefined, "", "   ", "<div>not a report</div>", "plain prose only"]) {
      const p = parseStoredReportBody(body, { title: "T" });
      expect(p.fullText).not.toMatch(/<[a-z/]/i);
      expect(p.findings).not.toMatch(/<[a-z/]/i);
    }
  });

  it("treats a missing title option as no title, not as a title that matches everything", () => {
    const p = parseStoredReportBody(
      `<h3>Radiology Report</h3><h3>Findings</h3><p>Text.</p>`,
    );
    // The first heading of a stored body is the document title for every writer
    // that emits one, so position identifies it even without the title column.
    expect(p.findings).toBe("Text.");
    expect(p.fullText).not.toContain("Radiology Report");
  });
});

describe("buildSignedReportBodyHtml — the artifact must match the approved preview", () => {
  const input = {
    clinicalHistory: "Fever with altered sensorium.",
    technique: "CECT Brain",
    findingsText: "Ring-enhancing lesion in the right frontal lobe, 8.7 mm.",
    impressionText: "Solitary ring-enhancing lesion\nSuggestive of neurocysticercosis",
    recommendationText: "Serology and follow-up imaging.",
  };

  it("carries Clinical History and Technique, which the old finalize payload dropped", () => {
    const html = buildSignedReportBodyHtml(input);
    expect(html).toContain("CLINICAL HISTORY");
    expect(html).toContain("Fever with altered sensorium.");
    expect(html).toContain("TECHNIQUE");
    expect(html).toContain("CECT Brain");
    expect(html).toContain("8.7 mm");
  });

  it("does not repeat the study title that reportPresentation already renders", () => {
    const html = buildSignedReportBodyHtml(input);
    expect(html).not.toContain("<h2");
  });

  it("emits the Impression once, so suppressing the highlight box loses nothing", () => {
    const html = buildSignedReportBodyHtml(input);
    expect(html.match(/Impression/gi)).toHaveLength(1);
    expect(html).toContain("Solitary ring-enhancing lesion");
    expect(html).toContain("Suggestive of neurocysticercosis");
  });

  it("reads back through the same parser it is written with", () => {
    const p = parseStoredReportBody(buildSignedReportBodyHtml(input), { title: "CECT Brain" });
    expect(p.clinicalHistory).toBe(input.clinicalHistory);
    expect(p.technique).toBe(input.technique);
    expect(p.findings).toBe(input.findingsText);
    expect(p.recommendation).toBe(input.recommendationText);
    expect(p.impression).toBe("Solitary ring-enhancing lesion\nSuggestive of neurocysticercosis");
  });

  it("signs the narrative text the gates evaluated, not a stale structured map", () => {
    // The map→text sync is one-way: typing directly into Findings leaves the
    // map behind. The signed body must be the text that was validated.
    const html = buildSignedReportBodyHtml({
      ...input,
      findingsText: "Hand-typed finding that the map never saw.",
      useStructured: true,
      findingsMap: { Liver: { normal: false, text: "Stale card text." } },
    });
    expect(html).toContain("Hand-typed finding that the map never saw.");
    expect(html).not.toContain("Stale card text.");
    expect(html).not.toContain("Liver");
  });

  it("uses the per-region structured headings while the map still reproduces the text", () => {
    const findingsMap = {
      Brain: { normal: false, text: "No lesion." },
      Orbits: { normal: true, text: "Normal." },
    };
    const findingsText = "Brain: No lesion.\n\nOrbits: Normal.";
    const html = buildSignedReportBodyHtml({ ...input, findingsText, useStructured: true, findingsMap });
    expect(html).toContain("BRAIN");
    expect(html).toContain("ORBITS");
    expect(html).not.toContain(">FINDINGS<");
  });
});
