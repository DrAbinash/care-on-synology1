/**
 * aiAuditDisplay.test.ts — the reading of an AI audit row, tested without a
 * browser, plus the wiring that was the actual defect.
 *
 * Measured gap at `origin/main c199aea2`: `GET /api/ai-reporting/audit-log`
 * `select()`s every column, so `endpointLocality`, `imageSourceTypes`,
 * `jobReference` and `correlationId` were already written (PR-A / #1076 / #1078)
 * and already served — and `AiAuditLog.tsx` declared none of them in its row
 * type and rendered none. The evidence existed and could not be looked at, which
 * is how a clinic ends up re-running a send to find out where it went.
 *
 * The rules worth pinning are the ones where a plausible-looking table would
 * lie: an absent locality must not read as local, a source list shorter than the
 * image count must not read as cleared, and a source token the gate does not
 * recognise must not be treated as operator-supplied.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditRowSearchText,
  egressModeView,
  imageSourcesView,
  jobReferenceView,
  localityView,
} from "./aiAuditDisplay";

const pkgRoot = resolve(__dirname, "..", "..");
const page = readFileSync(resolve(pkgRoot, "src/pages/AiAuditLog.tsx"), "utf8");

describe("localityView — the stored classification, never a guess", () => {
  it("renders the three stored values", () => {
    expect(localityView("local").label).toBe("LOCAL");
    expect(localityView("cloud").label).toBe("CLOUD");
    expect(localityView("unknown").label).toBe("LOCALITY UNKNOWN");
  });

  it("treats casing and whitespace as the same value it already is", () => {
    expect(localityView("  LOCAL ").label).toBe("LOCAL");
    expect(localityView("Cloud").label).toBe("CLOUD");
  });

  it("never turns a missing value into LOCAL, and says why", () => {
    for (const raw of [null, undefined, "", "   ", "mis-typed"]) {
      const view = localityView(raw);
      expect(view.label).toBe("LOCALITY UNKNOWN");
      expect(view.tone).toBe("unknown");
      expect(view.note).toContain("not proof");
    }
  });

  it("distinguishes an explicit unknown from a column that was never written", () => {
    expect(localityView("unknown").note).toContain("No endpoint was resolved");
    expect(localityView(null).note).toContain("no locality at all");
  });
});

describe("egressModeView — TEXT-ONLY vs VISION from the pixel count", () => {
  it("separates a text send from a vision send", () => {
    expect(egressModeView(0).label).toBe("TEXT-ONLY");
    expect(egressModeView(1).label).toBe("VISION");
    expect(egressModeView(4).note).toBe("4 image(s) were sent with this request.");
  });

  it("reads a missing count as no pixels, not as an unknown mode", () => {
    expect(egressModeView(null).label).toBe("TEXT-ONLY");
    expect(egressModeView(undefined).label).toBe("TEXT-ONLY");
  });
});

describe("imageSourcesView — provenance read the way the egress gate reads it", () => {
  it("asks no provenance question about a text-only row", () => {
    const view = imageSourcesView(null, 0);
    expect(view.badges).toEqual([]);
    expect(view.unverified).toBe(false);
    expect(view.patientDerived).toBe(false);
  });

  it("flags a row that lists sources while reporting no images", () => {
    const view = imageSourcesView("DICOM,DICOM", 0);
    expect(view.unverified).toBe(true);
    expect(view.badges[0].label).toBe("SOURCE LIST WITHOUT IMAGES");
  });

  it("treats a send with no recorded source as unverified and patient-derived", () => {
    const view = imageSourcesView(null, 2);
    expect(view.unverified).toBe(true);
    expect(view.patientDerived).toBe(true);
    expect(view.badges[0].label).toBe("PROVENANCE UNVERIFIED");
    expect(view.badges[0].note).toContain("says nothing about where they came from");
  });

  it("treats a source list shorter than the images sent as unverified, naming both counts", () => {
    const view = imageSourcesView("DICOM,DICOM", 4);
    expect(view.unverified).toBe(true);
    expect(view.badges[0].note).toBe(
      "4 image(s) were sent but only 2 source(s) are recorded, so the remaining images are unaccounted for.",
    );
  });

  it("renders one badge per recorded image, in the order stored", () => {
    const view = imageSourcesView("DICOM,OPERATOR_SUPPLIED", 2);
    expect(view.unverified).toBe(false);
    expect(view.patientDerived).toBe(true);
    expect(view.badges.map((b) => b.label)).toEqual(["DICOM", "OPERATOR-SUPPLIED"]);
    expect(view.badges.map((b) => b.tone)).toEqual(["patient", "ok"]);
  });

  it("collapses repeats so four identical images do not print four chips", () => {
    const view = imageSourcesView("DICOM,DICOM,DICOM,DICOM", 4);
    expect(view.badges).toHaveLength(1);
    expect(view.badges[0].label).toBe("DICOM ×4");
  });

  it("keeps an unrecognised token verbatim instead of inventing a meaning", () => {
    const view = imageSourcesView("BROWSER_BYTES", 1);
    expect(view.patientDerived).toBe(true);
    expect(view.badges[0].label).toBe("BROWSER_BYTES");
    expect(view.badges[0].tone).toBe("unknown");
  });

  it("only clears the exact OPERATOR_SUPPLIED label, matching the gate", () => {
    // `cloudImagePolicy` compares against the constant, so a lower-cased value is
    // patient-derived for policy purposes. A table that relaxed it here would show
    // a send as cleared that the gate refused.
    expect(imageSourcesView("operator_supplied", 1).patientDerived).toBe(true);
    expect(imageSourcesView("OPERATOR_SUPPLIED", 1).patientDerived).toBe(false);
    expect(imageSourcesView("dicom", 1).badges[0].label).toBe("DICOM");
  });
});

describe("jobReferenceView — trace pointers as production actually writes them", () => {
  it("labels the three prefixes in use and keeps the id separate", () => {
    expect(jobReferenceView("compose_job:42")).toEqual({ label: "Composer job", value: "42", present: true });
    expect(jobReferenceView("ai_shadow_job:7")).toEqual({ label: "Shadow draft job", value: "7", present: true });
    expect(jobReferenceView("ai_self_test:2026-10-20T00:00:00Z")).toEqual({
      label: "AI pipeline self-test", value: "2026-10-20T00:00:00Z", present: true,
    });
  });

  it("leaves the id empty when the reference has none, so the label is not repeated", () => {
    expect(jobReferenceView("ai_self_test")).toEqual({ label: "AI pipeline self-test", value: "", present: true });
  });

  it("shows an unrecognised reference verbatim rather than borrowing a label", () => {
    const view = jobReferenceView("shadow_job:9");
    expect(view.label).toBe("Reference (unrecognised)");
    expect(view.value).toBe("shadow_job:9");
  });

  it("says plainly when there is nothing to trace by", () => {
    for (const raw of [null, undefined, ""]) {
      expect(jobReferenceView(raw)).toEqual({ label: "No job reference", value: "", present: false });
    }
  });
});

describe("auditRowSearchText", () => {
  it("searches the four newly surfaced columns, not only the old ones", () => {
    const text = auditRowSearchText({
      provider: "ollama",
      endpointLocality: "cloud",
      jobReference: "compose_job:42",
      correlationId: "corr-7",
    });
    for (const needle of ["ollama", "cloud", "compose_job:42", "corr-7"]) {
      expect(text).toContain(needle);
    }
  });
});

describe("AiAuditLog renders what the API already serves", () => {
  // The defect was a page whose row type omitted four served columns. These two
  // assertions are the ones that were red before this change; the pure helpers
  // above would have passed on their own while the page still showed nothing.
  it("declares the columns in its row type", () => {
    for (const field of ["endpointLocality", "imageSourceTypes", "jobReference", "correlationId"]) {
      expect(page).toContain(field);
    }
  });

  it("passes each row through the display module instead of re-deciding inline", () => {
    expect(page).toContain('from "@/lib/aiAuditDisplay"');
    expect(page).toContain("localityView(");
    expect(page).toContain("egressModeView(");
    expect(page).toContain("imageSourcesView(");
    expect(page).toContain("jobReferenceView(");
    expect(page).toContain("correlationId");
  });
});

/**
 * Every writer into `ai_reporting_audit_logs` names itself, because the table
 * holds two different events under one `success` column and the only thing that
 * tells them apart is the reference. The interactive routes and the comparison
 * arms started writing references in the audit-correctness pass; if a label is
 * missing here the page falls back to "Reference (unrecognised)", which reads to
 * a radiologist like a defect in the data rather than a new writer.
 */
