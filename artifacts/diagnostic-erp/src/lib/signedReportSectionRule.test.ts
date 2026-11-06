/**
 * The empty-Findings rule, scored against bodies the SHIPPED producers emit.
 *
 * Ruling 3 (owner, 2026-11-06): "Empty Findings → BLOCK signing, with a
 * documented override for exceptional cases." The rule cannot be written
 * against invented HTML — the bodies that matter are the ones
 * `buildSignedReportBodyHtml` actually produces, in each of its three modes
 * (raw findings, per-region structured findings, and a stale map falling back
 * to raw), plus the shapes the other four body producers emit. So the cases
 * below call the real builder and assert the verdict against the input state
 * that BUILT the body. That is what makes a false positive here impossible to
 * hide: every "ok" row is a report the clinic signs today, and if the rule ever
 * starts refusing one of them this file goes red.
 *
 * WHY IT LIVES ON THE CLIENT SIDE OF THE MONOREPO: the ground truth IS the
 * client's builder, so the import is static rather than mocked. `api-server`'s
 * tsconfig sets `rootDir: src`, which makes any cross-package static import a
 * TS6059 for the whole imported graph; this package's tsconfig excludes
 * `**\/*.test.ts`, so the same import is harmless here. Vitest's include
 * pattern covers `artifacts/*`, so the file runs either way.
 *
 * WHAT THE RULE ACTUALLY IS (see signedReportSectionsOf for the whole design):
 *  - Findings empty is judged only in a document that declares sections at all.
 *    A free-text paragraph report has no sections to be empty, and refusing it
 *    would be the guard inventing a structure the radiologist never wrote.
 *  - An ABSENT Impression is signable: a normal study legitimately has findings
 *    and no impression. A RENDERED-but-empty Impression is not: the producer
 *    drew the heading and found nothing to put under it.
 *  - An unresolved `{token}` outranks this rule, because it names a specific
 *    fix rather than a missing section.
 */
import { describe, expect, it } from "vitest";
import { buildSignedReportBodyHtml, type SignedReportBodyInput } from "./radiologyReportPrintLiveMerge";
import { LABEL_TO_SECTION } from "./storedReportBody";
import { canalPrintPlan } from "@workspace/measurements";
import {
  classifySignedReportBody,
  signedContentRefusal,
  signedReportSectionsOf,
  SECTION_LABELS,
} from "../../../api-server/src/lib/signedReportContentGuard";

/** The verdict this suite cares about: level, plus which sections it names. */
function verdict(body: string): string {
  const c = classifySignedReportBody(body);
  return c.level === "incomplete" ? `incomplete:${c.emptySections.join("+")}` : c.level;
}

const signed = (input: Partial<SignedReportBodyInput>) =>
  buildSignedReportBodyHtml({
    clinicalHistory: "", technique: "", findingsText: "", impressionText: "", recommendationText: "",
    ...input,
  });

describe("empty Findings blocks signing — against the real body builder", () => {
  it("signs the normal study: findings, technique, no Impression section at all", () => {
    const body = signed({
      technique: "MRI without contrast.",
      findingsText: "No acute abnormality. Ventricles and sulci are age appropriate.",
    });
    expect(verdict(body)).toBe("ok");
  });

  it("refuses the report that dictated an Impression and no Findings", () => {
    // This is the defect ruling 3 names: Technique and Impression carry text, so
    // the old blank-body test passed it, while the section a radiologist reads
    // first printed nothing at all.
    const body = signed({
      technique: "MRI without contrast.",
      impressionText: "No acute abnormality.",
    });
    expect(verdict(body)).toBe("incomplete:findings");
    const refusal = signedContentRefusal(classifySignedReportBody(body));
    expect(refusal.code).toBe("report_content_incomplete");
    expect(refusal.error).toContain("Findings is empty");
    expect(refusal.error).toContain("contentOverrideReason");
    expect(refusal.sections).toEqual(["findings"]);
  });

  it("signs structured findings where every region is normal", () => {
    // The per-region headings (Alignment, Canal Diameter) are Findings content
    // even though no heading literally says FINDINGS. A rule keyed on the word
    // "Findings" alone would refuse every spine and MRI study in the clinic.
    const map = { Alignment: { text: "Normal.", normal: true }, "Canal Diameter": { text: "Normal.", normal: true } };
    const body = signed({
      findingsText: "Alignment:\nNormal.\n\nCanal Diameter:\nNormal.",
      findingsMap: map,
      useStructured: true,
    });
    expect(verdict(body)).toBe("ok");
  });

  it("refuses structured regions that are neither normal nor authored", () => {
    // buildLivePrintBodyHtml:158 renders an empty non-normal region as the "—"
    // sentinel, which the blank-line rule already refuses to read as content —
    // so this is the same document as the row above with the sentences removed.
    const body = signed({
      technique: "MRI.",
      impressionText: "Findings pending.",
      findingsMap: { Alignment: { text: "", normal: false }, "Canal Diameter": { text: "", normal: false } },
      useStructured: true,
    });
    expect(verdict(body)).toBe("incomplete:findings");
  });

  it("refuses an Impression the document rendered and left empty", () => {
    const body = `<div class="section-heading">FINDINGS</div><p>Gallstones at the fundus.</p>`
      + `<div class="section-heading">IMPRESSION</div><p></p>`;
    expect(verdict(body)).toBe("incomplete:impression");
  });

  it("refuses a body that is only the canal measurement table", () => {
    // The measurement table is what spinalCanalApTable.ts prints, and its own
    // heading says CANAL AP DIAMETER — a section a Findings rule must not read
    // as findings, because it prints dashes where the numbers were never entered.
    const body = `<div class="section-heading">LUMBAR CANAL AP DIAMETER</div>`
      + `<table><tr><td>L4</td><td>—</td></tr></table>`;
    expect(verdict(body)).toBe("incomplete:findings");
  });

  it("still calls a wholly blank builder output empty, not incomplete", () => {
    // "empty" is the stronger statement and the older code path; the new rule
    // must not relabel it.
    expect(verdict(signed({}))).toBe("empty");
  });

  it("lets an unresolved token name its own fix first", () => {
    const body = `<div class="section-heading">FINDINGS</div><p>A {size} calculus.</p>`;
    expect(verdict(body)).toBe("placeholder");
  });
});

