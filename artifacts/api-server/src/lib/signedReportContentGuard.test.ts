import { describe, expect, it } from "vitest";
import {
  classifySignedReportBody,
  extractAuthoredText,
  readContentOverride,
  signedContentRefusal,
  CONTENT_OVERRIDE_MIN_REASON,
} from "./signedReportContentGuard";

/**
 * Every fixture below is built the way its producer builds it, not invented.
 * The point of this file is that it runs with NO database — the classifier is
 * pure — so the body shapes that reach POST /api/patient-reports/:id/sign are
 * pinned on a laptop and not only in CI.
 *
 * Two of the producers have since been deleted (B-10 removed the Command
 * Center's second editor and the standalone USG shell, and closed the legacy
 * free-text write). Their shapes stay here because patient_reports rows already
 * signed with that markup are in the clinic's database and the guard must keep
 * recognising them — they are historical producers, not live ones.
 */

/** The htmlBody RadiologyCommandCenter.tsx assembled before B-10 deleted it. */
function commandCenterBody(input: {
  title: string;
  patientName: string;
  clinicalHistory: string;
  technique: string;
  findingsText: string;
  impression: string[];
  recommendation: string;
}): string {
  const esc = (v: string) => String(v ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  return `
        <div style="font-family: sans-serif; padding: 20px;">
          <h3 style="break-after:avoid-page;page-break-after:avoid;">Radiology Report: ${esc(input.title)}</h3>
          <p><strong>Patient Name:</strong> ${esc(input.patientName)}</p>
          <p><strong>Clinical History:</strong> ${esc(input.clinicalHistory).replaceAll("\n", "<br/>")}</p>
          <p><strong>Technique:</strong> ${esc(input.technique).replaceAll("\n", "<br/>")}</p>
          <hr />
          <h4 style="break-after:avoid-page;page-break-after:avoid;">Findings</h4>
          <p style="white-space: pre-line;">${esc(input.findingsText)}</p>
          <h4 style="break-after:avoid-page;page-break-after:avoid;">Impression</h4>
          <ol>${input.impression.map((imp) => `<li>${esc(imp)}</li>`).join("")}</ol>
          <p><strong>Recommendation:</strong> ${esc(input.recommendation).replaceAll("\n", "<br/>")}</p>
        </div>
      `;
}

const emptyCommandCenter = commandCenterBody({
  title: "MRI Brain",
  patientName: "John Doe",
  clinicalHistory: "",
  technique: "",
  findingsText: "",
  impression: [],
  recommendation: "",
});

/** The htmlBody pages/UsgCompanionWorkspace.tsx signed before B-10 deleted it. */
function usgBody(studyDescription: string, sections: Array<{ label: string; text: string }>, impression: string[]): string {
  const escHtml = (v: string) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    `<h2>${escHtml(studyDescription || "Ultrasound Report")}</h2>`,
    ...sections.map((s) => `<h3>${escHtml(s.label)}</h3><p>${escHtml(s.text).replace(/\n/g, "<br/>")}</p>`),
    impression.length ? `<h3>Impression</h3><ol>${impression.map((l) => `<li>${escHtml(l)}</li>`).join("")}</ol>` : "",
  ].join("\n");
}

/**
 * Mirrors the shape buildLivePrintBodyHtml (radiologyReportPrintLiveMerge.ts:117)
 * emits: `<div class="section-heading">` labels with `<p>` content beneath, and
 * "—" as the sentinel for a structured finding with no text.
 */
const livePrintShape = (sections: Array<[string, string]>): string =>
  sections.map(([heading, text]) => `<div class="section-heading">${heading}</div>\n<p>${text}</p>`).join("\n");

