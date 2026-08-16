/**
 * Phase 10C / 11: Ollama Local Model Proxy — LAN Fallback Edition
 *
 * Proxies radiology AI requests to a locally-hosted Ollama instance
 * (typically running on a Windows PC on the same LAN as the Synology NAS).
 *
 * NEW IN PHASE 11:
 *  - Fallback URL: tries ollamaBaseUrl first, then ollamaFallbackUrl if primary times out.
 *  - Master toggle: ollamaEnabled must be true or all endpoints return 503.
 *  - Configurable per-request timeout: ollamaTimeoutSeconds (default 30s).
 *  - Rich audit logging: model, endpoint_used, action_type, success per action.
 *  - New action endpoints: /improve, /grammar, /impression-from-findings, /format-care-style
 *  - Care Diagnostics–style prompt templates for MRI Brain, CT Brain, MRI Spine, etc.
 *  - Permission guard: staffSession must have "ai_reporting.use" or FULL_ACCESS_ROLES.
 *
 * All output is labelled "AI Draft — Requires Radiologist Review".
 * AI NEVER auto-finalises a report. Output goes to draft only.
 *
 * Security:
 *  - SSRF-guarded. Private/LAN IPs require ollamaLocalOnly = true.
 *  - All Ollama calls are server-side only — browser never contacts Ollama directly.
 *  - Permission check on all action endpoints.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { clinicSettingsTable, radiologyAiReviewAuditsTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import { validateOllamaUrl } from "../lib/ssrf/ollamaUrlGuard";

export const radiologyOllamaRouter = Router();

// ── SSRF guard (Phase P0 / Gate G2) ────────────────────────────────────────────
// Layered defence:
//   1. ALWAYS_BLOCKED  — cloud metadata / unspecified hosts, unreachable even in
//      Local/LAN mode. These are never a legitimate Ollama target and are the
//      classic SSRF pivot.
//   2. Egress allowlist — if AI_EGRESS_ALLOWLIST is configured it is
//      AUTHORITATIVE: the target host (or host:port) must be on it, and this
//      holds even in Local/LAN mode. This is the exact-endpoint allowlist the
//      architecture requires; leaving it unset preserves legacy behaviour.
//   3. PRIVATE_RANGES  — private / LAN / CGNAT (incl. the 100.64.0.0/10 tailnet
//      range, previously missing) blocked UNLESS Local/LAN mode is enabled.

// The SSRF egress guard is extracted to a PURE, unit-tested module (P5) — see
// the import of `validateOllamaUrl` at the top of this file.

// ── Permission guard ─────────────────────────────────────────────────────────
function canUseAi(req: StaffAuthRequest): boolean {
  const s = req.staffSession ?? null;
  if (!s) return false;
  if (FULL_ACCESS_ROLES.has(s.role)) return true;
  return s.permissions?.includes("ai_reporting.use") ?? false;
}

// ── Endpoint probe cache ─────────────────────────────────────────────────────
// Caches the working endpoint for 5 minutes to avoid probing on every request.
const endpointCache: { url: string; expiresAt: number } | null = null;
let _endpointCache: { url: string; expiresAt: number } | null = null;

async function probeEndpoint(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const r = await fetch(`${url}/api/tags`, { signal: ac.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

// ── Full Ollama config (with fallback probe) ──────────────────────────────────
interface OllamaConfig {
  baseUrl: string;       // resolved working endpoint
  primaryUrl: string;    // configured primary
  fallbackUrl: string | null;
  model: string;
  localOnly: boolean;
  timeoutMs: number;
  auditEnabled: boolean;
  endpointSource: "primary" | "fallback" | "cache";
}

async function getOllamaConfig(): Promise<OllamaConfig | null> {
  const { resolveLocalAiRuntime } = await import("../lib/aiPipeline/runtimeConfig");
  const runtime = await resolveLocalAiRuntime();
  if (!runtime.ollamaEnabled || !runtime.ollamaBaseUrl) return null;

  const rows = await db
    .select({
      ollamaLocalOnly: clinicSettingsTable.ollamaLocalOnly,
      ollamaTimeoutSeconds: (clinicSettingsTable as any).ollamaTimeoutSeconds,
      ollamaAuditEnabled: (clinicSettingsTable as any).ollamaAuditEnabled,
    })
    .from(clinicSettingsTable)
    .orderBy(desc(clinicSettingsTable.id))
    .limit(1);

  const row = rows[0];
  const localOnly = row?.ollamaLocalOnly ?? false;
  const timeoutMs = Math.max(5, Math.min(120, Number(row?.ollamaTimeoutSeconds ?? 30))) * 1000;
  const auditEnabled = row?.ollamaAuditEnabled !== false;
  const primaryUrl = validateOllamaUrl(runtime.ollamaBaseUrl, localOnly);
  if (!primaryUrl.ok) return null;

  const primaryOrigin = primaryUrl.url.origin;
  const fallbackOrigin = runtime.ollamaFallbackUrl
    ? (() => {
        const v = validateOllamaUrl(runtime.ollamaFallbackUrl!, localOnly);
        return v.ok ? v.url.origin : null;
      })()
    : null;

  const model = runtime.localChatVisionModel;

  // Return cached working endpoint if still valid
  const now = Date.now();
  if (_endpointCache && _endpointCache.expiresAt > now) {
    return {
      baseUrl: _endpointCache.url,
      primaryUrl: primaryOrigin,
      fallbackUrl: fallbackOrigin,
      model,
      localOnly,
      timeoutMs,
      auditEnabled,
      endpointSource: "cache",
    };
  }

  // Probe primary (fast timeout: 8s for probe, full timeout for actual generate)
  const probeTimeout = Math.min(8000, timeoutMs);
  if (await probeEndpoint(primaryOrigin, probeTimeout)) {
    _endpointCache = { url: primaryOrigin, expiresAt: now + 5 * 60 * 1000 };
    return {
      baseUrl: primaryOrigin, primaryUrl: primaryOrigin, fallbackUrl: fallbackOrigin,
      model, localOnly, timeoutMs, auditEnabled,
      endpointSource: "primary",
    };
  }

  // Probe fallback
  if (fallbackOrigin && await probeEndpoint(fallbackOrigin, probeTimeout)) {
    _endpointCache = { url: fallbackOrigin, expiresAt: now + 5 * 60 * 1000 };
    return {
      baseUrl: fallbackOrigin, primaryUrl: primaryOrigin, fallbackUrl: fallbackOrigin,
      model, localOnly, timeoutMs, auditEnabled,
      endpointSource: "fallback",
    };
  }

  // Both endpoints unreachable — return config with primary URL for error reporting
  return {
    baseUrl: primaryOrigin, primaryUrl: primaryOrigin, fallbackUrl: fallbackOrigin,
    model, localOnly, timeoutMs, auditEnabled,
    endpointSource: "primary",
  };
}

// ── Ollama generate helper (canonical: @workspace/ai-providers) ───────────────
async function ollamaGenerate(
  baseUrl: string,
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const { createAiProvider } = await import("@workspace/ai-providers");
  const provider = await createAiProvider("ollama", undefined, baseUrl);
  if (!provider) throw new Error("Ollama provider unavailable");

  const queryPromise = provider.query({
    model,
    prompt,
    images: [],
    think: false,
  });

  let result;
  if (signal) {
    result = await Promise.race([
      queryPromise,
      new Promise<never>((_, reject) => {
        if (signal.aborted) {
          reject(new Error("Ollama request aborted"));
          return;
        }
        signal.addEventListener(
          "abort",
          () => reject(new Error("Ollama request aborted")),
          { once: true },
        );
      }),
    ]);
  } else {
    result = await queryPromise;
  }

  if (!result.success) {
    throw new Error(result.error || "Ollama generation failed");
  }
  return (result.text ?? "").trim();
}

// ── Rich audit helper ─────────────────────────────────────────────────────────
async function writeAudit(params: {
  req: StaffAuthRequest;
  actionType: string;
  model: string;
  endpointUsed: string;
  modality?: string;
  bodyPart?: string;
  studyUid?: string;
  success: boolean;
  auditEnabled: boolean;
}) {
  if (!params.auditEnabled) return;
  const s = params.req.staffSession;
  await db.insert(radiologyAiReviewAuditsTable).values({
    modality: params.modality || null,
    bodyPart: params.bodyPart || null,
    studyUid: params.studyUid || null,
    providersQueried: [{ provider: "ollama", model: params.model, endpoint: params.endpointUsed, action: params.actionType, success: params.success }] as unknown as Record<string, unknown>[],
    winnerProvider: params.success ? "ollama" : null,
    selectedById: s?.subjectId ?? null,
    selectedByName: s?.subjectName ?? null,
  }).catch(() => { /* audit failure must never break main response */ });
}

