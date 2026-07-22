// ============================================================================
// Deterministic, reviewed patient matching (brief §5). Outcomes:
//   confirmed_existing — a prior confirmed HOPE↔CARE link (highest trust)
//   probable           — candidate(s) found; staff must confirm
//   no_match           — create a new CARE patient
//   conflict           — a confirmed link exists but demographics contradict it
//                        → BLOCK, require review (wrong-patient protection)
//
// Rules honoured:
//   • Never match on NAME alone — a name only refines a phone-based candidate.
//   • Never auto-merge — anything short of a prior confirmed link needs staff
//     confirmation.
//   • Phone shared by different names (families) is surfaced as low-confidence,
//     never silently merged.
// ============================================================================
import { sql, eq, and } from "drizzle-orm";
import { patientsTable, externalPatientLinksTable } from "@workspace/db";
import type { Executor } from "./db";
import { normalizeName, normalizePhone } from "./normalize";

export interface MatchInput {
  sourceSystem: string; // "HOPE"
  sourcePatientId: string; // HOPE uhid
  name: string;
  phone?: string | null;
  age?: number | null;
  gender?: string | null;
}

export interface MatchCandidate {
  carePatientId: number;
  patientCode: string;
  name: string;
  phone: string;
  gender: string | null;
  score: number;
  reasons: string[];
}

export type MatchOutcome = "confirmed_existing" | "probable" | "no_match" | "conflict";

export interface MatchResult {
  outcome: MatchOutcome;
  carePatientId?: number;
  linkId?: number;
  confidence: number;
  method: string;
  candidates: MatchCandidate[];
  conflictReason?: string;
}

export function scoreCandidate(
  input: MatchInput,
  p: { firstName: string; lastName: string; phone: string; gender: string | null; ageValue: number | null },
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const inPhone = normalizePhone(input.phone);
  const cPhone = normalizePhone(p.phone);
  if (inPhone && cPhone && inPhone === cPhone) {
    score += 50;
    reasons.push("mobile_exact");
  }
  const inName = normalizeName(input.name);
  const cName = normalizeName(`${p.firstName} ${p.lastName}`);
  if (inName && cName) {
    if (inName === cName) {
      score += 30;
      reasons.push("name_exact");
    } else {
      const a = new Set(inName.split(" "));
      const b = new Set(cName.split(" "));
      const overlap = [...a].filter((t) => b.has(t)).length;
      if (overlap > 0 && (a.has([...b][0]) || b.has([...a][0]) || overlap >= 2)) {
        score += 15;
        reasons.push("name_partial");
      } else {
        reasons.push("name_differs");
      }
    }
  }
  if (input.gender && p.gender && input.gender.toLowerCase()[0] === p.gender.toLowerCase()[0]) {
    score += 10;
    reasons.push("gender_match");
  }
  if (input.age != null && p.ageValue != null) {
    const d = Math.abs(input.age - p.ageValue);
    if (d <= 2) {
      score += 10;
      reasons.push("age_within_2");
    } else if (d <= 5) {
      score += 5;
      reasons.push("age_within_5");
    }
  }
  return { score, reasons };
}

export async function matchPatient(exec: Executor, input: MatchInput): Promise<MatchResult> {
  // ── Tier 1: existing confirmed link (highest trust) ──────────────────────
  const [link] = await exec
    .select()
    .from(externalPatientLinksTable)
    .where(
      and(
        eq(externalPatientLinksTable.sourceSystem, input.sourceSystem),
        eq(externalPatientLinksTable.sourcePatientId, input.sourcePatientId),
        eq(externalPatientLinksTable.linkStatus, "confirmed"),
      ),
    )
    .limit(1);

  if (link && link.carePatientId) {
    const [linked] = await exec.select().from(patientsTable).where(eq(patientsTable.id, link.carePatientId)).limit(1);
    if (linked) {
      // Wrong-patient protection: a confirmed link must stay consistent. If the
      // incoming name AND phone both contradict the linked record, block.
      const nameOk = !normalizeName(input.name) || normalizeName(input.name) === normalizeName(`${linked.firstName} ${linked.lastName}`) ||
        normalizeName(`${linked.firstName} ${linked.lastName}`).split(" ").some((t) => normalizeName(input.name).split(" ").includes(t));
      const phoneOk = !normalizePhone(input.phone) || normalizePhone(input.phone) === normalizePhone(linked.phone);
      if (!nameOk && !phoneOk) {
        return {
          outcome: "conflict",
          linkId: link.id,
          carePatientId: link.carePatientId,
          confidence: 0,
          method: "existing_link_conflict",
          candidates: [{
            carePatientId: linked.id, patientCode: linked.patientId,
            name: `${linked.firstName} ${linked.lastName}`.trim(), phone: linked.phone,
            gender: linked.gender, score: 0, reasons: ["linked_but_demographics_differ"],
          }],
          conflictReason: "A confirmed HOPE↔CARE link exists but the incoming name and mobile both differ from the linked CARE patient. Manual review required.",
        };
      }
      return {
        outcome: "confirmed_existing",
        carePatientId: link.carePatientId,
        linkId: link.id,
        confidence: 100,
        method: "existing_link",
        candidates: [],
      };
    }
  }

  // ── Tier 2: candidate search by MOBILE (never name-only) ─────────────────
  const normPhone = normalizePhone(input.phone);
  let candidates: MatchCandidate[] = [];
  if (normPhone) {
    const rows = await exec
      .select()
      .from(patientsTable)
      .where(sql`regexp_replace(${patientsTable.phone}, '\D', '', 'g') LIKE ${"%" + normPhone}`)
      .limit(25);
    candidates = rows
      .map((p) => {
        const { score, reasons } = scoreCandidate(input, p);
        return {
          carePatientId: p.id,
          patientCode: p.patientId,
          name: `${p.firstName} ${p.lastName}`.trim(),
          phone: p.phone,
          gender: p.gender,
          score,
          reasons,
        };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  if (candidates.length === 0) {
    return { outcome: "no_match", confidence: 0, method: "no_candidate", candidates: [] };
  }

  const best = candidates[0];
  const strong = best.reasons.includes("mobile_exact") && (best.reasons.includes("name_exact") || best.reasons.includes("name_partial"));
  return {
    outcome: "probable",
    confidence: Math.min(best.score, 95), // never 100 without a confirmed link
    method: strong ? "mobile_name" : "mobile_only",
    candidates,
  };
}