describe("the section rule does not fire on prose the builders never structured", () => {
  it("signs a free-text report with no section markers at all", () => {
    // RadiologyReportGenerator pastes dictated paragraphs; Report Hub edits a
    // body someone typed. Neither has headings, so neither has an empty section.
    expect(verdict("<p>No acute intracranial abnormality. No midline shift.</p>")).toBe("ok");
    expect(signedReportSectionsOf("<p>No acute intracranial abnormality.</p>").documentHasSections).toBe(false);
  });

  it("keeps a bolded paragraph word from creating a section nobody wrote", () => {
    // Report Hub's editor bolds a section word rather than using a heading, so
    // this body has neither a heading element nor a `Label:` colon: nothing
    // declares a Findings section, and the rule's structural gate is what keeps
    // a free-text report signable when its only labelled line is a technique.
    const body = `<p><strong>TECHNIQUE</strong></p><p>MRI without contrast.</p>`;
    expect(signedReportSectionsOf(body).documentHasSections).toBe(false);
    expect(verdict(body)).toBe("ok");
  });

  it("signs a negative finding: Findings: None", () => {
    expect(verdict("<p>Findings: None</p>")).toBe("ok");
  });

  it("signs a one-line study whose first sentence has no full stop", () => {
    // The shape that makes an unstructured line look like a bare heading once
    // the tags are gone. With no structural evidence the rule stays closed.
    expect(verdict("<p>See the ultrasound report</p>")).toBe("ok");
  });

  it("judges the preview sentinel as an empty Findings, not as content", () => {
    // radiologyReportPreviewHtml.ts:289 writes this sentence itself when the
    // field is blank. Counting it as authored text is how a blank report signed.
    const body = "<h3>FINDINGS / OBSERVATION</h3><p><em>No findings entered.</em></p>"
      + "<h3>IMPRESSION</h3><p>Cholelithiasis.</p>";
    expect(verdict(body)).toBe("incomplete:findings");
  });

  it("reports nothing for a body that is not a string at all", () => {
    const sections = signedReportSectionsOf(null);
    expect(sections.empty).toEqual([]);
    expect(sections.documentHasSections).toBe(false);
  });
});

/**
 * What separates the rule from a keyword scan: only a HEADING can name a
 * section. Both cases below were measured as live failures when the classifier
 * decided from the flattened text instead of the markup.
 */
