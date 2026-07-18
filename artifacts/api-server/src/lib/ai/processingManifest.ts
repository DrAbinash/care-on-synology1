/**
 * Processing Manifest — pure reproducibility hash (Phase P1 / Gate G5).
 *
 * No DB, no network. The manifest ROW is written in shadowPipeline.ts; this
 * module owns only the deterministic input-hash computation that makes a draft
 * reproducible and drives the reprocessing decision.
 */
import { createHash } from "node:crypto";

export interface ManifestInputs {
  snapshotContentHash: string;
  modelVersion: string;
  promptVersion: string;
  knowledgePackVersion: string;
  rulesVersion: string;
  measurementEngineVersion: string;
  imageSelection: Array<{ seriesUid: string; sopUid: string; frameNumber: number }>;
}

/**
 * Reproducibility key: identical inputs → identical hash, independent of image-
 * selection ordering. Any change to the snapshot, model, prompt, knowledge pack,
 * rules, measurement engine, or selected images changes it — that difference is
 * what a later phase uses to decide a study needs reprocessing.
 */
export function computeInputHash(inp: ManifestInputs): string {
  const selection = inp.imageSelection
    .map((s) => `${s.seriesUid}/${s.sopUid}#${s.frameNumber}`)
    .sort()
    .join(",");
  return createHash("sha256")
    .update([
      inp.snapshotContentHash,
      inp.modelVersion,
      inp.promptVersion,
      inp.knowledgePackVersion,
      inp.rulesVersion,
      inp.measurementEngineVersion,
      selection,
    ].join("|"))
    .digest("hex");
}
