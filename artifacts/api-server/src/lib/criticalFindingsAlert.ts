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
import { and, eq, desc, isNull } from "drizzle-orm";

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

export type NotifyClinicianInput = {
  /** The clinician who was contacted about the finding. */
  clinicianName: string;
  /** phone | whatsapp | email | in_person | other. */
  method: string;
  /** Who recorded the attempt — the authenticated session identity. */
  recordedBy: string;
  note?: string;
  /** Only set true when the channel VERIFIED delivery. Phone/in-person
   *  attempts must leave this undefined (stored NULL) — recording an
   *  internal/manual event is honest; pretending delivery is not. */
  delivered?: boolean;
};

/** Record a clinician-notification attempt for a finding. Returns the
 *  updated row, or null when the finding does not exist. */
export async function notifyClinician(
  findingId: number,
  input: NotifyClinicianInput,
): Promise<typeof radiologyCriticalFindingsTable.$inferSelect | null> {
  const [row] = await db
    .update(radiologyCriticalFindingsTable)
    .set({
      notifiedClinician: input.clinicianName,
      notifiedAt: new Date(),
      notificationMethod: input.method,
      notifiedBy: input.recordedBy,
      notificationNote: input.note ?? null,
      notificationDelivered: input.delivered ?? null,
    })
    .where(eq(radiologyCriticalFindingsTable.id, findingId))
    .returning();
  return row ?? null;
}

export type AcknowledgeInput = {
  /** Authenticated session identity — never client-supplied. */
  name: string;
  role: string;
  note?: string;
};

export type AcknowledgeResult =
  | { outcome: "acknowledged"; row: typeof radiologyCriticalFindingsTable.$inferSelect }
  | { outcome: "already_acknowledged"; row: typeof radiologyCriticalFindingsTable.$inferSelect }
  | { outcome: "not_found" };

/** Idempotent acknowledge: the first acknowledgement wins and is never
 *  overwritten by a repeat click / concurrent second acknowledger. */
export async function acknowledgeFinding(
  findingId: number,
  who: AcknowledgeInput,
): Promise<AcknowledgeResult> {
  const [updated] = await db
    .update(radiologyCriticalFindingsTable)
    .set({
      acknowledgedBy: who.name,
      acknowledgedRole: who.role,
      acknowledgedNote: who.note ?? null,
      acknowledgedAt: new Date(),
    })
    .where(and(eq(radiologyCriticalFindingsTable.id, findingId), isNull(radiologyCriticalFindingsTable.acknowledgedAt)))
    .returning();
  if (updated) return { outcome: "acknowledged", row: updated };

  const [existing] = await db
    .select()
    .from(radiologyCriticalFindingsTable)
    .where(eq(radiologyCriticalFindingsTable.id, findingId))
    .limit(1);
  if (!existing) return { outcome: "not_found" };
  return { outcome: "already_acknowledged", row: existing };
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
