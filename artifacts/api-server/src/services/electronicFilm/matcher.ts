// ============================================================================
// Electronic Film study matching — safety-critical deterministic matching.
// Priority: StudyInstanceUID > AccessionNumber > never PatientName alone.
// ============================================================================
import { eq } from "drizzle-orm";
import { db, radiologyStudiesTable } from "@workspace/db";
import type { ElectronicFilmMatchMethod } from "@workspace/db";

export interface MatchCandidate {
  studyId: number;
  orderId: number | null;
  patientId: number;
  accessionNumber: string;
  studyInstanceUid: string | null;
  modality: string;
  studyDescription: string | null;
  studyDate: string | null;
  scheduledAt: Date | null;
}

export interface MatchResult {
  status: "MATCHED" | "MATCH_REQUIRED";
  studyId: number | null;
  orderId: number | null;
  patientId: number | null;
  matchMethod: ElectronicFilmMatchMethod | null;
  candidates: MatchCandidate[];
  reason?: string;
}

function normUid(v: string | null | undefined): string | null {
  if (!v || !String(v).trim()) return null;
  return String(v).trim().toUpperCase();
}

function normAccession(v: string | null | undefined): string | null {
  if (!v || !String(v).trim()) return null;
  return String(v).trim();
}

export async function matchElectronicFilmToStudy(input: {
  studyInstanceUid?: string | null;
  accessionNumber?: string | null;
  modality?: string | null;
  studyDate?: string | null;
  dicomPatientId?: string | null;
}): Promise<MatchResult> {
  const uid = normUid(input.studyInstanceUid);
  const accession = normAccession(input.accessionNumber);

  if (uid) {
    const rows = await db
      .select({
        id: radiologyStudiesTable.id,
        orderId: radiologyStudiesTable.orderId,
        patientId: radiologyStudiesTable.patientId,
        accessionNumber: radiologyStudiesTable.accessionNumber,
        studyInstanceUid: radiologyStudiesTable.studyInstanceUid,
        modality: radiologyStudiesTable.modality,
        studyDescription: radiologyStudiesTable.studyDescription,
        studyDate: radiologyStudiesTable.studyDate,
        scheduledAt: radiologyStudiesTable.scheduledAt,
      })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.studyInstanceUid, uid));
    if (rows.length === 1) {
      const s = rows[0];
      return {
        status: "MATCHED",
        studyId: s.id,
        orderId: s.orderId,
        patientId: s.patientId,
        matchMethod: "STUDY_UID",
        candidates: [],
      };
    }
    if (rows.length > 1) {
      return {
        status: "MATCH_REQUIRED",
        studyId: null,
        orderId: null,
        patientId: null,
        matchMethod: null,
        candidates: rows.map(mapCandidate),
        reason: "multiple_study_uid_matches",
      };
    }
  }

  if (accession) {
    const rows = await db
      .select({
        id: radiologyStudiesTable.id,
        orderId: radiologyStudiesTable.orderId,
        patientId: radiologyStudiesTable.patientId,
        accessionNumber: radiologyStudiesTable.accessionNumber,
        studyInstanceUid: radiologyStudiesTable.studyInstanceUid,
        modality: radiologyStudiesTable.modality,
        studyDescription: radiologyStudiesTable.studyDescription,
        studyDate: radiologyStudiesTable.studyDate,
        scheduledAt: radiologyStudiesTable.scheduledAt,
      })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.accessionNumber, accession));
    if (rows.length === 1) {
      const s = rows[0];
      return {
        status: "MATCHED",
        studyId: s.id,
        orderId: s.orderId,
        patientId: s.patientId,
        matchMethod: "ACCESSION",
        candidates: [],
      };
    }
    if (rows.length > 1) {
      return {
        status: "MATCH_REQUIRED",
        studyId: null,
        orderId: null,
        patientId: null,
        matchMethod: null,
        candidates: rows.map(mapCandidate),
        reason: "multiple_accession_matches",
      };
    }
  }

  // Suggest candidates only — never auto-match on weak signals.
  const candidates = await suggestCandidates(input);
  return {
    status: "MATCH_REQUIRED",
    studyId: null,
    orderId: null,
    patientId: null,
    matchMethod: null,
    candidates,
    reason: uid || accession ? "no_deterministic_match" : "identity_absent",
  };
}

async function suggestCandidates(input: {
  modality?: string | null;
  studyDate?: string | null;
  dicomPatientId?: string | null;
}): Promise<MatchCandidate[]> {
  const rows = await db
    .select({
      id: radiologyStudiesTable.id,
      orderId: radiologyStudiesTable.orderId,
      patientId: radiologyStudiesTable.patientId,
      accessionNumber: radiologyStudiesTable.accessionNumber,
      studyInstanceUid: radiologyStudiesTable.studyInstanceUid,
      modality: radiologyStudiesTable.modality,
      studyDescription: radiologyStudiesTable.studyDescription,
      studyDate: radiologyStudiesTable.studyDate,
      scheduledAt: radiologyStudiesTable.scheduledAt,
    })
    .from(radiologyStudiesTable)
    .orderBy(radiologyStudiesTable.scheduledAt)
    .limit(50);

  const mod = (input.modality || "").toUpperCase();
  const date = input.studyDate || "";
  const pid = (input.dicomPatientId || "").trim();

  const scored = rows
    .map((r) => {
      let score = 0;
      if (mod && r.modality?.toUpperCase() === mod) score += 2;
      if (date && String(r.studyDate) === date) score += 2;
      if (pid && String(r.patientId) === pid) score += 1;
      return { row: r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return scored.map((x) => mapCandidate(x.row));
}

function mapCandidate(s: {
  id: number;
  orderId: number | null;
  patientId: number;
  accessionNumber: string;
  studyInstanceUid: string | null;
  modality: string;
  studyDescription: string | null;
  studyDate: string | null;
  scheduledAt: Date | null;
}): MatchCandidate {
  return {
    studyId: s.id,
    orderId: s.orderId,
    patientId: s.patientId,
    accessionNumber: s.accessionNumber,
    studyInstanceUid: s.studyInstanceUid,
    modality: s.modality,
    studyDescription: s.studyDescription,
    studyDate: s.studyDate ? String(s.studyDate) : null,
    scheduledAt: s.scheduledAt,
  };
}

export async function getMatchCandidatesForArtifact(artifactId: number): Promise<MatchCandidate[]> {
  const { electronicFilmArtifactsTable } = await import("@workspace/db");
  const [art] = await db
    .select()
    .from(electronicFilmArtifactsTable)
    .where(eq(electronicFilmArtifactsTable.id, artifactId))
    .limit(1);
  if (!art) return [];
  const result = await matchElectronicFilmToStudy({
    studyInstanceUid: art.studyInstanceUid,
    accessionNumber: art.accessionNumber,
    modality: art.modality,
    studyDate: art.studyDate,
    dicomPatientId: art.dicomPatientId,
  });
  return result.candidates;
}
