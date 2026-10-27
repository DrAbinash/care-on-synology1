/**
 * Deterministic fallback composition — no Ollama / DB imports (unit-testable).
 *
 * Behavior for clinic usability when the local model is unavailable:
 * - Preserve normal scaffold Findings when present
 * - Overlay observation findings that are not already represented
 * - Build Impression from observation impression contributions / findings
 * - Recommendation only from supplied recommendation / observation contributions
 */
import type { AiComposeJobKind } from "@workspace/db/schema";
import type { ComposerDraftOutput, ComposerInputSnapshot } from "./types";

function splitKeep(text: string): string[] {
  return text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

function includesLoose(hay: string, needle: string): boolean {
  const h = hay.toLowerCase().replace(/\s+/g, " ");
  const n = needle.toLowerCase().replace(/\s+/g, " ").trim();
  if (!n) return true;
  return h.includes(n.slice(0, Math.min(n.length, 48)));
}

/** Organizes supplied observations only — never invents pathology. */
export function deterministicComposeFromSnapshot(
  snapshot: ComposerInputSnapshot,
  kind: AiComposeJobKind,
): ComposerDraftOutput {
  // No model, no rewriting. "Make this report more professional" and "combine
  // these two reports" are language tasks: assembling sentences from the
  // observation list is NOT a professionalisation of the report the radiologist
  // wrote, and passing it off as one would put mechanical prose into the report
  // of record under an Apply that looks like an accepted AI edit. The honest
  // no-AI answer is their own text back, unchanged, with the reason attached —
  // which produces zero tracked changes and therefore nothing to accept.
  // Structuring a dictation has no mechanical equivalent either. Emitting the
  // dictation as a single row would read as a structured observation and be
  // insertable into the canonical ledger, which is a clinical claim CARE did not
  // make — so the no-AI answer is an empty proposal, and the job reports why.
  if (kind === "OBSERVATIONS") {
    return {
      findings: "",
      impression: "",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: ["deterministic_fallback", "deterministic_cannot_structure_dictation"],
    };
  }

  if (kind === "PROFESSIONALIZE" || kind === "COMBINE") {
    return {
      findings: snapshot.findings ?? "",
      impression: snapshot.impression ?? "",
      recommendation: snapshot.recommendation ?? "",
      unresolvedQuestions: [],
      warnings: [
        "deterministic_fallback",
        kind === "COMBINE"
          ? "deterministic_no_model_so_nothing_was_merged"
          : "deterministic_no_model_so_report_unchanged",
      ],
    };
  }

  const obs = snapshot.observations ?? [];
  const scaffold = (snapshot.findings ?? "").trim();
  const findingsFromObs = obs.map((o) => o.findingsText.trim()).filter(Boolean);

  let findings = scaffold;
  if (kind !== "IMPRESSION" && findingsFromObs.length) {
    const lines = scaffold ? splitKeep(scaffold) : [];
    for (const f of findingsFromObs) {
      if (!includesLoose(lines.join("\n"), f)) lines.push(f);
    }
    findings = lines.join("\n");
  } else if (kind === "IMPRESSION") {
    findings = snapshot.findings;
  }

  // Uncapped, deliberately: the Findings branch above appends every observation, so
  // the old `.slice(0, 6)` let ONE draft list nine abnormalities in Findings and only
  // six in Impression. The missing three were supplied clinical text rather than a
  // summarisation choice, and nothing told the radiologist they had been dropped.
  const impressionBits = obs
    .map((o) => o.impressionText?.trim() || o.findingsText.trim())
    .filter(Boolean);
  const impression =
    kind === "FULL_REPORT" || kind === "IMPRESSION"
      ? snapshot.impression.trim()
        ? snapshot.impression
        : impressionBits.join(" ")
      : snapshot.impression;

  const recFromObs = obs
    .map((o) => o.recommendationText?.trim())
    .filter((x): x is string => Boolean(x));
  const recommendation =
    (snapshot.recommendation || "").trim() ||
    (recFromObs.length ? recFromObs[0]! : "");

  return {
    findings,
    impression,
    recommendation,
    unresolvedQuestions: [],
    warnings: ["deterministic_fallback"],
  };
}