describe("jobReferenceView — every writer in the table has a name", () => {
  it.each([
    ["ai_query", "AI query answer"],
    ["ai_polish", "AI language polish"],
    ["ai_image_review", "AI image review"],
    ["ai_compare", "AI report comparison"],
    ["ai_comparison_run:0", "Model comparison, arm"],
    ["ai_comparison_winner", "Answer the clinician kept (not a generation)"],
  ])("labels %s as %j", (raw, label) => {
    const view = jobReferenceView(raw);
    expect(view.present).toBe(true);
    expect(view.label).toBe(label);
  });

  it("carries the arm number so two arms of one run are not the same string", () => {
    expect(jobReferenceView("ai_comparison_run:1").value).toBe("1");
    expect(jobReferenceView("ai_comparison_run:0").value).toBe("0");
  });

  it("kept its original answers", () => {
    expect(jobReferenceView("compose_job:17").label).toBe("Composer job");
    expect(jobReferenceView("compose_job:17").value).toBe("17");
    expect(jobReferenceView("ai_self_test").label).toBe("AI pipeline self-test");
    expect(jobReferenceView(null).present).toBe(false);
    expect(jobReferenceView("something_new").label).toBe("Reference (unrecognised)");
    expect(jobReferenceView("something_new").value).toBe("something_new");
  });
});
