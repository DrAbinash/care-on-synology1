/**
 * DICOM Structured Report content model — Phase P4 / Gate G12 (pure).
 *
 * Builds a TID 1500 (Imaging Measurement Report) content TREE as structured JSON
 * from a finalized/structured report: measurements (NUM), findings (CODE/TEXT),
 * impression (TEXT), and per-item evidence IMAGE references, plus the current-
 * requested-procedure evidence (the UID map). This JSON is what the DICOM toolkit
 * (dcmjs) serializes into an SR SOP instance in the export step — the mapping is
 * pure + unit-tested; the byte encoding runs via the existing DICOM agent.
 * SR is an ADDITIONAL export; it never replaces the ERP report.
 */
import type { InteropReport, InteropEvidence } from "./interopTypes";

interface Code { code: string; scheme: string; meaning: string }
const DCM = (code: string, meaning: string): Code => ({ code, scheme: "DCM", meaning });

export interface SrImageRef { studyInstanceUid: string; seriesInstanceUid: string; sopInstanceUid: string; frameNumber?: number }

export interface SrContentNode {
  relationship?: string;
  valueType: "CONTAINER" | "TEXT" | "NUM" | "CODE" | "IMAGE";
  conceptName?: Code;
  textValue?: string;
  measuredValue?: { value: number; unit: string };
  conceptCode?: Code;
  imageRef?: SrImageRef;
  content?: SrContentNode[];
}

export interface SrContentTree {
  templateId: "TID1500";
  conceptName: Code;
  studyInstanceUid: string;
  content: SrContentNode[];
  /** UID map — current requested procedure evidence (all referenced instances). */
  evidence: Array<{ studyInstanceUid: string; seriesInstanceUid: string; sopInstanceUids: string[] }>;
}

function imageRefs(studyUid: string, ev: InteropEvidence[] | undefined): SrContentNode[] {
  return (ev ?? [])
    .filter((e) => e.sopInstanceUid && e.seriesInstanceUid)
    .map((e) => ({
      relationship: "INFERRED FROM",
      valueType: "IMAGE" as const,
      conceptName: DCM("121112", "Source of Measurement"),
      imageRef: {
        studyInstanceUid: studyUid,
        seriesInstanceUid: e.seriesInstanceUid as string,
        sopInstanceUid: e.sopInstanceUid as string,
        frameNumber: e.frameNumber ?? undefined,
      },
    }));
}

export function buildSrContentTree(report: InteropReport): SrContentTree {
  const studyUid = report.studyInstanceUid;

  const findings: SrContentNode = {
    relationship: "CONTAINS",
    valueType: "CONTAINER",
    conceptName: DCM("121070", "Findings"),
    content: report.findings.map((f) => ({
      relationship: "CONTAINS",
      valueType: "TEXT" as const,
      conceptName: DCM("121071", "Finding"),
      textValue: f.laterality && f.laterality !== "none" ? `${f.laterality}: ${f.text}` : f.text,
      content: imageRefs(studyUid, f.evidence),
    })),
  };

  const measurements: SrContentNode = {
    relationship: "CONTAINS",
    valueType: "CONTAINER",
    conceptName: DCM("125007", "Measurement Group"),
    content: report.measurements.map((m) => ({
      relationship: "CONTAINS",
      valueType: "NUM" as const,
      conceptName: { code: m.id, scheme: "CARE", meaning: m.id },
      measuredValue: { value: m.value, unit: m.unit },
    })),
  };

  const impression: SrContentNode = {
    relationship: "CONTAINS",
    valueType: "TEXT",
    conceptName: DCM("121073", "Impression"),
    textValue: report.impression.join("\n"),
  };

  // UID map: group all referenced evidence instances by series.
  const bySeries = new Map<string, Set<string>>();
  for (const f of report.findings) {
    for (const e of f.evidence ?? []) {
      if (!e.seriesInstanceUid || !e.sopInstanceUid) continue;
      if (!bySeries.has(e.seriesInstanceUid)) bySeries.set(e.seriesInstanceUid, new Set());
      bySeries.get(e.seriesInstanceUid)!.add(e.sopInstanceUid);
    }
  }

  return {
    templateId: "TID1500",
    conceptName: DCM("126000", "Imaging Measurement Report"),
    studyInstanceUid: studyUid,
    content: [findings, measurements, impression],
    evidence: [...bySeries.entries()].map(([seriesInstanceUid, sops]) => ({
      studyInstanceUid: studyUid,
      seriesInstanceUid,
      sopInstanceUids: [...sops],
    })),
  };
}
