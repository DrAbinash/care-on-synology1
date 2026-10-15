/**
 * The human-readable C3 metadata audit, for `pnpm audit:anatomy`.
 *
 * It is a test file only because the catalogue modules it reads live behind the
 * ERP's `@/` path aliases, and vitest is how this repository resolves them —
 * which is also how `pnpm preview:reports` works. Nothing here asserts anything
 * about clinical quality; the assertions live in `anatomyMetadataAudit.test.ts`.
 * The report is skipped unless the CLI asks for it, so it never adds noise to CI.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { auditClinicalMetadata, buildCoverageBaseline, measureOrderingFeasibility } from "./anatomyMetadataAudit";
import { renderAuditReport } from "./auditReportRenderer";
import { loadAuditInput, REPO_ROOT } from "./auditDataSources";

const OUT_DIR = path.join(REPO_ROOT, "tmp", "clinical-metadata-audit");
const revision = process.env.C3_SOURCE_REVISION ?? "(revision unknown)";

describe.runIf(process.env.C3_AUDIT_REPORT === "1")("C3 metadata audit report", () => {
  it("renders and writes the report for the readiness review", () => {
    const result = auditClinicalMetadata(loadAuditInput());
    const feasibility = measureOrderingFeasibility(result);
    const markdown = renderAuditReport(result, feasibility, {
      revision, generatedBy: "pnpm audit:anatomy",
    });
    // A report that rendered nothing would be indistinguishable from one that
    // found nothing, so the section list is checked before anything is written.
    for (const section of ["## 1. Inventory", "## 2. Can observations be ordered",
      "## 3. Coverage by examination", "## 4. Owned baseline manifests",
      "## 5. Seeded database rows", "## 6. What the audit found"]) {
      expect(markdown, `report is missing ${section}`).toContain(section);
    }
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path.join(OUT_DIR, "audit.md"), markdown, "utf8");
    writeFileSync(path.join(OUT_DIR, "coverage.json"),
      JSON.stringify(buildCoverageBaseline(result, { revision }), null, 2) + "\n", "utf8");
    console.log(markdown);
    console.log(`\nwritten: ${path.join(OUT_DIR, "audit.md")}`);
    console.log(`written: ${path.join(OUT_DIR, "coverage.json")}`);
  });
});