describe("classifySignedReportBody — nothing to sign", () => {
  it("treats a missing body as empty", () => {
    for (const body of [undefined, null, "", "   ", "\n\t ", 42, {}]) {
      expect(classifySignedReportBody(body).level, String(body)).toBe("empty");
    }
  });

  it("refuses the Report Hub path: a row created with no body at all", () => {
    // ReportHub.tsx:490 POSTs { patientId, testId, type, title } and no body,
    // so patient_reports.body takes its column default of "". SignDialog (:970)
    // then signs it sending only { signatureId }.
    const result = classifySignedReportBody("");
    expect(result.level).toBe("empty");
    expect(result.clinicalText).toBe("");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("refuses buildSignedReportBodyHtml's all-empty output", () => {
    // Every section is conditional on its input being non-blank, so an
    // all-empty workspace finalize produces the empty string.
    expect(classifySignedReportBody("").level).toBe("empty");
  });

  it("refuses the Command Center body when every field is blank", () => {
    // This is the case a naive body.trim() === "" check misses: the HTML is
    // ~900 characters of unconditional scaffolding and zero authored text.
    expect(emptyCommandCenter.length).toBeGreaterThan(500);
    const result = classifySignedReportBody(emptyCommandCenter);
    expect(result.level).toBe("empty");
    expect(result.clinicalText).toBe("");
  });

  it("refuses the ultrasound body when no organ section was touched", () => {
    // sections.filter(organStatus !== "untouched") leaves only the <h2>.
    const body = usgBody("USG Abdomen", [], []);
    expect(classifySignedReportBody(body).level).toBe("empty");
  });

  it("refuses a body made only of the builder's em-dash sentinel", () => {
    const body = livePrintShape([["LIVER", "—"], ["SPLEEN", "—"]]);
    expect(classifySignedReportBody(body).level).toBe("empty");
  });

  it("does not count script or comment contents as authored text", () => {
    const body = `<script>window.__x = "todo"</script><!-- findings go here --><p></p>`;
    expect(classifySignedReportBody(body).level).toBe("empty");
  });
});

describe("classifySignedReportBody — placeholders", () => {
  it.each([
    ["<p>TODO</p>", "unfilled marker"],
    ["<p>TBD</p>", "unfilled marker"],
    ["<p>FIXME</p>", "unfilled marker"],
    ["<p>XXX</p>", "unfilled marker"],
    ["<p>[insert findings]</p>", "bracketed placeholder"],
    ["<p>[pending]</p>", "bracketed placeholder"],
    ["<p>[to be added]</p>", "bracketed placeholder"],
    ["<p>{{ findings }}</p>", "unrendered template token"],
    ["<p>lorem ipsum dolor sit amet</p>", "lorem ipsum"],
    ["<p>________</p>", "blank line"],
  ])("classifies %s as a placeholder", (body, token) => {
    const result = classifySignedReportBody(body);
    expect(result.level).toBe("placeholder");
    expect(result.placeholders).toContain(token);
  });

  it("classifies the Command Center body as a placeholder when findings are TODO", () => {
    const body = commandCenterBody({
      title: "MRI Brain",
      patientName: "John Doe",
      clinicalHistory: "",
      technique: "",
      findingsText: "TODO",
      impression: [],
      recommendation: "",
    });
    expect(classifySignedReportBody(body).level).toBe("placeholder");
  });

  it("is a placeholder only when NOTHING authored survives alongside it", () => {
    const body = "<p>TODO</p><p>Mild disc desiccation at L4-L5.</p>";
    expect(classifySignedReportBody(body).level).toBe("ok");
  });
});

describe("classifySignedReportBody — real content passes", () => {
  it("passes the Command Center body once findings are written", () => {
    const body = commandCenterBody({
      title: "MRI Brain",
      patientName: "John Doe",
      clinicalHistory: "Headache for two weeks.",
      technique: "T1, T2, FLAIR, DWI.",
      findingsText: "No acute intracranial abnormality.",
      impression: ["Normal study of the brain."],
      recommendation: "",
    });
    const result = classifySignedReportBody(body);
    expect(result.level).toBe("ok");
    expect(result.clinicalText).toContain("No acute intracranial abnormality.");
    expect(result.clinicalText).toContain("Normal study of the brain.");
    expect(result.clinicalText).toContain("Headache for two weeks.");
  });

  it("passes a terse negative finding — 'None' is authored, not empty", () => {
    expect(classifySignedReportBody("<p>Findings: None</p>").level).toBe("ok");
    expect(classifySignedReportBody("<p>No significant abnormality.</p>").level).toBe("ok");
  });

  it("passes the ultrasound body once a section is written", () => {
    const body = usgBody("USG Abdomen", [{ label: "Liver", text: "Normal in size and echotexture." }], ["Normal abdominal ultrasound."]);
    const result = classifySignedReportBody(body);
    expect(result.level).toBe("ok");
    expect(result.clinicalText).toContain("Normal in size and echotexture.");
  });

  it("passes the live-print shape once a section has text", () => {
    const body = livePrintShape([["LIVER", "—"], ["SPLEEN", "Normal."]]);
    expect(classifySignedReportBody(body).level).toBe("ok");
  });

  it("counts a clinical history with nothing else as authored", () => {
    // Deliberate: deciding that findings are mandatory and history is not
    // would be clinical policy this module has no basis to invent.
    const body = commandCenterBody({
      title: "MRI Brain",
      patientName: "John Doe",
      clinicalHistory: "Seizure disorder, on follow-up.",
      technique: "",
      findingsText: "",
      impression: [],
      recommendation: "",
    });
    expect(classifySignedReportBody(body).level).toBe("ok");
  });
});

describe("extractAuthoredText — scaffold labels must not eat authored words", () => {
  it.each([
    "Test shows a mass in the right lobe.",
    "Date of the scan was not recorded.",
    "Patient was unwell at the time of imaging.",
    "Accession of contrast was uneventful.",
    "History of the presenting complaint is unavailable.",
    "Modality appears inconsistent with the request.",
  ])("preserves the authored line %s", (line) => {
    const text = extractAuthoredText(`<p>${line}</p>`);
    expect(text).toBe(line);
    expect(classifySignedReportBody(`<p>${line}</p>`).level).toBe("ok");
  });

  it("drops the label but keeps an authored value after a colon", () => {
    expect(extractAuthoredText("<p><strong>Technique:</strong> T2 FLAIR.</p>")).toContain("T2 FLAIR.");
  });

  it("drops a demographic label and its builder-supplied value", () => {
    expect(extractAuthoredText("<p><strong>Patient Name:</strong> John Doe</p>")).toBe("");
    expect(extractAuthoredText("<p>Age/Sex: 44/M</p>")).toBe("");
    expect(extractAuthoredText("<p>Accession: ACC-1234</p>")).toBe("");
    expect(extractAuthoredText("<p>Ref. By: Dr Sharma</p>")).toBe("");
  });

  it("drops both heading shapes the producers use", () => {
    expect(extractAuthoredText(`<h4>Findings</h4><p>Mild atrophy.</p>`)).toBe("Mild atrophy.");
    expect(extractAuthoredText(`<div class="section-heading">IMPRESSION</div><p>Normal.</p>`)).toBe("Normal.");
    expect(extractAuthoredText(`<table><tr><th>Region</th><td>L4-L5</td></tr></table>`)).toBe("L4-L5");
  });

  it("decodes the entities the producers actually emit", () => {
    expect(extractAuthoredText("<p>Mass &amp; oedema, 5&nbsp;mm.</p>")).toContain("Mass & oedema, 5 mm.");
    expect(extractAuthoredText("<p>&#39;Normal&#39; study.</p>")).toContain("'Normal' study.");
    expect(extractAuthoredText("<p>&#8212; is not a finding.</p>")).toContain("— is not a finding.");
  });

  it("recognises a demographic label even when its colon was escaped", () => {
    expect(extractAuthoredText("<p>Patient&nbsp;Name: John Doe</p>")).toBe("");
  });

  it("does not throw on malformed markup", () => {
    for (const body of ["<p>unclosed", "<div class=\"section-heading\">no close", "<h3>", "<>", "&#", "&#999999999999;"]) {
      expect(() => classifySignedReportBody(body)).not.toThrow();
    }
  });

  it("separates block content onto its own lines", () => {
    const text = extractAuthoredText("<p>First finding.</p><p>Second finding.</p>");
    expect(text.split("\n")).toEqual(["First finding.", "Second finding."]);
  });
});

describe("signedContentRefusal — what the signer is actually shown", () => {
  it("reads as sentences, with no letter glued onto a full stop", () => {
    // The sentence is built by concatenation, so a missing space between two
    // parts is invisible in a code read. This is the assertion that catches it.
    for (const body of ["", "<p>TODO</p>", "<p>[insert findings]</p>"]) {
      const content = classifySignedReportBody(body);
      const refusal = signedContentRefusal(content);
      expect(refusal.error, refusal.error).not.toMatch(/\.[A-Za-z]/);
      expect(refusal.error).toContain("contentOverrideReason");
      expect(refusal.error).toContain(String(CONTENT_OVERRIDE_MIN_REASON));
    }
  });

  it("names the level in the code and always offers the override", () => {
    const empty = signedContentRefusal(classifySignedReportBody(""));
    expect(empty.code).toBe("report_content_empty");
    expect(empty.level).toBe("empty");
    expect(empty.override.allowed).toBe(true);
    expect(empty.override.flag).toBe("contentOverride");
    expect(empty.override.reasonField).toBe("contentOverrideReason");

    const placeholder = signedContentRefusal(classifySignedReportBody("<p>TODO</p>"));
    expect(placeholder.code).toBe("report_content_placeholder");
    expect(placeholder.error).toContain("unfilled marker");
    expect(placeholder.override.allowed).toBe(true);
  });

  it("keeps the machine token out of error, which is the field the toast shows", () => {
    // sanitizeApiErrorMessage returns `error` verbatim unless it is one of a few
    // generic strings, so if the token lived here the signer's toast would read
    // "report_content_empty" and the override instructions would never be seen.
    for (const body of ["", "<p>TODO</p>"]) {
      const refusal = signedContentRefusal(classifySignedReportBody(body));
      expect(refusal.error).toMatch(/^This report /);
      expect(refusal.error).not.toBe(refusal.code);
      expect(refusal.error).not.toContain("report_content_");
    }
  });
});

describe("readContentOverride — the override contract", () => {
  const ok = "Dictation to follow by addendum";

  it("needs BOTH the flag and a reason long enough to be a reason", () => {
    expect(readContentOverride({ contentOverride: true, contentOverrideReason: ok })).toBe(ok);
    expect(readContentOverride({ contentOverrideReason: ok })).toBeNull();
    expect(readContentOverride({ contentOverride: true })).toBeNull();
    expect(readContentOverride({ contentOverride: false, contentOverrideReason: ok })).toBeNull();
    expect(readContentOverride({ contentOverride: "true", contentOverrideReason: ok })).toBeNull();
    expect(readContentOverride({})).toBeNull();
  });

  it("trims the reason and enforces the same minimum as the soft-final override", () => {
    expect(CONTENT_OVERRIDE_MIN_REASON).toBe(3);
    expect(readContentOverride({ contentOverride: true, contentOverrideReason: `  ${ok}  ` })).toBe(ok);
    expect(readContentOverride({ contentOverride: true, contentOverrideReason: "x".repeat(CONTENT_OVERRIDE_MIN_REASON - 1) })).toBeNull();
    expect(readContentOverride({ contentOverride: true, contentOverrideReason: "x".repeat(CONTENT_OVERRIDE_MIN_REASON) })).not.toBeNull();
    expect(readContentOverride({ contentOverride: true, contentOverrideReason: "   " })).toBeNull();
    expect(readContentOverride({ contentOverride: true, contentOverrideReason: 42 })).toBeNull();
  });
});
