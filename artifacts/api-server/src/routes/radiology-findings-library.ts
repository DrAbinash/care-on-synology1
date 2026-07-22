/**
 * radiology-findings-library.ts — Report Builder backend.
 *
 * The searchable findings catalogue itself is a static asset shipped with the
 * ERP (public/data/radiology-findings-library.json), so the browser can search
 * it instantly offline. This router provides the server-side actions:
 *
 *   POST /merge   — combine several selected findings into ONE house-style
 *                   report (deterministic; optional AI smoothing with mode:"ai").
 *   GET  /meta    — lightweight catalogue metadata (source path + stats).
 *
 * Mounted at /api/radiology/findings-library with requireStaffAuth +
 * requireStaffPermission("/radiology") in routes/index.ts.
 */
import { Router, type Request, type Response } from "express";
import { mergeFindings, type MergeFinding } from "../lib/findingsMerge";

export const radiologyFindingsLibraryRouter = Router();

const LIBRARY_ASSET = "/data/radiology-findings-library.json";
const MAX_FINDINGS = 300;

radiologyFindingsLibraryRouter.get("/meta", (_req: Request, res: Response) => {
  res.json({
    asset: LIBRARY_ASSET,
    note: "The findings catalogue is a static asset loaded by the client; POST /merge composes selected findings into one report.",
  });
});

interface MergeBody {
  findings?: unknown;
  title?: unknown;
  technique?: unknown;
  normalImpression?: unknown;
  sectionOrder?: unknown;
  mode?: unknown;
}

function sanitizeFindings(raw: unknown): MergeFinding[] | null {
  if (!Array.isArray(raw)) return null;
  const out: MergeFinding[] = [];
  for (const item of raw.slice(0, MAX_FINDINGS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.slice(0, 600) : "";
    if (!text.trim()) continue;
    out.push({
      text,
      section: typeof o.section === "string" ? o.section.slice(0, 60) : undefined,
      abnormal: o.abnormal === true,
      impression: o.impression === true,
      modality: typeof o.modality === "string" ? o.modality.slice(0, 20) : undefined,
      region: typeof o.region === "string" ? o.region.slice(0, 40) : undefined,
    });
  }
  return out;
}

radiologyFindingsLibraryRouter.post("/merge", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as MergeBody;
  const findings = sanitizeFindings(body.findings);
  if (findings === null) {
    res.status(400).json({ error: "`findings` must be an array." });
    return;
  }

  const merged = mergeFindings({
    findings,
    title: typeof body.title === "string" ? body.title.slice(0, 160) : undefined,
    technique: typeof body.technique === "string" ? body.technique.slice(0, 1200) : undefined,
    normalImpression: typeof body.normalImpression === "string" ? body.normalImpression.slice(0, 400) : undefined,
    sectionOrder: Array.isArray(body.sectionOrder)
      ? body.sectionOrder.filter((s): s is string => typeof s === "string").slice(0, 64)
      : undefined,
  });

  // Optional AI smoothing — turns the merged draft into flowing house-style prose
  // WITHOUT adding or removing findings. Best-effort: any failure falls back to
  // the deterministic merge so the endpoint never blocks report building.
  if (body.mode === "ai" && merged.counts.findings > 0) {
    try {
      const { generateAiForTask } = await import("@workspace/ai-providers");
      const prompt =
        "You are a radiologist's report assistant. Rewrite the FINDINGS and IMPRESSION below into clean, " +
        "flowing house-style prose. Rules: use ONLY the sentences given; do NOT add, remove, upgrade or " +
        "downgrade any finding; keep every measurement; keep the numbered impression. Return the report text only.\n\n" +
        merged.plainText;
      const ai = await generateAiForTask("report_enhancement", prompt, undefined, { maxTokens: 1200 });
      const text = (ai?.text ?? "").trim();
      if (text) {
        res.json({ ...merged, aiText: text, aiUsed: true });
        return;
      }
    } catch {
      // fall through to deterministic result
    }
    res.json({ ...merged, aiUsed: false });
    return;
  }

  res.json(merged);
});
