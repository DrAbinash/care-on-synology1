/**
 * Voice Report Composer API — structured change plans, no direct report mutation.
 * Also owns the Smart Dictation custom-findings vocabulary (CRUD below):
 * the radiologist authors NEW findings from Settings → Radiology → Voice, and
 * every dictation turn merges them with the built-in phrase catalog.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { radiologySmartDictationPhrasesTable } from "@workspace/db";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import {
  composeVoiceChangePlan,
  deterministicCompose,
  SYNTHETIC_TEST_TRANSCRIPT,
} from "../lib/voiceReportComposer/composer";
import { resolveComposerRuntime } from "../lib/voiceReportComposer/runtimeConfig";
import { validateChangePlan } from "../lib/voiceReportComposer/validator";
import { newComposerRequestId } from "../lib/voiceReportComposer/diagnostics";
import { builtInConcepts, matchCatalogPhrases } from "../lib/voiceReportComposer/phraseCatalog";
import {
  loadCustomPhrases,
  listAllCustomPhraseRows,
  splitCommaField,
  SMART_DICTATION_FAMILIES,
} from "../lib/voiceReportComposer/customPhrases";
import type { VoiceObservation } from "../lib/voiceReportComposer/schema";

export const voiceReportComposerRouter = Router();

function canUse(req: StaffAuthRequest): boolean {
  const s = req.staffSession;
  if (!s) return false;
  if (FULL_ACCESS_ROLES.has(s.role)) return true;
  return s.permissions?.includes("ai_reporting.use") ?? false;
}

function canManage(req: StaffAuthRequest): boolean {
  return FULL_ACCESS_ROLES.has(req.staffSession?.role ?? "");
}

/** Slug-ify a label into a concept key the doctor didn't write themselves. */
function slugifyConcept(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

type PhraseWriteBody = {
  label?: unknown;
  concept?: unknown;
  families?: unknown;
  synonyms?: unknown;
  findingsText?: unknown;
  impressionText?: unknown;
  anatomicalSection?: unknown;
  conflictGroup?: unknown;
  baselineReplaces?: unknown;
  enabled?: unknown;
};

/** Validate + normalize a create/update payload. Returns [values | null, error]. */
function validatePhraseBody(
  b: PhraseWriteBody,
  opts: { requireCore: boolean },
): [Record<string, unknown> | null, string] {
  const label = String(b.label ?? "").trim();
  const conceptRaw = String(b.concept ?? "").trim().toLowerCase() || slugifyConcept(label);
  const findingsText = String(b.findingsText ?? "").trim();
  const synonyms = splitCommaField(String(b.synonyms ?? ""));
  const families = splitCommaField(String(b.families ?? "")).filter((f) =>
    (SMART_DICTATION_FAMILIES as readonly string[]).includes(f),
  );

  if (opts.requireCore) {
    if (!label) return [null, "label is required"];
    if (!/^[a-z][a-z0-9_]*$/.test(conceptRaw)) {
      return [null, "concept must be lowercase letters, digits and underscores"];
    }
    if (!synonyms.length) return [null, "at least one synonym is required"];
    if (!findingsText) return [null, "findingsText is required"];
    if (!families.length) return [null, "at least one exam family is required"];
    if (builtInConcepts().includes(conceptRaw)) {
      return [null, `concept "${conceptRaw}" is already a built-in finding — choose a different name`];
    }
  }
  if (families.length && families.length !== splitCommaField(String(b.families ?? "")).length) {
    return [null, "families must be a subset of brain, lumbar, cervical, dorsal"];
  }
  return [{
    concept: conceptRaw || undefined,
    label: label || undefined,
    families: families.join(","),
    synonyms: synonyms.join(","),
    findingsText: findingsText || undefined,
    impressionText: String(b.impressionText ?? "").trim(),
    anatomicalSection: String(b.anatomicalSection ?? "").trim(),
    conflictGroup: String(b.conflictGroup ?? "").trim(),
    baselineReplaces: String(b.baselineReplaces ?? "").trim(),
  }, ""];
}

voiceReportComposerRouter.post("/compose", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "AI reporting permission required" });
    return;
  }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const transcript = String(b.transcript ?? "").trim();
  if (!transcript) {
    res.status(400).json({ ok: false, error: "transcript required" });
    return;
  }

  const requestId = newComposerRequestId();
  const priorObservations = Array.isArray(b.priorObservations)
    ? (b.priorObservations as VoiceObservation[])
    : undefined;

  // The doctor's custom findings join the vocabulary for this turn (Settings →
  // Radiology → Voice). A read failure degrades to built-in-only inside the
  // loader — dictation never fails because the custom table was unreadable.
  const customPhrases = await loadCustomPhrases();

  const result = await composeVoiceChangePlan({
    modality: b.modality ? String(b.modality) : undefined,
    region: b.region ? String(b.region) : undefined,
    reportTitle: b.reportTitle ? String(b.reportTitle) : undefined,
    findingsText: b.findingsText ? String(b.findingsText) : undefined,
    impressionText: b.impressionText ? String(b.impressionText) : undefined,
    techniqueText: b.techniqueText ? String(b.techniqueText) : undefined,
    transcript,
    priorTranscript: b.priorTranscript ? String(b.priorTranscript) : undefined,
    priorObservations,
    generateImpressionOnly: b.generateImpressionOnly === true,
    customPhrases,
  }, {
    requestId,
    usePhraseFallback: b.usePhraseFallback === true,
  });

  if (!result.ok) {
    res.json({
      ok: false,
      error: result.error,
      diagnostics: result.diagnostics,
      phraseFallbackAvailable: !b.usePhraseFallback,
    });
    return;
  }

  const fieldProvenance = b.fieldProvenance as {
    findings?: Record<string, string[]>;
    impression?: Record<string, string[]>;
  } | undefined;

  const clientValidation = validateChangePlan({
    plan: result.plan!,
    findingsText: String(b.findingsText ?? ""),
    impressionText: String(b.impressionText ?? ""),
    fieldProvenance: fieldProvenance as Parameters<typeof validateChangePlan>[0]["fieldProvenance"],
    protectedQuickFindingLabels: Array.isArray(b.protectedQuickFindingLabels)
      ? (b.protectedQuickFindingLabels as string[])
      : undefined,
    generateImpressionOnly: b.generateImpressionOnly === true,
  });

  if (!clientValidation.ok) {
    res.json({
      ok: false,
      error: clientValidation.reason ?? "Validation failed",
      diagnostics: result.diagnostics,
      phraseFallbackAvailable: false,
    });
    return;
  }

  res.json({
    ok: true,
    plan: result.plan,
    diagnostics: result.diagnostics,
    provenance: {
      source: "radiologist-voice",
      composer: result.diagnostics?.phraseFallback ? "phrase_catalog" : "local_ai",
      model: result.diagnostics?.model,
      fallbackUsed: result.diagnostics?.fallbackUsed ?? false,
      requestId,
    },
  });
});