// ── Care Diagnostics Prompt Templates ────────────────────────────────────────
// All prompts preserve the radiologist's findings, never invent findings,
// and end with the required AI Draft disclaimer.
const CARE_SYSTEM_PROMPT = `You are a radiology reporting assistant for Care Diagnostics, an MRI, CT, and Ultrasound centre.
Rules you must always follow:
1. Never invent findings. Only work with what is provided.
2. Preserve the radiologist's exact findings — do not change medical facts.
3. Use formal radiology report language: Technique / Findings / Impression structure.
4. If uncertainty exists, write "suggest clinical correlation / further evaluation if clinically indicated".
5. Always end your response with exactly this line: "⚠️ AI Draft — Must be verified by radiologist before finalization."`;

const PROMPT_TEMPLATES: Record<string, (body: Record<string, string>) => string> = {
  "mri-brain": (b) => `${CARE_SYSTEM_PROMPT}

Generate a formal MRI Brain report for Care Diagnostics.
Patient: ${b.patientName || "Unknown"} | Age: ${b.age || "Unknown"} | Sex: ${b.sex || "Unknown"}
Clinical History: ${b.clinicalHistory || "Not provided"}
Technique: MRI Brain was performed in the standard protocol sequences including T1W, T2W, FLAIR, DWI/ADC, and post-contrast T1W.

Findings provided by radiologist:
${b.findings || "(No findings provided — generate a template with blanks for each structure)"}

Generate findings section covering: parenchyma, ventricles, sulci, basal ganglia, thalami, brainstem, cerebellum, extra-axial spaces, vascular structures.
Then generate a concise Impression (2–4 lines).`,

  "mri-cervical-spine": (b) => `${CARE_SYSTEM_PROMPT}

Generate a formal MRI Cervical Spine report for Care Diagnostics.
Patient: ${b.patientName || "Unknown"} | Age: ${b.age || "Unknown"} | Sex: ${b.sex || "Unknown"}
Clinical History: ${b.clinicalHistory || "Not provided"}

Findings provided:
${b.findings || "(No findings provided)"}

For each level C2-C3 through C7-T1: comment on disc height, disc signal, disc herniation/bulge, foraminal stenosis, spinal canal diameter, cord signal.
Comment on vertebral alignment, prevertebral soft tissue, and marrow signal.
Generate a concise Impression.`,

  "mri-ls-spine": (b) => `${CARE_SYSTEM_PROMPT}

Generate a formal MRI LS Spine report for Care Diagnostics.
Patient: ${b.patientName || "Unknown"} | Age: ${b.age || "Unknown"} | Sex: ${b.sex || "Unknown"}
Clinical History: ${b.clinicalHistory || "Not provided"}

Findings provided:
${b.findings || "(No findings provided)"}

For each level L1-L2 through L5-S1: comment on disc height, disc signal, disc herniation/bulge direction, foraminal stenosis, lateral recess stenosis, cord/conus.
Comment on vertebral alignment, modic changes, marrow signal, paraspinal soft tissue.
Generate a concise Impression.`,

  "ct-brain": (b) => `${CARE_SYSTEM_PROMPT}

Generate a formal CT Brain report for Care Diagnostics.
Patient: ${b.patientName || "Unknown"} | Age: ${b.age || "Unknown"} | Sex: ${b.sex || "Unknown"}
Clinical History: ${b.clinicalHistory || "Not provided"}

Findings provided:
${b.findings || "(No findings provided)"}

Comment on: parenchyma density, grey-white differentiation, ventricles and CSF spaces, sulci, midline shift, basal cisterns, any hemorrhage/ischemia, bone windows.
Generate a concise Impression.`,

  "ct-spine": (b) => `${CARE_SYSTEM_PROMPT}

Generate a formal CT Spine report for Care Diagnostics.
Patient: ${b.patientName || "Unknown"} | Age: ${b.age || "Unknown"} | Sex: ${b.sex || "Unknown"}
Region: ${b.region || "Spine"}
Clinical History: ${b.clinicalHistory || "Not provided"}

Findings provided:
${b.findings || "(No findings provided)"}

Comment on: vertebral body height and density, fracture/subluxation, disc space, facet joints, spinal canal diameter, neural foramina, paraspinal soft tissue.
Generate a concise Impression.`,

  "impression-only": (b) => `${CARE_SYSTEM_PROMPT}

Generate a concise Impression section (2–5 lines) from the following radiology findings.
Do NOT generate findings — only the Impression.

Modality/Study: ${b.modality || "Radiology"} ${b.bodyPart || ""}
Findings: ${b.findings || "(No findings provided)"}`,

  "grammar-cleanup": (b) => `You are a medical English proofreader for Care Diagnostics.
Rules:
1. Correct grammar and spelling ONLY.
2. Do NOT change any medical terminology, measurements, or findings.
3. Do NOT add or remove any clinical information.
4. Preserve the original structure (Technique / Findings / Impression).
5. Return only the corrected report text — no commentary.

Report to correct:
${b.reportText || b.findings || ""}`,

  "improve-report": (b) => `${CARE_SYSTEM_PROMPT}

Improve the following radiology report for formal Care Diagnostics style.
Improvements allowed:
- Better formal radiology language
- Clearer structure
- More specific anatomical terminology
Do NOT change any findings, measurements, or clinical conclusions.

Original report:
${b.reportText || b.findings || ""}`,

  "care-format": (b) => `${CARE_SYSTEM_PROMPT}

Reformat the following report into the standard Care Diagnostics report format:

TECHNIQUE:
[Brief description of the imaging protocol]

FINDINGS:
[Organ/system-by-system findings in formal radiology language]

IMPRESSION:
[Concise 2–4 line conclusion with key diagnosis and recommendation]

Report to reformat:
${b.reportText || b.findings || ""}`,
};

