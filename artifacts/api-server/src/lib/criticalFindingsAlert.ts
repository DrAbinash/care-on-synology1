/**
 * criticalFindingsAlert.ts
 * Phase 2 — Critical findings alert system.
 * Flags critical findings and tracks clinician notification + acknowledgment.
 */
import { db } from "@workspace/db";
import {
  radiologyCriticalFindingsTable,
  radiologyStudiesTable,
} from "@workspace/db/schema";
import { eq, desc, isNull } from "drizzle-orm";

export type CriticalFindingInput = {
  studyId: number;
  finding: string;
  severity: "critical" | "urgent" | "significant";
  category?: string;
};

export async function flagCriticalFinding(input: CriticalFindingInput): Promise<typeof radiologyCriticalFindingsTable.$inferSelect> {
  const [row] = await db
    .insert(radiologyCriticalFindingsTable)
    .values({
      studyId: input.studyId,
      finding: input.finding,
      severity: input.severity,
      category: input.category ?? null,
    })
    .returning();
  return row;
}

export async function notifyClinician(
  findingId: number,
  clinicianName: string,
  method: string,
): Promise<void> {
  await db
    .update(radiologyCriticalFindingsTable)
    .set({ notifiedClinician: clinicianName, notifiedAt: new Date(), notificationMethod: method })
    .where(eq(radiologyCriticalFindingsTable.id, findingId));
}

export async function acknowledgeFinding(findingId: number, clinicianName: string): Promise<void> {
  await db
    .update(radiologyCriticalFindingsTable)
    .set({ acknowledgedBy: clinicianName, acknowledgedAt: new Date() })
    .where(eq(radiologyCriticalFindingsTable.id, findingId));
}

export async function getCriticalFindingsForStudy(studyId: number): Promise<typeof radiologyCriticalFindingsTable.$inferSelect[]> {
  return db
    .select()
    .from(radiologyCriticalFindingsTable)
    .where(eq(radiologyCriticalFindingsTable.studyId, studyId))
    .orderBy(desc(radiologyCriticalFindingsTable.createdAt));
}

export async function getUnacknowledgedFindings(): Promise<typeof radiologyCriticalFindingsTable.$inferSelect[]> {
  return db
    .select()
    .from(radiologyCriticalFindingsTable)
    .where(isNull(radiologyCriticalFindingsTable.acknowledgedAt))
    .orderBy(desc(radiologyCriticalFindingsTable.createdAt));
}

// Auto-detect critical keywords in report text
const CRITICAL_KEYWORDS: { keyword: string; severity: "critical" | "urgent"; category: string }[] = [
  { keyword: "acute hemorrhage", severity: "critical", category: "hemorrhage" },
  { keyword: "intracranial hemorrhage", severity: "critical", category: "hemorrhage" },
  { keyword: "subarachnoid hemorrhage", severity: "critical", category: "hemorrhage" },
  { keyword: "pneumothorax", severity: "critical", category: "pneumothorax" },
  { keyword: "tension pneumothorax", severity: "critical", category: "pneumothorax" },
  { keyword: "aortic dissection", severity: "critical", category: "vascular" },
  { keyword: "ruptured", severity: "critical", category: "trauma" },
  { keyword: "herniation", severity: "critical", category: "brain" },
  { keyword: "midline shift", severity: "urgent", category: "brain" },
  { keyword: "pulmonary embolism", severity: "critical", category: "vascular" },
];

export function scanForCriticalFindings(reportText: string): CriticalFindingInput[] {
  const text = reportText.toLowerCase();
  const findings: CriticalFindingInput[] = [];
  for (const ck of CRITICAL_KEYWORDS) {
    if (text.includes(ck.keyword)) {
      findings.push({
        studyId: 0, // caller must set
        finding: ck.keyword,
        severity: ck.severity,
        category: ck.category,
      });
    }
  }
  return findings;
}