/** Safe test — synthetic non-PHI transcript only. */
voiceReportComposerRouter.post("/test", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "AI reporting permission required" });
    return;
  }

  const requestId = newComposerRequestId();
  const runtime = await resolveComposerRuntime(true);
  const region = String((req.body as Record<string, unknown>)?.region ?? "LS Spine");
  const t0 = Date.now();

  const result = await composeVoiceChangePlan({
    transcript: SYNTHETIC_TEST_TRANSCRIPT,
    region,
    modality: "MR",
    findingsText: "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained.",
    generateImpressionOnly: (req.body as Record<string, unknown>)?.generateImpressionOnly === true,
  }, { requestId });

  res.json({
    ok: result.ok,
    endpoint: runtime.endpoint,
    endpointSource: runtime.endpointSource,
    model: result.diagnostics?.model ?? runtime.model,
    visionModel: runtime.visionModel,
    composerModel: runtime.model,
    configured: runtime.enabled,
    schemaValid: result.diagnostics?.schemaOk ?? false,
    validationOk: result.diagnostics?.validationOk ?? false,
    latencyMs: result.diagnostics?.latencyMs ?? Date.now() - t0,
    validationMs: result.diagnostics?.validationMs ?? 0,
    requestId,
    error: result.error,
    phraseFallback: result.diagnostics?.phraseFallback ?? false,
  });
});

