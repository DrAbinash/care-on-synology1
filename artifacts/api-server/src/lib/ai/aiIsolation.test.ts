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

function tsFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesRecursive(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function aiSourceFiles(): string[] {
  // artifacts/api-server/src/lib/ai (+ the P4 interop/ subdir) + AI routes.
  const local = tsFilesRecursive(here);
  const routes = ["aiClinical.ts", "aiInterop.ts"].map((r) => path.join(here, "..", "..", "routes", r));
  return [...local, ...routes];
}

// Forbidden WRITE patterns (reads like `isFinalized` are fine). Two layers:
// (1) Drizzle variable-name writes; (2) raw-SQL against the PHYSICAL table names
// — so an aliased import (`patientReportsTable as pr`) or a `db.execute(sql\`…\`)`
// cannot evade the guard for the P0–P4 AI subsystem it scans.
const FORBIDDEN: Array<{ re: RegExp; why: string }> = [
  { re: /\.insert\(\s*patientReportsTable/, why: "AI must not create patient_reports" },
  { re: /\.update\(\s*patientReportsTable/, why: "AI must not modify patient_reports" },
  { re: /\.delete\(\s*patientReportsTable/, why: "AI must not delete patient_reports" },
  { re: /patientReportAmendmentsTable/, why: "amendments must remain human-controlled" },
  { re: /\.insert\(\s*radiologyReportDraftsTable/, why: "AI must not write the human working draft server-side" },
  { re: /\.update\(\s*radiologyReportDraftsTable/, why: "AI must not modify the human working draft server-side" },
  { re: /\.delete\(\s*radiologyReportDraftsTable/, why: "AI must not delete the human working draft server-side" },
  { re: /signaturesTable|\/sign\b|signReport|finalizeReport|finalReportId/, why: "no AI-specific signing/finalize path" },
  // Raw-SQL evasion — INSERT/UPDATE/DELETE against the physical table names.
  { re: /insert\s+into\s+"?patient_reports\b/i, why: "AI must not INSERT patient_reports (raw SQL)" },
  { re: /update\s+"?patient_reports"?\s+set/i, why: "AI must not UPDATE patient_reports (raw SQL)" },
  { re: /delete\s+from\s+"?patient_reports\b/i, why: "AI must not DELETE patient_reports (raw SQL)" },
  { re: /(insert\s+into|update|delete\s+from)\s+"?radiology_report_drafts\b/i, why: "AI must not write the human draft (raw SQL)" },
  { re: /(insert\s+into|update|delete\s+from)\s+"?patient_report_amendments\b/i, why: "amendments must remain human-controlled (raw SQL)" },
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
