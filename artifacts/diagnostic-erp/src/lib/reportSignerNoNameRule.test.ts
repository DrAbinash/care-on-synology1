/**
 * PP-5A ratchet — no name on the signing pathway decides who signs.
 *
 * `reportSignerEligibility.ts` owns the rule and its own tests prove what the
 * rule does. This file pins the other half, which those tests cannot see: that
 * the pathways actually ask that module, and that no surface has grown back a
 * regular expression over a person's NAME to pick a signer. A ratchet of this
 * kind is only worth having because the alternative is silent — a name rule
 * reappearing in a hook reads as working code until a second radiologist joins
 * the clinic and every report they sign prints somebody else's name.
 *
 * Read as text, deliberately: these are React hooks and a component, and the
 * assertion is about which module decides, not about behaviour the unit suites
 * already cover.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Normalized so a CRLF checkout (core.autocrlf on Windows) cannot empty the read. */
function source(...segments: string[]): string {
  // Sibling of this file's directory: `src/lib/` → `src/<the pathway's files>`.
  return readFileSync(fileURLToPath(new URL(`../${segments.join("/")}`, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n");
}

const FILES = {
  dialog: "components/radiology/FinalizeSignDialog.tsx",
  finalizeHook: "hooks/radiology-workspace/useStudyFinalize.ts",
  lifecycle: "lib/radiologyReportLifecycle.ts",
  exportHook: "hooks/radiology-workspace/useWorkspaceExportShare.ts",
  pdfDoor: "lib/reportPdfGenerator.ts",
  eligibility: "lib/reportSignerEligibility.ts",
};

/**
 * A person's name used as a selection predicate.
 *
 * `reportPdfGenerator.ts` is scanned too now that #1085 has merged: it used to
 * rewrite the saved signature block whenever the name matched a particular
 * person, which is precisely the rule this pattern is written to catch. What
 * remains there is a default name for a browser that has configured nothing —
 * a starting value, not a predicate, and never the authority on a report that
 * has a signing record behind it.
 */
const NAME_RULE = /\/sugandha\/i|\/abinash\/i|name\s*===?\s*["']Dr\./i;
const SIGNED_PATHWAY = ["dialog", "finalizeHook", "lifecycle", "exportHook", "pdfDoor", "eligibility"] as const;

describe("the signer is chosen from records, never from a name", () => {
  it("no file on the signing pathway matches a signer by name", () => {
    for (const label of SIGNED_PATHWAY) {
      const text = source(FILES[label]);
      expect(NAME_RULE.test(text), `${label} still contains a name-based signer rule`).toBe(false);
    }
  });

  it("the dialog and the finalize hook both ask the eligibility module", () => {
    // Not a style preference: a pathway that reads `/api/signatures` directly
    // gets the retired blocks the admin screen needs, and would offer a
    // signature that must not authorize anything.
    expect(source(FILES.finalizeHook)).toContain("eligibleSigners(");
    expect(source(FILES.lifecycle)).toContain("resolveSignerChoice(");
  });

  it("the exported PDF takes its signer from the record, not from this browser", () => {
    const exported = source(FILES.exportHook);
    expect(exported).toContain("loadSignerOfRecord(");
    expect(exported).toContain("signerOfRecord,");
    expect(exported).toContain("unsigned,");
    // The door itself honours both fields rather than only the settings block.
    const door = source(FILES.pdfDoor);
    expect(door).toContain("report.signerOfRecord");
    expect(door).toContain("NOT SIGNED");
  });

  it("the remembered signer is honoured only while it stays eligible", () => {
    // sessionStorage is a convenience, so it is validated against the pool
    // rather than trusted because it was typed in here before. Pinned as the
    // check AND its use: an eligibility test computed and then ignored is the
    // same defect wearing a comment.
    const dialog = source(FILES.dialog);
    expect(dialog).toContain("signatures.some((s) => s.id === remembered)");
    expect(dialog).toContain('setSignerId(rememberedMatch ? String(remembered) : "");');
  });
});
