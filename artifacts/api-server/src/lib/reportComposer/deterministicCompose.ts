/**
 * Deterministic fallback composition — no Ollama / DB imports (unit-testable).
 */
import type { AiComposeJobKind } from "@workspace/db/schema";
import type { ComposerDraftOutput, ComposerInputSnapshot } from "./types";

function splitKeep(text: string): string[] {
  return text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

/** Organizes supplied observations only — never invents pathology. */
export function deterministicComposeFromSnapshot(
  snapshot: ComposerInputSnapshot,
  kind: AiComposeJobKind,
): ComposerDraftOutput {
  const obs = snapshot.observations ?? [];
  const findingsFromObs = obs.map((o) => o.findingsText.trim()).filter(Boolean);
  const findings =
    kind === "IMPRESSION"
      ? snapshot.findings
      : findingsFromObs.length
        ? [...new Set([...(snapshot.findings ? splitKeep(snapshot.findings) : []), ...findingsFromObs])].join("\n")
        : snapshot.findings;

  const impressionBits = obs.map((o) => o.impressionText?.trim() || o.findingsText.trim()).filter(Boolean);
  const impression =
    kind === "FULL_REPORT" || kind === "IMPRESSION"
      ? (snapshot.impression.trim()
          ? snapshot.impression
          : impressionBits.slice(0, 5).join(" "))
      : snapshot.impression;

  return {
    findings,
    impression,
    recommendation: snapshot.recommendation || "",
    unresolvedQuestions: [],
    warnings: ["deterministic_fallback"],
  };
}
