/**
 * Maps operations health checks to daily-summary infrastructure pulse pills.
 */
export type PulseTone = "green" | "red" | "amber" | "grey";

export type OpsCheckStatus = "PASS" | "WARNING" | "FAIL" | "SKIPPED" | "UNKNOWN";

export interface OpsCheckLike {
  id: string;
  status: OpsCheckStatus;
  message: string;
}

export interface PulseItemConfig {
  key: string;
  label: string;
  checkIds: string[];
  detailsHref?: string;
}

/**
 * Server Health Ribbon items for Clinic Systems.
 * Healthy ICICI Pay uses semantic GREEN (product name "Orange Pay" is not a status colour).
 */
export const INFRASTRUCTURE_PULSE_ITEMS: PulseItemConfig[] = [
  { key: "care_erp", label: "CARE ERP", checkIds: ["app.responding"] },
  { key: "care_db", label: "CARE DB", checkIds: ["db.connect"] },
  {
    key: "orthanc",
    label: "Orthanc/PACS",
    checkIds: ["orthanc.reachable", "orthanc.sync_fresh", "radiology.sync_worker"],
    detailsHref: "/radiology/operational-health",
  },
  { key: "backup", label: "Backup", checkIds: ["backup.age"], detailsHref: "/radiology/operational-health" },
  {
    key: "backup_verify",
    label: "Backup Verify",
    checkIds: ["backup.restore_verified"],
    detailsHref: "/radiology/operational-health",
  },
  { key: "ollama", label: "Local AI", checkIds: ["ai.ollama"], detailsHref: "/settings/radiology?tab=reporting" },
  { key: "ocr", label: "OCR", checkIds: ["integ.ocr_worker"], detailsHref: "/settings/radiology?tab=reporting" },
  {
    key: "icici",
    label: "ICICI Pay",
    checkIds: ["integ.icici_orange"],
    detailsHref: "/settings?tab=online-booking",
  },
];

const STATUS_RANK: Record<OpsCheckStatus, number> = {
  FAIL: 4,
  WARNING: 3,
  UNKNOWN: 2,
  SKIPPED: 1,
  PASS: 0,
};

export function toneFromStatuses(statuses: OpsCheckStatus[]): PulseTone {
  if (statuses.length === 0) return "grey";
  const active = statuses.filter((s) => s !== "SKIPPED");
  if (active.length === 0) return "grey";
  const worst = active.reduce((max, s) => Math.max(max, STATUS_RANK[s]), 0);
  const worstStatus = (Object.keys(STATUS_RANK) as OpsCheckStatus[]).find((k) => STATUS_RANK[k] === worst);
  if (worstStatus === "FAIL") return "red";
  if (worstStatus === "WARNING" || worstStatus === "UNKNOWN") return "amber";
  return "green";
}

export interface PulsePill {
  key: string;
  label: string;
  tone: PulseTone;
  message: string;
  detailsHref?: string;
  shouldBlink: boolean;
}

export function buildInfrastructurePulse(checks: OpsCheckLike[]): PulsePill[] {
  const byId = new Map(checks.map((c) => [c.id, c]));
  return INFRASTRUCTURE_PULSE_ITEMS.map((item) => {
    const matched = item.checkIds.map((id) => byId.get(id)).filter(Boolean) as OpsCheckLike[];
    const statuses = matched.map((m) => m.status);
    const tone = toneFromStatuses(statuses);
    const message = matched.length === 0
      ? "Check not available"
      : matched.map((m) => m.message).join(" · ");
    const shouldBlink = tone === "red" || tone === "amber";
    return {
      key: item.key,
      label: item.label,
      tone,
      message,
      detailsHref: item.detailsHref,
      shouldBlink,
    };
  });
}
