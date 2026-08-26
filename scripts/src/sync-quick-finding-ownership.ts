/**
 * Sync DEFAULT_QUICK_SELECT_TILES ownership onto clinic radiology_quick_findings
 * rows matched by (studyType, label). Fills empty conflict_group / anatomical_section
 * / baseline_replaces only — never overwrites non-empty values.
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   pnpm --filter @workspace/scripts run sync:quick-finding-ownership
 *   pnpm --filter @workspace/scripts run sync:quick-finding-ownership -- --apply
 */
import "dotenv/config";
import { DEFAULT_QUICK_SELECT_TILES } from "../../artifacts/diagnostic-erp/src/lib/zai-workspace/quick-select-library";

export type OwnershipFill = {
  studyType: string;
  label: string;
  conflictGroup: string;
  anatomicalSection: string;
  baselineReplaces: string;
};

export type ExistingQuickFindingRow = {
  id: number;
  studyType: string;
  label: string;
  conflictGroup: string;
  anatomicalSection: string;
  baselineReplaces: string;
};

export function referenceOwnershipFills(): OwnershipFill[] {
  return DEFAULT_QUICK_SELECT_TILES
    .filter((t) => t.field === "findings" || t.category === "critical")
    .map((t) => ({
      studyType: t.scopeBodyPart || "",
      label: t.label,
      conflictGroup: t.conflictGroup ?? "",
      anatomicalSection: t.anatomicalSection ?? "",
      baselineReplaces: t.baselineReplaces ?? "",
    }))
    .filter((r) => r.studyType && r.label && (r.conflictGroup || r.anatomicalSection || r.baselineReplaces));
}

export function pendingOwnershipFills(
  existing: ExistingQuickFindingRow[],
  reference = referenceOwnershipFills(),
): Array<ExistingQuickFindingRow & { patch: Partial<OwnershipFill> }> {
  const ref = new Map(reference.map((r) => [`${r.studyType}::${r.label}`.toLowerCase(), r]));
  const out: Array<ExistingQuickFindingRow & { patch: Partial<OwnershipFill> }> = [];
  for (const row of existing) {
    const hit = ref.get(`${row.studyType}::${row.label}`.toLowerCase());
    if (!hit) continue;
    const patch: Partial<OwnershipFill> = {};
    if (!(row.conflictGroup ?? "").trim() && hit.conflictGroup) patch.conflictGroup = hit.conflictGroup;
    if (!(row.anatomicalSection ?? "").trim() && hit.anatomicalSection) patch.anatomicalSection = hit.anatomicalSection;
    if (!(row.baselineReplaces ?? "").trim() && hit.baselineReplaces) patch.baselineReplaces = hit.baselineReplaces;
    if (Object.keys(patch).length > 0) out.push({ ...row, patch });
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { db } = await import("@workspace/db");
  const { radiologyQuickFindingsTable } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db.select({
    id: radiologyQuickFindingsTable.id,
    studyType: radiologyQuickFindingsTable.studyType,
    label: radiologyQuickFindingsTable.label,
    conflictGroup: radiologyQuickFindingsTable.conflictGroup,
    anatomicalSection: radiologyQuickFindingsTable.anatomicalSection,
    baselineReplaces: radiologyQuickFindingsTable.baselineReplaces,
  }).from(radiologyQuickFindingsTable);
  const pending = pendingOwnershipFills(rows);
  console.log(`Reference fills: ${referenceOwnershipFills().length}`);
  console.log(`Pending row updates: ${pending.length}`);
  for (const p of pending) {
    console.log(`  ${p.studyType} / ${p.label}: ${JSON.stringify(p.patch)}`);
  }
  if (!apply) {
    console.log("Dry-run only. Re-run with --apply to write.");
    return;
  }
  for (const p of pending) {
    await db.update(radiologyQuickFindingsTable).set(p.patch).where(eq(radiologyQuickFindingsTable.id, p.id));
  }
  console.log(`Applied ${pending.length} update(s).`);
}

const isMain = /sync-quick-finding-ownership\.ts$/.test(process.argv[1] ?? "");
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
