/**
 * GPU / context clean-runner probe matrix for CARE UI self-test.
 * Diagnostic only — does not change production overnight/draft defaults.
 *
 * Probes unload qwen and wait until /api/ps shows the runner absent before each request.
 */
import type { OllamaPsSnapshot } from "./ollamaRunnerDiagnostics";
import { formatPsSummary } from "./ollamaRunnerDiagnostics";

export interface GpuContextProbeCell {
  id: string;
  imageCount: number;
  numCtx: number;
  /** Run only when earlier required cells did not force a hard stop. */
  optional?: boolean;
}

/** Exact CARE UI matrix the operator runs on one real MRI. */
export const GPU_CONTEXT_CLEAN_RUNNER_MATRIX: readonly GpuContextProbeCell[] = [
  { id: "gpu-1-4096", imageCount: 1, numCtx: 4096 },
  { id: "gpu-2-4096", imageCount: 2, numCtx: 4096 },
  { id: "gpu-3-4096", imageCount: 3, numCtx: 4096 },
  { id: "gpu-1-5120", imageCount: 1, numCtx: 5120 },
  { id: "gpu-1-6144", imageCount: 1, numCtx: 6144 },
  { id: "gpu-1-7168", imageCount: 1, numCtx: 7168 },
  { id: "gpu-1-8192", imageCount: 1, numCtx: 8192 },
  { id: "gpu-1-16384", imageCount: 1, numCtx: 16384, optional: true },
] as const;

export interface GpuContextProbeRow {
  id: string;
  imageCount: number;
  numCtx: number;
  optional: boolean;
  skipped: boolean;
  skipReason: string | null;
  pass: boolean | null;
  httpStatus: number | null;
  elapsedMs: number | null;
  estimatedRequestTokens: number | null;
  ollamaRequestTokens: number | null;
  ollamaAvailableContext: number | null;
  errorCode: string | null;
  gpuOutOfMemory: boolean;
  contextBudgetExceeded: boolean;
  responseLength: number | null;
  parserSuccess: boolean | null;
  candidateCount: number | null;
  usableOutput: boolean | null;
  psBefore: string | null;
  psAfter: string | null;
  runnerClearedBeforeRequest: boolean | null;
}

export type GpuContextHardStop =
  | "none"
  | "gpu_out_of_memory"
  | "runner_not_cleared"
  | "insufficient_images_for_required_cell";

/**
 * Decide whether to run the next matrix cell given prior outcomes.
 * Fail-closed: OOM or uncleared runner stops further probing (including optional 16384).
 * CONTEXT_BUDGET_EXCEEDED at N images @ctx ⇒ skip larger image counts at the same ctx
 * (still allow higher num_ctx single-image cells).
 */
export function decideGpuContextProbeAction(opts: {
  cell: GpuContextProbeCell;
  prior: GpuContextProbeRow[];
  availableImageCount: number;
  hardStop: GpuContextHardStop;
}): { action: "run" | "skip"; reason: string | null; hardStop: GpuContextHardStop } {
  if (opts.hardStop !== "none") {
    return {
      action: "skip",
      reason: `STOP — ${opts.hardStop}`,
      hardStop: opts.hardStop,
    };
  }
  if (opts.availableImageCount < opts.cell.imageCount) {
    const hard =
      opts.cell.optional || opts.cell.imageCount > 1
        ? opts.hardStop
        : ("insufficient_images_for_required_cell" as const);
    return {
      action: "skip",
      reason: `SKIP — only ${opts.availableImageCount} image(s) available (need ${opts.cell.imageCount})`,
      hardStop: hard === "none" ? opts.hardStop : hard,
    };
  }

  const oom = opts.prior.find((r) => !r.skipped && r.gpuOutOfMemory);
  if (oom) {
    return {
      action: "skip",
      reason: `STOP — prior GPU_OUT_OF_MEMORY at ${oom.imageCount}@${oom.numCtx}`,
      hardStop: "gpu_out_of_memory",
    };
  }

  const uncleared = opts.prior.find((r) => r.runnerClearedBeforeRequest === false);
  if (uncleared) {
    return {
      action: "skip",
      reason: `STOP — runner not absent after unload before ${uncleared.id}`,
      hardStop: "runner_not_cleared",
    };
  }

  // Same ctx: if a smaller image-count already hit CONTEXT_BUDGET_EXCEEDED, larger N is useless.
  const ctxExceededSmaller = opts.prior.find(
    (r) =>
      !r.skipped
      && r.numCtx === opts.cell.numCtx
      && r.imageCount < opts.cell.imageCount
      && r.contextBudgetExceeded,
  );
  if (ctxExceededSmaller) {
    return {
      action: "skip",
      reason: `SKIP — CONTEXT_BUDGET_EXCEEDED already at ${ctxExceededSmaller.imageCount}@${opts.cell.numCtx}`,
      hardStop: "none",
    };
  }

  if (opts.cell.optional) {
    const requiredFailedHard = opts.prior.some(
      (r) => !r.optional && !r.skipped && (r.gpuOutOfMemory || r.runnerClearedBeforeRequest === false),
    );
    if (requiredFailedHard) {
      return {
        action: "skip",
        reason: "SKIP optional — hard failure on required cell",
        hardStop: opts.hardStop,
      };
    }
  }

  return { action: "run", reason: null, hardStop: "none" };
}

