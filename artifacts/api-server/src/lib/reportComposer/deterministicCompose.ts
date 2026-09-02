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

  const impressionBits = obs
    .map((o) => o.impressionText?.trim() || o.findingsText.trim())
    .filter(Boolean);
  const impression =
    kind === "FULL_REPORT" || kind === "IMPRESSION"
      ? snapshot.impression.trim()
        ? snapshot.impression
        : impressionBits.slice(0, 6).join(" ")
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
