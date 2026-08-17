import {
  compactNameKey,
  formatDicomPersonNameForDisplay,
  nameComparisonKeys,
  nameTokensForMatch,
} from "./dicomNameNormalize";

export interface DicomInput {
  patientName: string;
  dicomPatientId?: string | null;
  age?: string | null;
  sex?: string | null;
  modality: string;
  studyDescription?: string | null;
  accessionNumber: string;
  studyDate?: string | null;
  studyTime?: string | null;
  studyInstanceUID?: string | null;
  referringDoctor?: string | null;
}

export interface BilledTestInput {
  id: number;
  patientId: number;
  patientName: string;
  patientUHID?: string | null;
  age?: string | null;
  sex?: string | null;
  testName: string;
  modality: string;
  accessionNumber: string;
  billNumber?: string | null;
  studyDate?: string | null;
  /** Referring physician from billed study / order doctor (optional soft match). */
  referringDoctor?: string | null;
}

export interface MatchResult {
  score: "GREEN" | "YELLOW" | "RED";
  points: number;
  reasons: string[];
  warnings: string[];
}

/** Strip separators so ACC-20260817-US-01 and ACC20260817US01 match. */
export function normalizeAccessionKey(acc: string | null | undefined): string {
  return String(acc || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let j = 1; j <= n; j++) {
    for (let i = 1; i <= m; i++) {
      const substitutionCost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + substitutionCost,
      );
    }
  }
  return d[m][n];
}

/**
 * Patient / doctor name similarity that tolerates:
 * - DICOM carets (LAST^FIRST)
 * - First/Last order swap (MRI vs ERP)
 * - Titles (Dr) and degrees (MD, MBBS, …)
 */
export function nameSimilarity(n1: string, n2: string): number {
  const keys1 = nameComparisonKeys(n1);
  const keys2 = nameComparisonKeys(n2);
  if (!keys1.length || !keys2.length) {
    // Legacy fallback
    const s1 = n1.toLowerCase().replace(/[^a-z0-9]/g, "");
    const s2 = n2.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!s1 || !s2) return 0;
    const dist = levenshteinDistance(s1, s2);
    return 1 - dist / Math.max(s1.length, s2.length);
  }

  let best = 0;
  for (const a of keys1) {
    for (const b of keys2) {
      if (a === b) return 1;
      const dist = levenshteinDistance(a, b);
      const sim = 1 - dist / Math.max(a.length, b.length);
      if (sim > best) best = sim;
    }
  }

  // Token-set overlap as a floor (same words, different middle names)
  const t1 = new Set(nameTokensForMatch(n1));
  const t2 = new Set(nameTokensForMatch(n2));
  if (t1.size && t2.size) {
    let overlap = 0;
    for (const t of t1) if (t2.has(t)) overlap++;
    const union = new Set([...t1, ...t2]).size;
    const jaccard = overlap / union;
    if (jaccard > best) best = jaccard;
  }

  return best;
}

/** Soft referring-doctor similarity (same cleaner as patient names). */
export function referringDoctorSimilarity(
  dicomRef: string | null | undefined,
  billRef: string | null | undefined,
): number {
  if (!dicomRef?.trim() || !billRef?.trim()) return 0;
  return nameSimilarity(dicomRef, billRef);
}

export { formatDicomPersonNameForDisplay, nameTokensForMatch, compactNameKey };