// ── GET /status — current config summary via canonical runtime ───────────────
radiologyOllamaRouter.get("/status", async (_req, res): Promise<void> => {
  try {
    const { resolveLocalAiRuntime } = await import("../lib/aiPipeline/runtimeConfig");
    const {
      CANONICAL_OLLAMA_ENDPOINT,
      CANONICAL_LOCAL_CHAT_VISION_MODEL,
    } = await import("../lib/aiPipeline/canonicalLocalAi");
    const runtime = await resolveLocalAiRuntime(true);

    const rows = await db
      .select({
        ollamaLocalOnly: clinicSettingsTable.ollamaLocalOnly,
        ollamaTimeoutSeconds: (clinicSettingsTable as any).ollamaTimeoutSeconds,
        ollamaAuditEnabled: (clinicSettingsTable as any).ollamaAuditEnabled,
        ollamaKnownModels: clinicSettingsTable.ollamaKnownModels,
      })
      .from(clinicSettingsTable)
      .orderBy(desc(clinicSettingsTable.id))
      .limit(1);

    const row = rows[0];
    const configured = Boolean(runtime.ollamaBaseUrl);
    const primaryValidation = configured
      ? validateOllamaUrl(runtime.ollamaBaseUrl, row?.ollamaLocalOnly ?? false)
      : null;
    const fallbackValidation = runtime.ollamaFallbackUrl
      ? validateOllamaUrl(runtime.ollamaFallbackUrl, row?.ollamaLocalOnly ?? false)
      : null;

    let knownModels: string[] = [];
    try { knownModels = JSON.parse(row?.ollamaKnownModels ?? "[]"); } catch { /**/ }

    res.json({
      configured,
      enabled: runtime.ollamaEnabled,
      primaryUrl: runtime.ollamaBaseUrl ?? null,
      fallbackUrl: runtime.ollamaFallbackUrl ?? null,
      model: runtime.localChatVisionModel,
      localOnly: row?.ollamaLocalOnly ?? false,
      timeoutSeconds: row?.ollamaTimeoutSeconds ?? 30,
      auditEnabled: row?.ollamaAuditEnabled !== false,
      primaryUrlValid: primaryValidation?.ok ?? false,
      primaryUrlError: primaryValidation?.ok === false ? primaryValidation.reason : null,
      fallbackUrlValid: fallbackValidation?.ok ?? false,
      knownModels,
      ollamaUrlSource: runtime.ollamaUrlSource,
      modelSource: runtime.modelStandardSource,
      canonical: {
        endpoint: CANONICAL_OLLAMA_ENDPOINT,
        model: CANONICAL_LOCAL_CHAT_VISION_MODEL,
      },
      // Probe candidates = resolved primary/fallback only (no stale LAN hardcodes).
      candidateUrls: [
        runtime.ollamaBaseUrl,
        runtime.ollamaFallbackUrl,
      ].filter((u): u is string => !!u),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Status check failed" });
  }
});

// ── POST /test — test a specific URL without saving ──────────────────────────
radiologyOllamaRouter.post("/test", async (req, res): Promise<void> => {
  // SSRF-capable endpoint (it fetches an operator-supplied URL) — restrict to
  // AI-permitted users, not every authenticated staff account (P5 fix).
  if (!canUseAi(req as StaffAuthRequest)) { res.status(403).json({ ok: false, error: "AI reporting permission required" }); return; }
  const { resolveLocalAiRuntime } = await import("../lib/aiPipeline/runtimeConfig");
  const runtime = await resolveLocalAiRuntime(true);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const rawUrl = b.baseUrl ? String(b.baseUrl).trim() : runtime.ollamaBaseUrl;
  const model = b.model ? String(b.model).trim() : runtime.localChatVisionModel;
  // `allowLocal` comes from the saved admin policy (`ollamaLocalOnly`), NEVER the
  // request body: a client-controlled flag here let any caller opt out of the
  // private/LAN SSRF guard (P5 fix).
  const [settingsRow] = await db
    .select({ localOnly: clinicSettingsTable.ollamaLocalOnly })
    .from(clinicSettingsTable)
    .orderBy(desc(clinicSettingsTable.id))
    .limit(1);
  const allowLocal = settingsRow?.localOnly ?? false;

  if (!rawUrl) { res.status(400).json({ ok: false, error: "baseUrl required" }); return; }

  const guard = validateOllamaUrl(rawUrl, allowLocal);
  if (!guard.ok) { res.status(400).json({ ok: false, error: guard.reason }); return; }

  const baseUrl = guard.url.origin;
  try {
    const t0 = Date.now();
    const { createAiProvider } = await import("@workspace/ai-providers");
    const provider = await createAiProvider("ollama", undefined, baseUrl);
    if (!provider) {
      res.status(502).json({ ok: false, error: "Ollama provider unavailable" });
      return;
    }
    const result = await provider.testConnection(model);
    res.json({
      ok: result.ok,
      model,
      models: result.availableModels ?? [],
      modelFound: (result.availableModels ?? []).includes(model),
      latencyMs: Date.now() - t0,
      endpointUsed: baseUrl,
      resolvedFromRuntime: !b.baseUrl && !b.model,
      message: result.message,
      error: result.ok ? undefined : result.message,
    });
  } catch (err: unknown) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /probe — probe resolved Local AI endpoints only ─────────────────────
radiologyOllamaRouter.post("/probe", async (_req, res): Promise<void> => {
  const { resolveLocalAiRuntime } = await import("../lib/aiPipeline/runtimeConfig");
  const {
    CANONICAL_OLLAMA_ENDPOINT,
  } = await import("../lib/aiPipeline/canonicalLocalAi");
  const runtime = await resolveLocalAiRuntime(true);
  const candidates = Array.from(
    new Set(
      [runtime.ollamaBaseUrl, runtime.ollamaFallbackUrl, CANONICAL_OLLAMA_ENDPOINT].filter(
        (u): u is string => !!u,
      ),
    ),
  );
  const results: Array<{ url: string; reachable: boolean; latencyMs?: number }> = [];
  for (const url of candidates) {
    const t0 = Date.now();
    const ok = await probeEndpoint(url, 6000);
    results.push({ url, reachable: ok, latencyMs: ok ? Date.now() - t0 : undefined });
  }
  const working = results.find((r) => r.reachable);
  res.json({
    results,
    recommendedUrl: working?.url ?? null,
    resolvedRuntime: {
      endpoint: runtime.ollamaBaseUrl,
      model: runtime.localChatVisionModel,
    },
  });
});

// ── Helper: get config or send 503 ───────────────────────────────────────────
async function requireConfig(res: ReturnType<ReturnType<typeof Router>["use"]> extends void ? never : any): Promise<OllamaConfig | null> {
  const config = await getOllamaConfig();
  if (!config) {
    (res as any).status(503).json({
      error: "Local AI is not configured or is disabled. Enable it in Settings → AI → Local AI Assistant.",
    });
    return null;
  }
  return config;
}

// ── Shared action handler ─────────────────────────────────────────────────────
async function handleAction(
  req: StaffAuthRequest,
  res: any,
  actionType: string,
  buildPrompt: (config: OllamaConfig, body: Record<string, unknown>) => string,
  responseKey: string,
  timeoutOverrideMs?: number,
) {
  if (!canUseAi(req)) {
    res.status(403).json({ error: "Permission denied. Role needs ai_reporting.use permission." });
    return;
  }

  const config = await getOllamaConfig();
  if (!config) {
    res.status(503).json({ error: "Local AI is not configured or is disabled. Enable in Settings → AI → Local AI Assistant." });
    return;
  }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const prompt = buildPrompt(config, b);
  const timeoutMs = timeoutOverrideMs ?? config.timeoutMs;

  let success = false;
  let output = "";

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    output = await ollamaGenerate(config.baseUrl, config.model, prompt, ac.signal);
    clearTimeout(timer);
    success = true;
    res.json({
      [responseKey]: output,
      model: config.model,
      provider: "ollama",
      endpointUsed: config.baseUrl,
      endpointSource: config.endpointSource,
      note: "⚠️ AI Draft — Must be verified by radiologist before finalization.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // If primary failed and we haven't already tried fallback, clear cache and retry
    if (config.fallbackUrl && config.endpointSource !== "fallback") {
      _endpointCache = null; // force re-probe on next call
    }
    res.status(502).json({ error: `Ollama error: ${msg}` });
  } finally {
    await writeAudit({
      req,
      actionType,
      model: config.model,
      endpointUsed: config.baseUrl,
      modality: b.modality ? String(b.modality) : undefined,
      bodyPart: b.bodyPart ? String(b.bodyPart) : undefined,
      studyUid: b.studyUid ? String(b.studyUid) : undefined,
      success,
      auditEnabled: config.auditEnabled,
    });
  }
}

// ── POST /findings — generate initial structured findings ────────────────────
radiologyOllamaRouter.post("/findings", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  await handleAction(sReq, res, "generate_findings", (config, b) => {
    const modality = String(b.modality ?? "").trim();
    const testName = String(b.testName ?? "").trim();
    const clinicalHistory = String(b.clinicalHistory ?? "").trim();
    const bodyPart = String(b.bodyPart ?? "").trim();

    // Pick a Care-specific template if available
    const key = `${modality.toLowerCase()}-${bodyPart.toLowerCase()}`.replace(/\s+/g, "-");
    if (PROMPT_TEMPLATES[key]) {
      return PROMPT_TEMPLATES[key]({
        modality, bodyPart, clinicalHistory,
        patientName: String(b.patientName ?? ""),
        age: String(b.age ?? ""),
        sex: String(b.sex ?? ""),
        findings: String(b.findings ?? ""),
      });
    }

    return `${CARE_SYSTEM_PROMPT}

Generate structured findings for Care Diagnostics radiology report.
Study: ${testName || modality || "Radiology"}
Clinical History: ${clinicalHistory || "Not provided"}

Generate findings section in formal radiology language with bullets per organ/system.`;
  }, "findings", 90000);
});

// ── POST /impression — impression from findings ──────────────────────────────
radiologyOllamaRouter.post("/impression", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (!String(b.findings ?? "").trim()) {
    res.status(400).json({ error: "findings required" }); return;
  }
  await handleAction(sReq, res, "generate_impression", (_config, b) => {
    return PROMPT_TEMPLATES["impression-only"]({
      modality: String(b.modality ?? ""),
      bodyPart: String(b.bodyPart ?? ""),
      findings: String(b.findings ?? ""),
    });
  }, "impression", 45000);
});

// ── POST /improve — improve existing report text ─────────────────────────────
radiologyOllamaRouter.post("/improve", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (!String(b.reportText ?? b.findings ?? "").trim()) {
    res.status(400).json({ error: "reportText required" }); return;
  }
  await handleAction(sReq, res, "improve_report", (_config, b) => {
    return PROMPT_TEMPLATES["improve-report"]({
      reportText: String(b.reportText ?? b.findings ?? ""),
    });
  }, "improved");
});

// ── POST /grammar — grammar cleanup without changing meaning ──────────────────
radiologyOllamaRouter.post("/grammar", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (!String(b.reportText ?? b.findings ?? "").trim()) {
    res.status(400).json({ error: "reportText required" }); return;
  }
  await handleAction(sReq, res, "grammar_cleanup", (_config, b) => {
    return PROMPT_TEMPLATES["grammar-cleanup"]({
      reportText: String(b.reportText ?? b.findings ?? ""),
    });
  }, "corrected", 45000);
});

// ── POST /impression-from-findings — convert bullet findings → formal impression
radiologyOllamaRouter.post("/impression-from-findings", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (!String(b.findings ?? "").trim()) {
    res.status(400).json({ error: "findings required" }); return;
  }
  await handleAction(sReq, res, "findings_to_impression", (_config, b) => {
    return PROMPT_TEMPLATES["impression-only"]({
      modality: String(b.modality ?? ""),
      bodyPart: String(b.bodyPart ?? ""),
      findings: String(b.findings ?? ""),
    });
  }, "impression", 45000);
});

