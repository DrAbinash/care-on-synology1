/**
 * Live Orthanc study search (C-FIND via REST /tools/find).
 * Shared by pacs-worklist Orthanc merge and resolve-study-uid.
 */

import crypto from "node:crypto";

export type OrthancStudyHit = {
  studyInstanceUID: string;
  accessionNumber: string;
  patientName: string;
  modality: string;
  studyDate: string;
  studyDescription: string | null;
  referringDoctor: string | null;
};

function normalizeStudyDate(d: string | null | undefined): string {
  if (!d) return "";
  const raw = d.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

function toCompact(iso: string): string {
  return iso.replace(/-/g, "");
}

function buildStudyDateQuery(opts: {
  dateExact?: string;
  dateFrom?: string;
  dateTo?: string;
}): string {
  const { dateExact, dateFrom, dateTo } = opts;
  if (dateExact) return toCompact(dateExact);
  if (dateFrom && dateTo) return `${toCompact(dateFrom)}-${toCompact(dateTo)}`;
  if (dateFrom) return `${toCompact(dateFrom)}-`;
  if (dateTo) return `-${toCompact(dateTo)}`;
  return "";
}

export async function findOrthancStudies(opts: {
  dateExact?: string;
  dateFrom?: string;
  dateTo?: string;
  modality?: string;
  patientName?: string;
  accessionNumber?: string;
  studyDescription?: string;
  limit?: number;
}): Promise<{ rows: OrthancStudyHit[]; source: "ORTHANC_REST" | "NONE"; error?: string }> {
  const orthancBase = (process.env.ORTHANC_URL || "").replace(/\/$/, "");
  if (!orthancBase) return { rows: [], source: "NONE", error: "ORTHANC_URL not configured" };

  const orthancUser = process.env.ORTHANC_USERNAME || "";
  const orthancPass = process.env.ORTHANC_PASSWORD || "";
  const authHeaders: Record<string, string> =
    orthancUser && orthancPass
      ? { Authorization: `Basic ${Buffer.from(`${orthancUser}:${orthancPass}`).toString("base64")}` }
      : {};

  const studyDateQuery = buildStudyDateQuery(opts);
  const modalityList = (opts.modality ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const limit = Math.min(opts.limit ?? 100, 200);

  const findQuery: Record<string, string> = { QueryRetrieveLevel: "STUDY" };
  if (studyDateQuery) findQuery.StudyDate = studyDateQuery;
  if (opts.patientName?.trim()) findQuery.PatientName = `*${opts.patientName.trim()}*`;
  if (opts.accessionNumber?.trim()) findQuery.AccessionNumber = `*${opts.accessionNumber.trim()}*`;
  if (opts.studyDescription?.trim()) findQuery.StudyDescription = `*${opts.studyDescription.trim()}*`;
  if (modalityList.length === 1) findQuery.ModalitiesInStudy = modalityList[0]!;

  try {
    const findResp = await fetch(`${orthancBase}/tools/find`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        Level: "Study",
        Query: findQuery,
        Expand: true,
        Limit: limit + 50,
      }),
    });
    if (!findResp.ok) {
      return { rows: [], source: "ORTHANC_REST", error: `Orthanc /tools/find returned ${findResp.status}` };
    }

    const rawStudies = (await findResp.json()) as Record<string, unknown>[];
    const rows: OrthancStudyHit[] = [];
    for (const s of rawStudies) {
      const mt = (s.MainDicomTags as Record<string, string>) ?? {};
      const pt = (s.PatientMainDicomTags as Record<string, string>) ?? {};
      const mod = mt.ModalitiesInStudy || mt.Modality || "";
      const uid = (mt.StudyInstanceUID ?? "").trim();
      if (!uid) continue;
      const hit: OrthancStudyHit = {
        studyInstanceUID: uid,
        accessionNumber: mt.AccessionNumber ?? "",
        patientName: pt.PatientName ?? mt.PatientName ?? "",
        modality: mod,
        studyDate: normalizeStudyDate(mt.StudyDate ?? null),
        studyDescription: mt.StudyDescription ?? null,
        referringDoctor: mt.ReferringPhysicianName ?? null,
      };
      if (modalityList.length > 0
        && !modalityList.some((m) => hit.modality.toUpperCase().includes(m.toUpperCase()))) {
        continue;
      }
      rows.push(hit);
      if (rows.length >= limit) break;
    }

    return { rows, source: "ORTHANC_REST" };
  } catch (err) {
    return {
      rows: [],
      source: "ORTHANC_REST",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Stable negative id for Orthanc-only rows (not in radiology_worklist). */
export function orthancEphemeralWorklistId(studyInstanceUID: string): number {
  const hash = crypto.createHash("sha256").update(studyInstanceUID).digest();
  const n = hash.readUInt32BE(0) & 0x7fffffff;
  return n === 0 ? -1 : -n;
}