/** Admin benchmark — deterministic catalog only (offline). */
voiceReportComposerRouter.post("/benchmark", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "AI reporting permission required" });
    return;
  }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const models = Array.isArray(b.models) ? (b.models as string[]).slice(0, 2) : [];
  if (models.length < 2) {
    res.status(400).json({ ok: false, error: "Provide models array with 2 model names" });
    return;
  }

  const region = String(b.region ?? "LS Spine");
  const findingsText =
    "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained.";

  const results = models.map((model) => {
    const t0 = Date.now();
    const det = deterministicCompose({
      transcript: SYNTHETIC_TEST_TRANSCRIPT,
      region,
      findingsText,
    });
    const valid = det && !det.clarificationRequired && validateChangePlan({
      plan: det,
      findingsText,
      impressionText: "",
    }).ok;
    return {
      model,
      latencyMs: Date.now() - t0,
      schemaValid: valid,
      note: "Offline phrase-catalog benchmark — live Ollama comparison requires configured endpoint",
    };
  });

  res.json({ ok: true, results });
});

voiceReportComposerRouter.get("/config", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ error: "AI reporting permission required" });
    return;
  }
  const runtime = await resolveComposerRuntime(true);
  res.json({
    enabled: runtime.enabled,
    endpoint: runtime.endpoint,
    endpointSource: runtime.endpointSource,
    visionModel: runtime.visionModel,
    composerModel: runtime.model,
    composerFallbackModel: runtime.fallbackModel,
    numCtx: runtime.numCtx,
    temperature: runtime.temperature,
    timeoutSeconds: runtime.timeoutMs / 1000,
  });
});

// ── Smart Dictation custom findings (Settings → Radiology → Voice) ──────────
// The radiologist's own dictation vocabulary. Reads are open to anyone who can
// dictate (ai_reporting.use); writes are admin/super-admin only — the same
// authority split the PACS settings use. Nothing here can override a built-in
// finding's wording: validatePhraseBody rejects a concept collision, and the
// stored findings sentence prints verbatim, never rewritten by any model.

voiceReportComposerRouter.get("/phrases", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "AI reporting permission required" });
    return;
  }
  try {
    const rows = await listAllCustomPhraseRows();
    res.json({ ok: true, rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "list failed" });
  }
});

voiceReportComposerRouter.post("/phrases", async (req, res): Promise<void> => {
  const staffReq = req as StaffAuthRequest;
  if (!canManage(staffReq)) {
    res.status(403).json({ ok: false, error: "Admin or super-admin access required to modify the dictation vocabulary" });
    return;
  }
  const [values, error] = validatePhraseBody((req.body ?? {}) as PhraseWriteBody, { requireCore: true });
  if (!values) {
    res.status(400).json({ ok: false, error });
    return;
  }
  try {
    const [existing] = await db
      .select({ id: radiologySmartDictationPhrasesTable.id })
      .from(radiologySmartDictationPhrasesTable)
      .where(eq(radiologySmartDictationPhrasesTable.concept, values.concept as string))
      .limit(1);
    if (existing) {
      res.status(409).json({ ok: false, error: `finding "${values.concept}" already exists` });
      return;
    }
    const [row] = await db
      .insert(radiologySmartDictationPhrasesTable)
      .values({
        concept: values.concept as string,
        label: values.label as string,
        families: values.families as string,
        synonyms: values.synonyms as string,
        findingsText: values.findingsText as string,
        impressionText: values.impressionText as string,
        anatomicalSection: values.anatomicalSection as string,
        conflictGroup: values.conflictGroup as string,
        baselineReplaces: values.baselineReplaces as string,
        enabled: true,
      })
      .returning();
    res.json({ ok: true, row });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "create failed" });
  }
});