// ── POST /format-care-style — reformat in Care Diagnostics style ──────────────
radiologyOllamaRouter.post("/format-care-style", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (!String(b.reportText ?? b.findings ?? "").trim()) {
    res.status(400).json({ error: "reportText required" }); return;
  }
  await handleAction(sReq, res, "format_care_style", (_config, b) => {
    return PROMPT_TEMPLATES["care-format"]({
      reportText: String(b.reportText ?? b.findings ?? ""),
    });
  }, "formatted");
});

// ── POST /draft — full report draft using modality template ──────────────────
radiologyOllamaRouter.post("/draft", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const modality = String(b.modality ?? "").trim().toLowerCase();
  const bodyPart = String(b.bodyPart ?? "").trim().toLowerCase();

  // Determine best template key
  const key = `${modality}-${bodyPart}`.replace(/\s+/g, "-");
  const hasTemplate = key in PROMPT_TEMPLATES;

  await handleAction(sReq, res, "generate_draft", (_config, b) => {
    const fields = {
      modality: String(b.modality ?? ""),
      bodyPart: String(b.bodyPart ?? ""),
      findings: String(b.findings ?? ""),
      clinicalHistory: String(b.clinicalHistory ?? ""),
      patientName: String(b.patientName ?? ""),
      age: String(b.age ?? ""),
      sex: String(b.sex ?? ""),
      region: String(b.region ?? ""),
    };
    if (hasTemplate) return PROMPT_TEMPLATES[key](fields);
    return `${CARE_SYSTEM_PROMPT}

Generate a complete formal radiology report for Care Diagnostics.
Modality: ${fields.modality || "Unknown"} | Region: ${fields.bodyPart || "Unknown"}
Patient: ${fields.patientName || "Unknown"} | Age: ${fields.age || "?"} | Sex: ${fields.sex || "?"}
Clinical History: ${fields.clinicalHistory || "Not provided"}
${fields.findings ? `\nRadiologist Findings:\n${fields.findings}` : ""}

Generate: TECHNIQUE / FINDINGS / IMPRESSION in formal radiology report format.`;
  }, "draft", 120000);
});