export function formatGpuContextDiagnosticReport(opts: {
  selfTestId: string;
  model: string | null;
  endpoint: string | null;
  worklistId?: number | null;
  modality?: string | null;
  availableImageCount: number;
  hardStop: GpuContextHardStop;
  rows: GpuContextProbeRow[];
  productionDefaultsChanged?: boolean;
}): string {
  const lines: string[] = [
    "GPU/CONTEXT CLEAN-RUNNER DIAGNOSTIC",
    `(CARE UI self-test — paste back for review; does NOT change production defaults)`,
    `selfTestId: ${opts.selfTestId}`,
    `model: ${opts.model ?? "—"}`,
    `endpoint: ${opts.endpoint ?? "—"}`,
    `worklistId: ${opts.worklistId ?? "—"}`,
    `modality: ${opts.modality ?? "—"}`,
    `availableImages: ${opts.availableImageCount}`,
    `hardStop: ${opts.hardStop}`,
    `productionDefaultsChanged: ${opts.productionDefaultsChanged === true}`,
    "",
    "id | imgs | num_ctx | result | http | ms | estTok | reqTok | availCtx | err | respLen | parser | cands | psBefore | psAfter | note",
  ];
  for (const r of opts.rows) {
    const result = r.skipped
      ? "SKIP"
      : r.gpuOutOfMemory
        ? "GPU_OOM"
        : r.contextBudgetExceeded
          ? "CTX_EXCEEDED"
          : r.pass
            ? "PASS"
            : "FAIL";
    lines.push(
      [
        r.id,
        r.imageCount,
        r.numCtx,
        result,
        r.httpStatus ?? "—",
        r.elapsedMs ?? "—",
        r.estimatedRequestTokens ?? "—",
        r.ollamaRequestTokens ?? "—",
        r.ollamaAvailableContext ?? "—",
        r.errorCode ?? "—",
        r.responseLength ?? "—",
        r.parserSuccess == null ? "—" : String(r.parserSuccess),
        r.candidateCount ?? "—",
        r.psBefore ?? "—",
        r.psAfter ?? "—",
        r.skipReason ?? "",
      ].join(" | "),
    );
  }
  lines.push("");
  lines.push("Notes:");
  lines.push("- Each probe: unload → wait /api/ps absent → request → capture /api/ps after.");
  lines.push("- Stop on GPU_OUT_OF_MEMORY or uncleared runner; skip useless larger N@same ctx after CONTEXT_BUDGET_EXCEEDED.");
  lines.push("- Optional 1@16384 runs only when required cells did not hard-stop.");
  return lines.join("\n");
}

export function psSummaryOrNull(ps: OllamaPsSnapshot | null | undefined): string | null {
  if (!ps) return null;
  return formatPsSummary(ps);
}