export function calculateMatchScore(dicom: DicomInput, bill: BilledTestInput): MatchResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let points = 0;

  // 1. Accession Number exact match (Highest Priority)
  const cleanDicomAcc = normalizeAccessionKey(dicom.accessionNumber);
  const cleanBillAcc = normalizeAccessionKey(bill.accessionNumber);
  if (cleanDicomAcc && cleanBillAcc && cleanDicomAcc === cleanBillAcc) {
    points += 50;
    reasons.push("Accession number matches exactly");
  } else if (cleanDicomAcc || cleanBillAcc) {
    warnings.push("Accession number differs or is missing on one record");
  }

  // 2. Patient ID / UHID matching
  const cleanDicomPid = (dicom.dicomPatientId || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const cleanBillPid = (bill.patientUHID || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (cleanDicomPid && cleanBillPid && cleanDicomPid === cleanBillPid) {
    points += 30;
    reasons.push("Patient ID / UHID matches exactly");
  } else if (cleanDicomPid && bill.patientId && String(bill.patientId) === dicom.dicomPatientId) {
    points += 30;
    reasons.push("Patient ID matches internal database ID");
  }

  // 3. Name Similarity matching (DICOM-aware)
  const sim = nameSimilarity(dicom.patientName, bill.patientName);
  if (sim >= 0.85) {
    points += 20;
    reasons.push(`Patient name matches confidently (similarity: ${Math.round(sim * 100)}%)`);
  } else if (sim >= 0.6) {
    points += 10;
    reasons.push(`Patient name matches partially (similarity: ${Math.round(sim * 100)}%)`);
    warnings.push("Patient name differs slightly between DICOM and billing");
  } else {
    warnings.push("NAME_MISMATCH: Patient name differs completely");
  }

  // 3b. Referring doctor — soft bonus only (never forces RED by itself)
  const refSim = referringDoctorSimilarity(dicom.referringDoctor, bill.referringDoctor);
  if (refSim >= 0.85) {
    points += 5;
    reasons.push(`Referring doctor matches (${Math.round(refSim * 100)}%)`);
  } else if (dicom.referringDoctor?.trim() && bill.referringDoctor?.trim() && refSim < 0.5) {
    warnings.push("Referring doctor name differs after cleaning titles/degrees (non-blocking)");
  }

  // 4. Modality Compatibility
  const dMod = (dicom.modality || "").toUpperCase();
  const bMod = (bill.modality || "").toUpperCase();
  const modMap: Record<string, string> = {
    CR: "XRAY", DX: "XRAY", XRAY: "XRAY",
    MR: "MRI", MRI: "MRI",
    CT: "CT",
    US: "USG", USG: "USG",
    MG: "MAMMO", MAMMO: "MAMMO",
  };
  const normalizedDMod = modMap[dMod] || dMod;
  const normalizedBMod = modMap[bMod] || bMod;

  if (normalizedDMod === normalizedBMod) {
    points += 10;
    reasons.push(`Modality matches (${dMod})`);
  } else {
    warnings.push(`MODALITY_MISMATCH: Billed for ${bMod} but DICOM shows ${dMod}`);
  }

  // 5. Study Description vs Test Name compatibility
  const cleanDesc = (dicom.studyDescription || "").toLowerCase();
  const cleanTest = (bill.testName || "").toLowerCase();
  if (cleanDesc && cleanTest) {
    const descWords = cleanDesc.split(/\s+/).filter((w) => w.length > 2);
    const testWords = cleanTest.split(/\s+/).filter((w) => w.length > 2);
    const overlap = descWords.filter((w) => testWords.includes(w));
    if (overlap.length > 0) {
      points += 10;
      reasons.push("Study description matches billing test name keywords");
    }
  }

  // 6. Study Date Proximity
  if (dicom.studyDate && bill.studyDate) {
    try {
      const dDate = new Date(dicom.studyDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"));
      const bDate = new Date(bill.studyDate);
      const diffMs = Math.abs(dDate.getTime() - bDate.getTime());
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (diffDays <= 1) {
        points += 10;
        reasons.push("Study date is within 24 hours of billing");
      } else if (diffDays > 3) {
        warnings.push(`DATE_MISMATCH: Study date differs from billing date by ${Math.round(diffDays)} days`);
      }
    } catch {
      // Date parse error - skip date matching
    }
  }

  // 7. Age & Sex Match
  if (dicom.sex && bill.sex) {
    const dSex = dicom.sex.toLowerCase().charAt(0);
    const bSex = bill.sex.toLowerCase().charAt(0);
    if (dSex === bSex) {
      points += 5;
      reasons.push("Gender matches");
    } else {
      warnings.push(`Gender mismatch: DICOM shows ${dicom.sex}, billing shows ${bill.sex}`);
    }
  }
  if (dicom.age && bill.age) {
    const dAgeMatch = dicom.age.match(/(\d+)/);
    const bAgeMatch = bill.age.match(/(\d+)/);
    if (dAgeMatch && bAgeMatch) {
      const dAge = parseInt(dAgeMatch[1], 10);
      const bAge = parseInt(bAgeMatch[1], 10);
      if (Math.abs(dAge - bAge) <= 5) {
        points += 5;
        reasons.push("Age matches within 5 years");
      } else {
        warnings.push(`Age mismatch: DICOM shows ${dicom.age}, billing shows ${bill.age}`);
      }
    }
  }

  // Determine final score classification.
  // Accession is the work-id link key (MWL → modality → Orthanc return). When
  // it matches exactly, NAME_MISMATCH is informational only — the bill/study
  // identity is already proven. Modality mismatch stays critical.
  const accessionMatched = reasons.some((r) => r.includes("Accession number matches exactly"));
  const hasCriticalWarnings = warnings.some(
    (w) =>
      w.startsWith("MODALITY_MISMATCH") ||
      (w.startsWith("NAME_MISMATCH") && !accessionMatched),
  );

  let score: "GREEN" | "YELLOW" | "RED" = "RED";
  if (points >= 75 && !hasCriticalWarnings) {
    score = "GREEN";
  } else if (points >= 30 && !hasCriticalWarnings) {
    score = "YELLOW";
  } else {
    score = "RED";
  }

  return {
    score,
    points,
    reasons,
    warnings,
  };
}