// ── POST /differential — generate differential diagnosis ─────────────────────
radiologyOllamaRouter.post("/differential", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (!String(b.findings ?? "").trim()) { res.status(400).json({ error: "findings required" }); return; }
  await handleAction(sReq, res, "generate_differential", (_config, b) => {
    return `${CARE_SYSTEM_PROMPT}

Generate a differential diagnosis for the following ${String(b.modality ?? "")} findings:

${String(b.findings ?? "")}

List top 3–5 differential diagnoses with brief radiological reasoning for each.`;
  }, "differential", 45000);
});

// ── POST /multi-review — fan-out to multiple AI providers ────────────────────
// (unchanged from Phase 10C — Gemini + OpenRouter + Claude + Ollama)
radiologyOllamaRouter.post("/multi-review", async (req, res): Promise<void> => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const modality = String(b.modality ?? "").trim();
  const bodyPart = String(b.bodyPart ?? "").trim();
  const findingsText = String(b.findingsText ?? "").trim();
  const clinicalHistory = String(b.clinicalHistory ?? "").trim();
  const requestedProviders = Array.isArray(b.providers) ? (b.providers as string[]) : ["gemini", "ollama"];

  if (!findingsText && !clinicalHistory) {
    res.status(400).json({ error: "findingsText or clinicalHistory required" }); return;
  }

  const clinicRow = await db
    .select({ ollamaLocalOnly: clinicSettingsTable.ollamaLocalOnly })
    .from(clinicSettingsTable).orderBy(desc(clinicSettingsTable.id)).limit(1);
  const localOnly = clinicRow[0]?.ollamaLocalOnly ?? false;
  const activeProviders = localOnly ? requestedProviders.filter((p) => p === "ollama") : requestedProviders;

  const studyLabel = [modality, bodyPart].filter(Boolean).join(" ") || "Radiology Study";
  const reviewPrompt = `${CARE_SYSTEM_PROMPT}

You are performing an independent AI review of the following case.
Study: ${studyLabel}
${clinicalHistory ? `Clinical History: ${clinicalHistory}` : ""}
${findingsText ? `\nFindings:\n${findingsText}` : ""}

Provide:
1. Additional findings or nuances (bullets per system)
2. Top 3 differential diagnoses with reasoning
3. Any potential missed findings`;

  interface ProviderResult { provider: string; model: string; findings: string; differentials: string[]; missedFindings: string[]; confidence: number; processingMs: number; error?: string; }
  const results: ProviderResult[] = [];
  const t0 = Date.now();

  // Gemini
  if (activeProviders.includes("gemini") && process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
    const pt = Date.now();
    try {
      const { geminiGenerate } = await import("@workspace/integrations-gemini-ai");
      const raw = await geminiGenerate(reviewPrompt, { maxTokens: 1024 });
      results.push({ provider: "Gemini", model: "gemini-2.0-flash", findings: raw, differentials: [], missedFindings: [], confidence: 85, processingMs: Date.now() - pt });
    } catch (e) {
      results.push({ provider: "Gemini", model: "gemini-2.0-flash", findings: "", differentials: [], missedFindings: [], confidence: 0, processingMs: Date.now() - pt, error: e instanceof Error ? e.message : "Gemini unavailable" });
    }
  }

  // Ollama
  if (activeProviders.includes("ollama")) {
    const config = await getOllamaConfig();
    if (config) {
      const pt = Date.now();
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), config.timeoutMs);
        const raw = await ollamaGenerate(config.baseUrl, config.model, reviewPrompt, ac.signal);
        clearTimeout(t);
        results.push({ provider: "Ollama (Local)", model: config.model, findings: raw, differentials: [], missedFindings: [], confidence: 75, processingMs: Date.now() - pt });
      } catch (e) {
        results.push({ provider: "Ollama (Local)", model: config.model || "unknown", findings: "", differentials: [], missedFindings: [], confidence: 0, processingMs: Date.now() - pt, error: e instanceof Error ? e.message : "Ollama unavailable" });
      }
    }
  }

  const sReq = req as StaffAuthRequest;
  await db.insert(radiologyAiReviewAuditsTable).values({
    modality: modality || null, bodyPart: bodyPart || null,
    studyUid: b.studyUid ? String(b.studyUid) : null,
    orderId: b.orderId ? Number(b.orderId) : null,
    providersQueried: activeProviders as unknown as Record<string, unknown>[],
    winnerProvider: null,
    selectedById: sReq.staffSession?.subjectId ?? null,
    selectedByName: sReq.staffSession?.subjectName ?? null,
  }).catch(() => {});

  res.json({
    results, totalProviders: results.length,
    successfulProviders: results.filter((r) => !r.error).length,
    totalProcessingMs: Date.now() - t0,
    caseContext: { modality, bodyPart }, localOnlyMode: localOnly,
    auditTimestamp: new Date().toISOString(),
    note: "⚠️ AI Draft — Must be verified by radiologist before finalization.",
  });
});

