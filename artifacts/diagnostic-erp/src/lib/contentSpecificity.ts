/**
 * Content specificity ranking — reuse ReportingStudyContext + protocolScope.
 * Family → Region → Study → Protocol/Sub-technique.
 * Used for availability/ranking and merge resolution, not blind paste.
 */

import type { ReportFormat } from "./zai-workspace/types";
import { familyFromRegion, type ReportingFamily } from "./reportingStudyContext";
import { protocolScopeMatches, type FormatLookupExtras } from "./zai-workspace/fullReportFormat";
import type { ObservationSpecificity } from "./observationSlot";

export function isScreeningFormat(format: Pick<ReportFormat, "name" | "protocolScope" | "reportTitle" | "diagnosisTags">): boolean {
  const hay = `${format.protocolScope ?? ""} ${format.name} ${format.reportTitle ?? ""} ${(format.diagnosisTags ?? []).join(" ")}`;
  return /\bscreening\b/i.test(hay);
}

export function formatSpecificity(format: Pick<ReportFormat, "name" | "bodyPart" | "protocolScope" | "reportTitle">): ObservationSpecificity {
  if ((format.protocolScope ?? "").trim()) return "protocol";
  if (/\bmri\b|\bct\b|\bxr\b|\bus\b/i.test(format.name)) return "study";
  if ((format.bodyPart ?? "").trim()) return "region";
  return "family";
}

export function specificityRank(spec: ObservationSpecificity): number {
  if (spec === "protocol") return 4;
  if (spec === "study") return 3;
  if (spec === "region") return 2;
  return 1;
}

export function familyOfFormat(format: Pick<ReportFormat, "bodyPart">): ReportingFamily {
  return familyFromRegion(format.bodyPart);
}

/** Higher = more specific to the open study. Protocol match beats region. */
export function contentSpecificityScore(
  format: Pick<ReportFormat, "bodyPart" | "protocolScope" | "name" | "reportTitle">,
  extras?: FormatLookupExtras,
): number {
  let score = specificityRank(formatSpecificity(format)) * 100;
  const hay = `${extras?.protocolName ?? ""} ${extras?.studyDescription ?? ""}`.trim();
  if (hay && protocolScopeMatches(format.protocolScope, hay)) score += 1000;
  if (hay && format.bodyPart && hay.toLowerCase().includes(format.bodyPart.toLowerCase())) score += 50;
  return score;
}

export function findingsRegionOrder(region: string): number {
  const r = region.toLowerCase();
  if (r.includes("ls spine") || r.includes("lumbar") || r.includes("lumbosacral")) return 0;
  if (r.includes("cervical")) return 1;
  if (r.includes("dorsal") || r.includes("thoracic")) return 2;
  if (r.includes("whole")) return 3;
  if (r.includes("brain")) return 4;
  return 10;
}