voiceReportComposerRouter.patch("/phrases/:id", async (req, res): Promise<void> => {
  const staffReq = req as StaffAuthRequest;
  if (!canManage(staffReq)) {
    res.status(403).json({ ok: false, error: "Admin or super-admin access required to modify the dictation vocabulary" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, error: "invalid id" });
    return;
  }
  const body = (req.body ?? {}) as PhraseWriteBody;

  // Enable/disable toggle without the full payload: only `enabled` present.
  if (Object.keys(body).length === 1 && "enabled" in body) {
    try {
      const [row] = await db
        .update(radiologySmartDictationPhrasesTable)
        .set({ enabled: body.enabled === true })
        .where(eq(radiologySmartDictationPhrasesTable.id, id))
        .returning();
      if (!row) {
        res.status(404).json({ ok: false, error: "finding not found" });
        return;
      }
      res.json({ ok: true, row });
      return;
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "update failed" });
      return;
    }
  }

  const [existing] = await db
    .select()
    .from(radiologySmartDictationPhrasesTable)
    .where(eq(radiologySmartDictationPhrasesTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ ok: false, error: "finding not found" });
    return;
  }
  const merged: PhraseWriteBody = {
    label: body.label ?? existing.label,
    concept: body.concept ?? existing.concept,
    families: body.families ?? existing.families,
    synonyms: body.synonyms ?? existing.synonyms,
    findingsText: body.findingsText ?? existing.findingsText,
    impressionText: body.impressionText ?? existing.impressionText,
    anatomicalSection: body.anatomicalSection ?? existing.anatomicalSection,
    conflictGroup: body.conflictGroup ?? existing.conflictGroup,
    baselineReplaces: body.baselineReplaces ?? existing.baselineReplaces,
  };
  const [values, error] = validatePhraseBody(merged, { requireCore: true });
  if (!values) {
    res.status(400).json({ ok: false, error });
    return;
  }
  // Concept rename must not collide with a different stored finding.
  if (values.concept !== existing.concept) {
    const [clash] = await db
      .select({ id: radiologySmartDictationPhrasesTable.id })
      .from(radiologySmartDictationPhrasesTable)
      .where(eq(radiologySmartDictationPhrasesTable.concept, values.concept as string))
      .limit(1);
    if (clash) {
      res.status(409).json({ ok: false, error: `finding "${values.concept}" already exists` });
      return;
    }
  }
  try {
    const [row] = await db
      .update(radiologySmartDictationPhrasesTable)
      .set({
        concept: values.concept as string,
        label: values.label as string,
        families: values.families as string,
        synonyms: values.synonyms as string,
        findingsText: values.findingsText as string,
        impressionText: values.impressionText as string,
        anatomicalSection: values.anatomicalSection as string,
        conflictGroup: values.conflictGroup as string,
        baselineReplaces: values.baselineReplaces as string,
      })
      .where(eq(radiologySmartDictationPhrasesTable.id, id))
      .returning();
    res.json({ ok: true, row });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "update failed" });
  }
});

voiceReportComposerRouter.delete("/phrases/:id", async (req, res): Promise<void> => {
  const staffReq = req as StaffAuthRequest;
  if (!canManage(staffReq)) {
    res.status(403).json({ ok: false, error: "Admin or super-admin access required to modify the dictation vocabulary" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, error: "invalid id" });
    return;
  }
  try {
    const [row] = await db
      .delete(radiologySmartDictationPhrasesTable)
      .where(eq(radiologySmartDictationPhrasesTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ ok: false, error: "finding not found" });
      return;
    }
    res.json({ ok: true, deleted: row.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "delete failed" });
  }
});

/**
 * Offline preview — "if I dictate this, what prints?" Runs the SAME literal
 * synonym match the composer runs against the CURRENT vocabulary (built-in +
 * enabled custom) for the chosen family, with no Ollama involvement: the
 * settings panel shows the doctor exactly the sentence a dictation will write
 * before they ever dictate it.
 */
voiceReportComposerRouter.post("/phrases/preview", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "AI reporting permission required" });
    return;
  }
  const b = (req.body ?? {}) as { sample?: unknown; families?: unknown };
  const sample = String(b.sample ?? "").trim();
  if (!sample) {
    res.status(400).json({ ok: false, error: "sample text required" });
    return;
  }
  const customPhrases = await loadCustomPhrases();
  const fams = splitCommaField(String(b.families ?? "lumbar"));
  const scoped = customPhrases.filter((p) =>
    !p.families?.length || p.families.some((f) => fams.includes(f)),
  );
  // Custom matches first so the doctor immediately sees their own finding; the
  // built-in pass below says "this ALSO matches a shipped tile" when true.
  const customHits = scoped.filter((p) => p.patterns.some((re) => re.test(sample)));
  const builtInHits = matchCatalogPhrases(sample);
  res.json({
    ok: true,
    matches: customHits.map((p) => ({ concept: p.concept, findingsText: p.findingsText, impressionText: p.impressionText ?? "" })),
    builtInMatches: builtInHits.map((p) => ({ concept: p.concept, findingsText: p.findingsText })),
  });
});