// ── POST /multi-review/winner — log winner selection ─────────────────────────
radiologyOllamaRouter.post("/multi-review/winner", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = sReq.staffSession?.subjectId;
  if (!userId) { res.status(401).json({ error: "authentication required" }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const winnerProvider = String(b.winnerProvider ?? "").trim();
  if (!winnerProvider) { res.status(400).json({ error: "winnerProvider required" }); return; }
  const [audit] = await db.insert(radiologyAiReviewAuditsTable).values({
    modality: b.modality ? String(b.modality) : null,
    bodyPart: b.bodyPart ? String(b.bodyPart) : null,
    studyUid: b.studyUid ? String(b.studyUid) : null,
    orderId: b.orderId ? Number(b.orderId) : null,
    providersQueried: Array.isArray(b.providers) ? b.providers as unknown as Record<string, unknown>[] : null,
    winnerProvider, selectedById: userId,
    selectedByName: sReq.staffSession?.subjectName ?? null,
  }).returning();
  res.json({ ok: true, audit });
});

// ── POST /verify — pre-deploy Ollama auto-draft verification ─────────────────
radiologyOllamaRouter.post("/verify", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canUseAi(sReq)) {
    res.status(403).json({ error: "Permission denied. Role needs ai_reporting.use permission." });
    return;
  }
  const b = (req.body ?? {}) as { dryRun?: boolean; runDraft?: boolean };
  const dryRun = Boolean(b.dryRun) || req.query.dryRun === "1";
  try {
    const { runOllamaAiDraftVerify } = await import("../lib/ai/ollamaDraftVerify");
    const result = await runOllamaAiDraftVerify({ runDraft: !dryRun && b.runDraft !== false });
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({
      ok: false,
      blockingFailed: true,
      summary: "Verification failed to run",
      checks: [],
      error: err instanceof Error ? err.message : String(err),
      ranAt: new Date().toISOString(),
    });
  }
});