describe("a heading delimits a section; prose never does", () => {
  it("signs findings prose that mentions the canal measurement", () => {
    // The V7 shape: Generate wrote the paragraph, and the sentence names the
    // measurement in ordinary English. Read as a `CANAL AP DIAMETER` heading it
    // would close the Findings section and the report — finished, with an
    // Impression — would be refused as having empty Findings.
    const body = `<div class="section-heading">Findings</div>`
      + `<p>Canal AP diameter is 8.5 mm at L4-L5, measured after the report was written.</p>`
      + `<div class="section-heading">Impression</div><p>Mild canal stenosis at L4-L5.</p>`;
    expect(verdict(body)).toBe("ok");
  });

  it("does not let a document title stand in for Findings", () => {
    // The Command Center drew `<h3>Radiology Report: MRI Brain</h3>` above every
    // report. Absorbed as findings content it is the reason an unfilled report
    // used to reach a signature; kept as a heading the same body refuses.
    const body = `<h3>Radiology Report: MRI Brain</h3>`
      + `<p><strong>Clinical History:</strong> Seizure disorder, on follow-up.</p>`
      + `<h4>Findings</h4><p></p>`;
    expect(verdict(body)).toBe("incomplete:findings");
  });

  it("keeps a heading's own second line out of Findings", () => {
    // A `<br/>` inside a heading splits it once the markup is flattened, and the
    // tail would otherwise land as an authored findings line — which is how the
    // document would then read as having findings at all.
    const body = `<h3>Alignment<br/>Normal Disc Heights On The Sagittal Series</h3>`
      + `<p><strong>Clinical History:</strong> Low back pain.</p>`
      + `<h4>Findings</h4><p></p>`;
    expect(verdict(body)).toBe("incomplete:findings");
  });

  it("does not let a measured canal table stand in for Findings", () => {
    // The title comes from the shipped column plan, and the markup is
    // spinalCanalApTable.ts:153-157's own layout. Every title that plan emits
    // carries `CANAL AP DIAMETER`, which is what marks the grid as measurement
    // data rather than a findings region: a report whose Findings is only the
    // machine's numbers says nothing about what the examination showed.
    const plan = canalPrintPlan(["L1-L2", "L4-L5"]);
    expect(plan, "the shipped column plan returned nothing for two lumbar levels").not.toBeNull();
    expect(plan!.title).toContain("CANAL AP DIAMETER");
    const grid = `<div class="section-heading">${plan!.title}</div>`
      + `<table><thead><tr><th>LEVEL</th>${plan!.levels.map((l: string) => `<th>${l}</th>`).join("")}</tr></thead>`
      + `<tbody><tr><td>AP (mm)</td>${plan!.levels.map((l: string) => `<td>${l === "L4-L5" ? "9.7" : "16.0"}</td>`).join("")}</tr></tbody></table>`;
    expect(verdict(`<h4>Findings</h4>${grid}<div class="section-heading">IMPRESSION</div><p>Canal stenosis at L4-L5.</p>`))
      .toBe("incomplete:findings");
    // And the same table under a real findings paragraph is an ordinary report.
    expect(verdict(`<h4>Findings</h4><p>Moderate disc height loss. ${grid}</p>`
      + `<div class="section-heading">IMPRESSION</div><p>Canal stenosis at L4-L5.</p>`)).toBe("ok");
  });
});

/**
 * The two tables that turn a heading into a section, checked against each other.
 *
 * `storedReportBody.ts:33-53` is how the reporting screen reads a stored body
 * back into its Findings/Impression boxes; `signedReportContentGuard.ts:264-290`
 * is how the signing door reads the same column. They are separate tables
 * because the door cannot import SPA source, and nothing in the runtime keeps
 * them in step — so a label the screen files under Findings but the door
 * neutralises is content the radiologist sees in the box and the door counts as
 * nothing, which refuses a finished report. Both normalisers
 * (`storedReportBody.ts:61`, `signedReportContentGuard.ts:316`) are the same
 * uppercase/single-space/strip-trailing-punctuation function, so the keys are
 * directly comparable here.
 */
describe("the door's section table matches the screen's", () => {
  const clinicalOfClient = Object.entries(LABEL_TO_SECTION)
    .filter(([, section]) => section === "findings" || section === "impression");

  it.each(clinicalOfClient)(
    "the door also reads %s as %s",
    (label, section) => {
      // 8 labels, and the assertion is non-degenerate: SECTION_LABELS answers
      // "other" for the nine labels the screen treats as non-clinical, so a
      // misfiling is a real difference rather than an undefined-vs-undefined
      // comparison.
      expect(SECTION_LABELS[label]).toBe(section);
    }
  );

  it("keeps a synonym heading out of the Findings region", () => {
    // The door knows three clinical spellings the screen does not: OPINION,
    // OBSERVATION and the stitched "Findings / Observation" the preview and the
    // generator write (radiologyReportPreviewHtml.ts:371,
    // radiology-report-generator.ts:1230). OPINION is the one that changes a
    // verdict — an unknown heading falls into the findings region, so an
    // Opinion-only report would read as having findings. It must not.
    const body = `<h4>Findings</h4><p></p><h4>Opinion</h4><p>Tendinopathy of the supraspinatus.</p>`;
    expect(verdict(body)).toBe("incomplete:findings");
    // While the same Opinion line under real findings is an ordinary report.
    expect(verdict(`<h4>Findings</h4><p>Tendinopathy of the supraspinatus.</p>`
      + `<h4>Opinion</h4><p>No tear.</p>`)).toBe("ok");
  });
});
