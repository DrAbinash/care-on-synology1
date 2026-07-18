/**
 * AI isolation guard (P3 patch) — a static invariant test.
 *
 * Enforces the hard boundary: the AI subsystem may NEVER write the human report,
 * the working draft store, amendments, or the signature. Accepted AI content
 * reaches the report only through the radiologist's editor + the existing draft/
 * finalize workflow. This test scans the AI source and fails if any forbidden
 * write pattern appears — a durable architectural guard, no DB required.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

function aiSourceFiles(): string[] {
  const dir = here; // artifacts/api-server/src/lib/ai
  const local = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(dir, f));
  const route = path.join(here, "..", "..", "routes", "aiClinical.ts");
  return [...local, route];
}

// Forbidden WRITE patterns (reads like `isFinalized` are fine).
const FORBIDDEN: Array<{ re: RegExp; why: string }> = [
  { re: /\.insert\(\s*patientReportsTable/, why: "AI must not create patient_reports" },
  { re: /\.update\(\s*patientReportsTable/, why: "AI must not modify patient_reports" },
  { re: /\.delete\(\s*patientReportsTable/, why: "AI must not delete patient_reports" },
  { re: /patientReportAmendmentsTable/, why: "amendments must remain human-controlled" },
  { re: /\.insert\(\s*radiologyReportDraftsTable/, why: "AI must not write the human working draft server-side" },
  { re: /\.update\(\s*radiologyReportDraftsTable/, why: "AI must not modify the human working draft server-side" },
  { re: /signaturesTable|\/sign\b|signReport|finalizeReport|finalReportId/, why: "no AI-specific signing/finalize path" },
];

describe("AI isolation guard (P3 patch)", () => {
  const files = aiSourceFiles();

  it("scans a non-empty set of AI source files", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("no AI module writes patient_reports, the human draft, amendments, or signs", () => {
    const violations: string[] = [];
    for (const file of files) {
      let src: string;
      try { src = readFileSync(file, "utf8"); } catch { continue; }
      for (const { re, why } of FORBIDDEN) {
        if (re.test(src)) violations.push(`${path.basename(file)}: ${why} (matched ${re})`);
      }
    }
    expect(violations).toEqual([]);
  });
});
