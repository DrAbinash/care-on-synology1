/**
 * AI Radiology Reporting routes
 *
 * Security model:
 *  - All routes require requireStaffAuth (enforced at mount in routes/index.ts)
 *  - GET/POST /settings + GET /audit-log require canConfigure (admin/superadmin
 *    or "ai_reporting.configure" permission)
 *  - POST /query, POST /drafts, POST /insert-to-report require canUse
 *    (FULL_ACCESS_ROLES or "ai_reporting.use") filtered by allowedRoles global setting
 *  - API keys AES-256-CBC encrypted at rest; never returned to frontend
 *  - All AI calls go through this backend — never directly from the browser
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  aiProviderSettingsTable,
  aiReportingAuditLogsTable,
  aiReportingDraftsTable,
  aiPromptTemplatesTable,
  pacsSettingsTable,
  patientsTable,
  aiDicomFindingsTable,
  ragDocumentEmbeddingsTable,
  ragSearchQueriesTable,
  anomalyAlertsTable,
  reportTemplateVersionsTable,
  aiBillingSuggestionsTable,
  peerReviewAssignmentsTable,
  turnaroundTimesTable,
  aiTrainingDataExportsTable,
  reportQualityGatesTable,
  criticalFindingsTable,
  aiProviderHealthLogsTable,
  aiVoiceTranscriptionsTable,
  aiPatientCommunicationsTable,
  aiNormalReportTemplatesTable,
  patientReportsTable,
  radiologyStudiesTable,
  clinicSettingsTable,
} from "@workspace/db";
import { eq, and, desc, gte, lte, sql, inArray } from "drizzle-orm";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import { encryptSecret } from "../lib/cryptoUtils";
import { embedText, parseEmbedding, serializeEmbedding, cosineSimilarity, isEmbeddingAvailable } from "../lib/ai/embeddings";
import {
  BUILTIN_PROVIDER_NAMES,
  BUILTIN_PROVIDER_CONFIGS,
  loadProviderConfigs,
  loadProviderConfig,
  createAiProvider,
  getProviderApiKey,
  getProviderEndpointUrl,
  generateAiResponse,
  resolveTaskRoute,
  generateAiForTask,
  getDefaultProviderName,
} from "@workspace/ai-providers";
import { radiologyWorklistTable } from "@workspace/db/schema";
import { RadiologyIdentityError, resolveAuthorizedStudyUid } from "../lib/radiologyIdentity";
import { resolveTestModel } from "../lib/ai/testProviderModel";
import {
  AiReportingQueryRequestSchema,
  type AiPromptSource,
  type AiReportingQueryResponse,
} from "@workspace/api-zod";
import { AI_MASTER_FLAG, setMasterAiFlag } from "../lib/ai/clinicalConfigService";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import {
  buildAiReportingDraftDiagnostics,
  buildParserMeta,
  logAiReportingDraftDiagnostics,
  newAiRequestId,
} from "../lib/ai/aiReportingRequestDiagnostics";
import { resolveInteractiveDraftNumCtx } from "../lib/ai/contextBudget";
import { resolveLocalAiRuntime } from "../lib/aiPipeline/runtimeConfig";
import {
  impressionMatchesStudyContext,
  resolveBuiltinPromptForStudy,
  studyLooksLikeBrain,
  studyLooksLikeChest,
} from "../lib/aiDraftStudyContext";

// ─── Prompt template presets ──────────────────────────────────────────────────
export const AI_PROMPT_TEMPLATES: Record<string, string> = {
  "MRI Brain Report Sequence Wise":
    "Provide a detailed radiology report for this MRI Brain study. Report findings sequence by sequence: T1W, T2W, FLAIR, DWI/ADC, T1W+Contrast (if available), SWI/GRE. Comment on: parenchyma, white matter, ventricles, sulci, basal ganglia, thalami, brainstem, cerebellum, extra-axial spaces, and vascular structures. Conclude with Impression.",
  "CT Brain Report":
    "Provide a structured CT Brain report. Comment on: parenchyma density, grey-white differentiation, ventricles and CSF spaces, sulci, midline shift, basal cisterns, bone windows (calvarium, skull base), and any hemorrhage or ischemic change. Conclude with Impression.",
  "MRI Spine Report":
    "Provide a detailed MRI Spine report. For each vertebral level comment on: vertebral body height and signal, disc height and signal, facet joints, neural foramina, spinal canal diameter, cord/cauda equina signal, and any focal lesion or herniation. Summarise alignment and any significant stenosis. Conclude with Impression.",
  "USG Abdomen Report":
    "Provide a structured Ultrasound Abdomen report. Systematically evaluate: liver (size, echotexture, focal lesions, biliary radicles), gallbladder, CBD, spleen, pancreas, kidneys (size, parenchyma, PCS), urinary bladder, aorta, and free fluid. Conclude with Impression.",
  "X-ray Report":
    "Provide a structured X-ray report. Comment on: technical adequacy, bones and joints, soft tissues, and the relevant organ system (chest: cardiomediastinal silhouette, lung fields, costophrenic angles, pleura; abdomen: bowel gas pattern, solid organ outlines, free gas). Conclude with Impression.",
  "Abnormality Only":
    "Review the provided imaging and report ONLY significant abnormal findings. Skip normal structures. Use concise, structured bullet points. Conclude with a short Impression.",
  "Impression Only":
    "Based on the imaging provided, generate a brief 3–5 line Impression section only (no detailed findings). Use standard radiology terminology.",
  "Compare With Previous Study":
    "Compare the current imaging with the previous study. For each relevant structure, note: unchanged, improved, or worsened — with specifics. Highlight any new findings. Conclude with a comparative Impression.",
  "Emergency Findings":
    "Rapidly assess the imaging for life-threatening or time-critical findings requiring immediate action. Flag: herniation, large stroke, tension pneumothorax, active hemorrhage, bowel obstruction, aortic dissection, cord compression, or other emergencies. Conclude with an urgent Impression.",
  "Post-Contrast Enhancement Query":
    "Analyse post-contrast sequences. Describe the pattern of enhancement (homogeneous, heterogeneous, ring-enhancing, peripheral, no enhancement) for each lesion or region of interest. Comment on breakdown of blood-brain barrier or blood supply. Conclude with Impression.",
  "Infarct vs Tumor Differentiation":
    "Analyse the imaging to differentiate cerebral infarct from neoplasm. Compare: DWI restriction, ADC values, enhancement pattern, surrounding oedema/mass effect, vascular territory distribution, and clinical timeline if provided. Provide differential diagnosis with rationale. Conclude with Impression.",
  "Stroke Protocol MRI":
    "Report this Stroke Protocol MRI. Evaluate in order: DWI (acute restriction, volume, vascular territory), ADC map, FLAIR (infarct age, leukoaraiosis), T2*, SWI or GRE (haemorrhagic transformation, microbleeds), MRA (vessel occlusion/stenosis if included), T1+Gad (if included). Conclude with ASPECTS score estimate and Impression.",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function getSetting(key: string, category: string): Promise<string | null> {
  const row = await db
    .select({ value: pacsSettingsTable.value })
    .from(pacsSettingsTable)
    .where(and(eq(pacsSettingsTable.key, key), eq(pacsSettingsTable.category, category)))
    .limit(1);
  return row[0]?.value ?? null;
}

function getStaffSession(req: StaffAuthRequest) {
  return req.staffSession ?? null;
}

function canConfigure(req: StaffAuthRequest): boolean {
  const u = getStaffSession(req);
  if (!u) return false;
  if (FULL_ACCESS_ROLES.has(u.role)) return true;
  return u.permissions.includes("ai_reporting.configure");
}

function canUse(req: StaffAuthRequest, allowedRoles: string[]): boolean {
  const u = getStaffSession(req);
  if (!u) return false;
  if (FULL_ACCESS_ROLES.has(u.role)) return true;
  if (!u.permissions.includes("ai_reporting.use")) return false;
  return allowedRoles.length === 0 || allowedRoles.includes(u.role);
}

async function getGlobalSettings(): Promise<{
  enabled: boolean;
  defaultProvider: string;
  defaultPrompt: string;
  defaultPromptTemplate: string;
  includeDemographics: boolean;
  anonymize: boolean;
  allowedRoles: string[];
}> {
  const row = await db
    .select({ settingsJson: aiProviderSettingsTable.settingsJson })
    .from(aiProviderSettingsTable)
    .where(eq(aiProviderSettingsTable.provider, "__global__"))
    .limit(1);

  const defaults = {
    enabled: false,
    defaultProvider: "gemini",
    defaultPrompt: "",
    defaultPromptTemplate: "",
    includeDemographics: false,
    anonymize: true,
    allowedRoles: ["admin", "super_admin", "doctor", "radiologist"],
  };

  if (!row[0]?.settingsJson) {
    return { ...defaults, enabled: await isFeatureEnabledServer(AI_MASTER_FLAG) };
  }
  try {
    const parsed = { ...defaults, ...(JSON.parse(row[0].settingsJson) as object) };
    return { ...parsed, enabled: await isFeatureEnabledServer(AI_MASTER_FLAG) };
  } catch {
    return { ...defaults, enabled: await isFeatureEnabledServer(AI_MASTER_FLAG) };
  }
}

// Fetch JPEG thumbnails from Orthanc DICOMweb for a study.
export type StudyImageFetchResult = {
  images: string[];
  seriesSelected: number;
  imageByteSizes: number[];
  totalImageBytes: number;
};

async function fetchStudyImages(opts: {
  studyInstanceUID: string;
  seriesUIDs?: string[];
  maxImages: number;
  maxWidthPx?: number;
}): Promise<StudyImageFetchResult> {
  const empty: StudyImageFetchResult = {
    images: [],
    seriesSelected: 0,
    imageByteSizes: [],
    totalImageBytes: 0,
  };
  const orthancBase = await getSetting("orthanc_base_url", "orthanc");
  if (!orthancBase) return empty;

  const base = orthancBase.replace(/\/$/, "");
  const dicomWebBase = `${base}/dicom-web`;
  const jsonHeaders: Record<string, string> = { Accept: "application/json" };

  type DcmTag = { Value?: (string | { Alphabetic?: string })[] };
  type DcmEntry = Record<string, DcmTag>;

  // 1. Get series list
  const seriesResp = await fetch(
    `${dicomWebBase}/studies/${opts.studyInstanceUID}/series`,
    { headers: jsonHeaders },
  ).catch(() => null);
  if (!seriesResp?.ok) return empty;

  let seriesList: DcmEntry[] = [];
  try {
    seriesList = (await seriesResp.json()) as DcmEntry[];
  } catch {
    return empty;
  }

  // Filter by requested seriesUIDs if provided
  if (opts.seriesUIDs && opts.seriesUIDs.length > 0) {
    seriesList = seriesList.filter((s) => {
      const uid = (s["0020000E"]?.Value?.[0] as string | undefined) ?? "";
      return opts.seriesUIDs!.includes(uid);
    });
  }

  const images: string[] = [];
  const imageByteSizes: number[] = [];
  const maxImages = Math.min(opts.maxImages, 20);
  let seriesSelected = 0;

  for (const series of seriesList) {
    if (images.length >= maxImages) break;
    const seriesUID = (series["0020000E"]?.Value?.[0] as string | undefined) ?? "";
    if (!seriesUID) continue;

    // 2. Get instances in series
    const instancesResp = await fetch(
      `${dicomWebBase}/studies/${opts.studyInstanceUID}/series/${seriesUID}/instances`,
      { headers: jsonHeaders },
    ).catch(() => null);
    if (!instancesResp?.ok) continue;

    let instances: DcmEntry[] = [];
    try {
      instances = (await instancesResp.json()) as DcmEntry[];
    } catch {
      continue;
    }

    // Pick middle instance for representative frame
    const midIdx = Math.floor(instances.length / 2);
    const inst = instances[midIdx];
    if (!inst) continue;
    const instanceUID = (inst["00080018"]?.Value?.[0] as string | undefined) ?? "";
    if (!instanceUID) continue;

    // 3. Fetch rendered JPEG
    const rendered = await fetch(
      `${dicomWebBase}/studies/${opts.studyInstanceUID}/series/${seriesUID}/instances/${instanceUID}/rendered`,
      { headers: { Accept: "image/jpeg" } },
    ).catch(() => null);
    if (!rendered?.ok) continue;

    try {
      const arrayBuf = await rendered.arrayBuffer();
      const rawArr = new Uint8Array(arrayBuf as ArrayBuffer);
      let b64: string;
      let byteLen = rawArr.byteLength;

      // Resize with sharp (optional — skip gracefully if unavailable)
      try {
        const sharp = (await import("sharp")).default;
        // sharp accepts Uint8Array directly, and we type the result as string immediately
        const resized = await sharp(rawArr)
          .resize({ width: opts.maxWidthPx ?? 512, withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        b64 = resized.toString("base64");
        byteLen = resized.byteLength;
      } catch {
        // sharp not available or failed — encode raw bytes
        b64 = Buffer.from(rawArr).toString("base64");
      }

      images.push(b64);
      imageByteSizes.push(byteLen);
      seriesSelected += 1;
    } catch {
      continue;
    }
  }

  return {
    images,
    seriesSelected,
    imageByteSizes,
    totalImageBytes: imageByteSizes.reduce((a, b) => a + b, 0),
  };
}

// ─── AI provider query functions ──────────────────────────────────────────────
// ─── Router ───────────────────────────────────────────────────────────────────
const router = Router();

/**
 * GET /api/ai-reporting/settings
 * Returns settings with hasApiKey flag but never the raw key.
 */
router.get("/settings", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [globalSettings, providers, dbTemplates] = await Promise.all([
    getGlobalSettings(),
    loadProviderConfigs(),
    db
      .select({
        name: aiPromptTemplatesTable.name,
        modality: aiPromptTemplatesTable.modality,
      })
      .from(aiPromptTemplatesTable)
      .where(eq(aiPromptTemplatesTable.isActive, true))
      .orderBy(aiPromptTemplatesTable.modality, aiPromptTemplatesTable.name),
  ]);

  const providersOut: Record<string, object> = {};
  for (const p of providers) {
    const meta = BUILTIN_PROVIDER_CONFIGS[p.provider];
    providersOut[p.provider] = {
      provider: p.provider,
      isEnabled: p.isEnabled ?? false,
      isDefault: p.isDefault ?? false,
      hasApiKey: p.hasApiKey,
      hasEndpointUrl: p.hasEndpointUrl,
      defaultModel: p.defaultModel ?? null,
      endpointUrl: p.endpointUrl ?? null,
      label: meta?.label ?? p.provider,
      needsApiKey: meta?.needsApiKey ?? false,
      needsEndpointUrl: meta?.needsEndpointUrl ?? false,
      defaultModels: meta?.defaultModels ?? [],
      placeholder: meta?.placeholder ?? "",
    };
  }

  // Phase 1: DB-backed templates are the source of truth; merge in any legacy
  // hardcoded preset names that haven't been migrated yet (de-duplicated).
  const dbNames = dbTemplates.map((t) => t.name);
  const mergedTemplateNames = Array.from(
    new Set([...dbNames, ...Object.keys(AI_PROMPT_TEMPLATES)]),
  );

  res.json({
    global: globalSettings,
    providers: providersOut,
    promptTemplates: mergedTemplateNames,
    promptTemplatesByModality: dbTemplates,
  });
});

/**
 * POST /api/ai-reporting/settings
 * Saves global settings and per-provider settings. Admin/superadmin only.
 */
router.post("/settings", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canConfigure(sReq)) {
    res.status(403).json({ error: "Only administrators can configure AI reporting settings." });
    return;
  }

  const { global: globalIn, providers: providersIn } = req.body as {
    global?: {
      enabled?: boolean;
      defaultProvider?: string;
      defaultPrompt?: string;
      defaultPromptTemplate?: string;
      includeDemographics?: boolean;
      anonymize?: boolean;
      allowedRoles?: string[];
    };
    providers?: Record<string, {
      isEnabled?: boolean;
      isDefault?: boolean;
      apiKey?: string;
      defaultModel?: string;
      endpointUrl?: string;
    }>;
  };

  if (globalIn !== undefined) {
    const existing = await db
      .select({ id: aiProviderSettingsTable.id, settingsJson: aiProviderSettingsTable.settingsJson })
      .from(aiProviderSettingsTable)
      .where(eq(aiProviderSettingsTable.provider, "__global__"))
      .limit(1);

    const prev = existing[0]?.settingsJson
      ? (() => { try { return JSON.parse(existing[0].settingsJson!) as object; } catch { return {}; } })()
      : {};
    const next = { ...prev, ...globalIn };

    if (existing[0]) {
      await db.update(aiProviderSettingsTable)
        .set({ settingsJson: JSON.stringify(next) })
        .where(eq(aiProviderSettingsTable.id, existing[0].id));
    } else {
      await db.insert(aiProviderSettingsTable).values({ provider: "__global__", settingsJson: JSON.stringify(next) });
    }

    if (globalIn.enabled !== undefined) {
      await setMasterAiFlag(globalIn.enabled, sReq.staffSession?.subjectName ?? sReq.staffSession?.role ?? "ai-reporting-settings");
    }
  }

  for (const provName of BUILTIN_PROVIDER_NAMES) {
    const pd = providersIn?.[provName];
    if (!pd) continue;

    const existing = await db
      .select()
      .from(aiProviderSettingsTable)
      .where(eq(aiProviderSettingsTable.provider, provName))
      .limit(1);

    const update: Partial<typeof aiProviderSettingsTable.$inferInsert> = {};
    if (pd.isEnabled !== undefined) update.isEnabled = pd.isEnabled;
    if (pd.isDefault !== undefined) update.isDefault = pd.isDefault;
    if (pd.defaultModel !== undefined) update.defaultModel = pd.defaultModel;
    if (pd.apiKey && pd.apiKey.trim().length > 0) {
      update.encryptedApiKey = encryptSecret(pd.apiKey.trim());
    }
    if (pd.endpointUrl && pd.endpointUrl.trim().length > 0) {
      update.endpointUrl = pd.endpointUrl.trim();
    }

    if (existing[0]) {
      if (Object.keys(update).length > 0) {
        await db.update(aiProviderSettingsTable).set(update).where(eq(aiProviderSettingsTable.id, existing[0].id));
      }
    } else {
      await db.insert(aiProviderSettingsTable).values({ provider: provName, ...update });
    }

    if (pd.isDefault) {
      for (const op of BUILTIN_PROVIDER_NAMES.filter((p) => p !== provName)) {
        await db.update(aiProviderSettingsTable).set({ isDefault: false }).where(eq(aiProviderSettingsTable.provider, op));
      }
    }
  }

  res.json({ success: true });
});

/**
 * POST /api/ai-reporting/test-provider
 */
router.post("/test-provider", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { provider, apiKey, model, endpointUrl } = req.body as { provider: string; apiKey?: string; model?: string; endpointUrl?: string };

  if (!BUILTIN_PROVIDER_NAMES.includes(provider)) {
    res.status(400).json({ error: "Unknown provider." }); return;
  }

  const config = BUILTIN_PROVIDER_CONFIGS[provider];
  let key = apiKey?.trim() ?? "";
  let url = endpointUrl?.trim() ?? "";

  if (config.needsEndpointUrl) {
    if (!url) {
      const stored = await getProviderEndpointUrl(provider);
      if (!stored) { res.status(400).json({ error: `No endpoint URL configured for ${config.label}.` }); return; }
      url = stored;
    }
  } else {
    if (!key) {
      const stored = await getProviderApiKey(provider);
      if (!stored) { res.status(400).json({ error: "No API key configured for this provider." }); return; }
      key = stored;
    }
  }

  // Resolve which model to test — submitted (validated, verbatim) or the stored
  // default when omitted. Never a hard-coded probe model when a model is given.
  const hasModelField = Object.prototype.hasOwnProperty.call((req.body ?? {}) as object, "model");
  const stored = hasModelField ? null : await loadProviderConfig(provider);
  const resolution = resolveTestModel({ provider, hasModelField, submitted: model, storedDefault: stored?.defaultModel ?? null });
  if ("error" in resolution) { res.status(400).json({ error: resolution.error }); return; }
  const modelToTest = resolution.model;

  const instance = await createAiProvider(provider, key || undefined, url || undefined);
  if (!instance) {
    res.status(400).json({ error: "Could not create provider instance." }); return;
  }

  const result = await instance.testConnection(modelToTest);
  res.json({
    success: result.ok,
    // Echo the model actually tested so the UI can confirm the selection was honoured.
    model: modelToTest ?? null,
    response: result.message.substring(0, 200),
    availableModels: result.availableModels,
    error: result.ok ? undefined : result.message,
  });
});

/**
 * POST /api/ai-reporting/query
 * Main AI query endpoint.
 */
router.post("/query", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();

  if (!globalSettings.enabled) {
    res.status(403).json({ error: "AI Reporting is disabled. Enable it in Settings." }); return;
  }
  if (!canUse(sReq, globalSettings.allowedRoles)) {
    res.status(403).json({ error: "You do not have permission to use AI reporting." }); return;
  }

  const user = sReq.staffSession!;

  const parsedBody = AiReportingQueryRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    const first = parsedBody.error.issues[0];
    res.status(400).json({
      error: `Invalid AI query request: ${first ? `${first.path.join(".") || "body"} — ${first.message}` : "malformed body"}`,
    });
    return;
  }

  const {
    studyInstanceUID,
    accessionNumber,
    patientId,
    seriesUIDs,
    scope = "study",
    provider: providerReq,
    model: modelReq,
    promptText,
    prompt,
    templateName,
    clinicalHistory,
    anonymize,
    includeDemographics = globalSettings.includeDemographics,
    maxImages = 6,
  } = parsedBody.data;

  const shouldAnonymize = anonymize ?? globalSettings.anonymize;
  // Phase 4: when the caller does not explicitly pick a provider, consult the
  // per-task model route for "radiology_draft" before falling back to the
  // global default. Explicit request values always win, so this is non-breaking.
  const taskRoute = providerReq ? null : await resolveTaskRoute("radiology_draft");
  const providerName = providerReq ?? taskRoute?.provider ?? globalSettings.defaultProvider;

  if (!BUILTIN_PROVIDER_NAMES.includes(providerName)) {
    res.status(400).json({ error: "Invalid provider." }); return;
  }

  const provConfig = await loadProviderConfig(providerName);
  if (!provConfig || !provConfig.isEnabled) {
    res.status(400).json({ error: `${providerName} provider is disabled or not configured. Enable it in AI Reporting Settings.` }); return;
  }

  const model = modelReq ?? taskRoute?.model ?? provConfig.defaultModel ?? "";

  // Build prompt. `promptText` is the canonical field; `prompt` is the legacy
  // alias — an empty effective prompt is a validation error, never a silent
  // fall-through to a generic draft (that fall-through is exactly how the
  // workstation's findings used to get dropped without anyone noticing).
  let finalPrompt = (promptText ?? prompt)?.trim() ?? "";
  let promptSource: AiPromptSource = "request";
  // Phase 1: prefer the DB-backed (editable) prompt template library, then fall
  // back to the legacy hardcoded presets for backward compatibility.
  if (!finalPrompt && templateName) {
    const dbTpl = await db
      .select({ promptContent: aiPromptTemplatesTable.promptContent })
      .from(aiPromptTemplatesTable)
      .where(
        and(
          eq(aiPromptTemplatesTable.name, templateName),
          eq(aiPromptTemplatesTable.isActive, true),
        ),
      )
      .orderBy(aiPromptTemplatesTable.id)
      .limit(1);
    if (dbTpl[0]?.promptContent) {
      finalPrompt = dbTpl[0].promptContent;
      promptSource = "template";
    } else if (AI_PROMPT_TEMPLATES[templateName]) {
      finalPrompt = AI_PROMPT_TEMPLATES[templateName];
      promptSource = "template";
    }
  }
  if (!finalPrompt && (globalSettings.defaultPrompt ?? "").trim()) {
    finalPrompt = globalSettings.defaultPrompt.trim();
    promptSource = "settings-default";
  }
  if (!finalPrompt) {
    res.status(400).json({
      error: "No prompt provided. Type findings or a question, pick a template, or configure a default prompt in AI Reporting Settings.",
    });
    return;
  }
  if (clinicalHistory?.trim()) {
    finalPrompt += `\n\nClinical History: ${clinicalHistory.trim()}`;
  }

  // Optionally append patient demographics
  if (includeDemographics && patientId && !shouldAnonymize) {
    try {
      const pt = await db
        .select({
          firstName: patientsTable.firstName,
          lastName: patientsTable.lastName,
          ageValue: patientsTable.ageValue,
          gender: patientsTable.gender,
        })
        .from(patientsTable)
        .where(eq(patientsTable.id, patientId))
        .limit(1);
      if (pt[0]) {
        const name = [pt[0].firstName, pt[0].lastName].filter(Boolean).join(" ");
        finalPrompt += `\n\nPatient: ${name || "Unknown"}, Age: ${pt[0].ageValue ?? "Unknown"}, Gender: ${pt[0].gender ?? "Unknown"}`;
      }
    } catch {
      // non-critical
    }
  }

  if (shouldAnonymize) {
    finalPrompt = `[Note: Patient identifiers have been removed from images for privacy.]\n\n${finalPrompt}`;
  }

  // Fetch images — server-side only, resolved from Orthanc by UID.
  // maxImages 0 means an explicit text-only query: skip Orthanc entirely.
  let images: string[] = [];
  if (studyInstanceUID && maxImages > 0) {
    const fetched = await fetchStudyImages({
      studyInstanceUID,
      seriesUIDs: scope === "series" ? seriesUIDs : undefined,
      maxImages: Math.min(maxImages, 20),
      maxWidthPx: 512,
    });
    images = fetched.images;
  }

  // Call AI provider via unified abstraction
  const aiResult = await generateAiResponse(providerName, finalPrompt, images, { model });
  const success = aiResult.success;
  const aiResponse = aiResult.text;
  const errorMsg = aiResult.error;

  // Audit log (non-critical)
  await db.insert(aiReportingAuditLogsTable).values({
    userId: user.subjectId,
    userName: user.subjectName,
    patientId: patientId ?? null,
    studyInstanceUID: studyInstanceUID ?? null,
    accessionNumber: accessionNumber ?? null,
    provider: providerName,
    model: model || null,
    promptText: finalPrompt.substring(0, 2000),
    numImages: images.length,
    anonymized: shouldAnonymize,
    includedDemographics: includeDemographics && !shouldAnonymize,
    success,
    errorMessage: errorMsg ?? null,
  }).catch(() => { /* non-critical */ });

  if (!success) {
    res.status(502).json({ error: errorMsg ?? "AI provider error" }); return;
  }

  const response: AiReportingQueryResponse = {
    aiResponse: aiResponse ?? "",
    provider: providerName,
    model: model || null,
    numImages: images.length,
    anonymized: shouldAnonymize,
    promptSource,
    promptChars: finalPrompt.length,
  };
  res.json(response);
});

/**
 * POST /api/ai-reporting/draft
 * Phase 6: Copilot draft generation — reuses existing provider infrastructure
 * with per-task routing and fallback. Accepts current report body + impression
 * as context and returns AI-generated draft sections.
 */
router.post("/draft", async (req, res): Promise<void> => {
  const requestId = newAiRequestId();
  const routeStartedAt = new Date().toISOString();
  const routeT0 = Date.now();

  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!globalSettings.enabled) {
    res.status(403).json({ error: "AI Reporting is disabled. Enable it in Settings." }); return;
  }
  if (!canUse(sReq, globalSettings.allowedRoles)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const user = sReq.staffSession!;
  const {
    worklistId,
    studyInstanceUID: studyInstanceUIDBody,
    modality: modalityBody,
    studyDescription: studyDescriptionBody,
    reportBody,
    impression,
    clinicalHistory,
    provider: providerReq,
  } = req.body as {
    worklistId?: number;
    studyInstanceUID?: string;
    modality?: string;
    studyDescription?: string;
    reportBody?: string;
    impression?: string;
    clinicalHistory?: string;
    provider?: string;
  };

  // Look up worklist for study metadata — accept worklistId OR studyInstanceUID
  // (workspace autofill historically sent only studyInstanceUID + modality).
  let studyInstanceUID: string | undefined = studyInstanceUIDBody?.trim() || undefined;
  let accessionNumber: string | undefined;
  let patientId: number | undefined;
  let modality = modalityBody?.trim() || undefined;
  let studyDescription = studyDescriptionBody?.trim() || undefined;
  if (worklistId) {
    const wl = await db
      .select({
        studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
        accessionNumber: radiologyWorklistTable.accessionNumber,
        patientId: radiologyWorklistTable.patientId,
        modality: radiologyWorklistTable.modality,
        studyDescription: radiologyWorklistTable.studyDescription,
      })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId))
      .limit(1);
    if (wl[0]) {
      studyInstanceUID = wl[0].studyInstanceUID ?? studyInstanceUID;
      accessionNumber = wl[0].accessionNumber ?? undefined;
      patientId = wl[0].patientId ?? undefined;
      modality = modality || (wl[0].modality ?? undefined);
      studyDescription = studyDescription || (wl[0].studyDescription ?? undefined);
    }
  } else if (studyInstanceUID) {
    const wl = await db
      .select({
        studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
        accessionNumber: radiologyWorklistTable.accessionNumber,
        patientId: radiologyWorklistTable.patientId,
        modality: radiologyWorklistTable.modality,
        studyDescription: radiologyWorklistTable.studyDescription,
      })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.studyInstanceUID, studyInstanceUID))
      .orderBy(desc(radiologyWorklistTable.id))
      .limit(1);
    if (wl[0]) {
      accessionNumber = wl[0].accessionNumber ?? undefined;
      patientId = wl[0].patientId ?? undefined;
      modality = modality || (wl[0].modality ?? undefined);
      studyDescription = studyDescription || (wl[0].studyDescription ?? undefined);
    }
  }

  // Resolve provider via task routing
  const taskRoute = providerReq ? null : await resolveTaskRoute("radiology_draft");
  const providerName = providerReq ?? taskRoute?.provider ?? globalSettings.defaultProvider;
  if (!BUILTIN_PROVIDER_NAMES.includes(providerName)) {
    res.status(400).json({ error: "Invalid provider." }); return;
  }
  const provConfig = await loadProviderConfig(providerName);
  if (!provConfig || !provConfig.isEnabled) {
    res.status(400).json({ error: `${providerName} provider is disabled or not configured.` }); return;
  }
  const model = taskRoute?.model ?? provConfig.defaultModel ?? "";

  // Build prompt: prefer study-specific templates. NEVER pick the first active
  // row for bare modality alone — that silently applied CT Chest prompts to
  // CT Brain (Devansh Kumar: "Normal chest radiograph…" on NCCT brain).
  let finalPrompt = "";
  if (studyDescription) {
    const dbTpl = await db
      .select({ promptContent: aiPromptTemplatesTable.promptContent })
      .from(aiPromptTemplatesTable)
      .where(
        and(
          eq(aiPromptTemplatesTable.name, studyDescription),
          eq(aiPromptTemplatesTable.isActive, true),
        ),
      )
      .limit(1);
    if (dbTpl[0]?.promptContent) finalPrompt = dbTpl[0].promptContent;
  }
  if (!finalPrompt) {
    const builtin = resolveBuiltinPromptForStudy(AI_PROMPT_TEMPLATES, modality, studyDescription);
    if (builtin) finalPrompt = builtin;
  }
  if (!finalPrompt && modality && studyDescription) {
    const dbTpl = await db
      .select({ promptContent: aiPromptTemplatesTable.promptContent, name: aiPromptTemplatesTable.name })
      .from(aiPromptTemplatesTable)
      .where(
        and(
          eq(aiPromptTemplatesTable.modality, modality),
          eq(aiPromptTemplatesTable.isActive, true),
        ),
      )
      .orderBy(aiPromptTemplatesTable.id);
    const descLower = studyDescription.toLowerCase();
    const matched = dbTpl.find((t) => {
      const n = (t.name ?? "").toLowerCase();
      if (!n) return false;
      if (studyLooksLikeBrain(studyDescription) && studyLooksLikeBrain(n)) return true;
      if (studyLooksLikeChest(studyDescription, modality) && studyLooksLikeChest(n, modality)) return true;
      return descLower.includes(n) || n.includes(descLower);
    });
    if (matched?.promptContent) finalPrompt = matched.promptContent;
  }
  if (!finalPrompt) {
    finalPrompt = globalSettings.defaultPrompt || "Provide a detailed radiology report based on the findings provided.";
  }

  // Append current report context so the AI can refine/continue
  finalPrompt += "\n\n=== CURRENT REPORT CONTEXT ===";
  if (reportBody?.trim()) {
    finalPrompt += `\n\nCurrent Findings:\n${reportBody.trim()}`;
  }
  if (impression?.trim()) {
    finalPrompt += `\n\nCurrent Impression:\n${impression.trim()}`;
  }
  if (clinicalHistory?.trim()) {
    finalPrompt += `\n\nClinical History: ${clinicalHistory.trim()}`;
  }
  if (studyDescription?.trim()) {
    finalPrompt += `\n\nStudy: ${studyDescription.trim()}`;
  }
  if (modality?.trim()) {
    finalPrompt += `\nModality: ${modality.trim()}`;
  }
  finalPrompt += "\n\n=== INSTRUCTION ===\n" +
    "Generate a refined radiology report for THIS study only.\n" +
    "Do NOT use wording from a different modality or body region " +
    "(e.g. never write 'chest radiograph' for a CT/MRI brain).\n" +
    "Return ONLY two sections:\n" +
    "FINDINGS: (structured findings)\n" +
    "IMPRESSION: (concise impression)\n" +
    "Do not include any other text or explanations.";

  // Clinic Local AI timeout (used by radiology-ollama — NOT applied on this path today).
  let clinicOllamaTimeoutSeconds: number | null = null;
  try {
    const [clinicRow] = await db
      .select({ timeout: clinicSettingsTable.ollamaTimeoutSeconds })
      .from(clinicSettingsTable)
      .orderBy(desc(clinicSettingsTable.id))
      .limit(1);
    clinicOllamaTimeoutSeconds = clinicRow?.timeout ?? 30;
  } catch {
    clinicOllamaTimeoutSeconds = 30;
  }

  // Fetch images (optional) — up to 6 middle-slice JPEGs across series
  let images: string[] = [];
  let imageMeta = {
    seriesSelected: 0,
    imagesSelected: 0,
    imageByteSizes: [] as number[],
    totalImageBytes: 0,
    fetchElapsedMs: 0,
  };
  if (studyInstanceUID) {
    const fetchT0 = Date.now();
    const fetched = await fetchStudyImages({
      studyInstanceUID,
      maxImages: 6,
      maxWidthPx: 512,
    });
    images = fetched.images;
    imageMeta = {
      seriesSelected: fetched.seriesSelected,
      imagesSelected: fetched.images.length,
      imageByteSizes: fetched.imageByteSizes,
      totalImageBytes: fetched.totalImageBytes,
      fetchElapsedMs: Date.now() - fetchT0,
    };
  }

  // Call AI — MUST send options.num_ctx. Live caredeoghar proved omitting it
  // makes Ollama use ~4096 and reject 6-image MRI payloads (~6453 tokens).
  const runtime = await resolveLocalAiRuntime(true);
  const draftOverride = process.env.OLLAMA_DRAFT_NUM_CTX
    ? Number(process.env.OLLAMA_DRAFT_NUM_CTX)
    : null;
  const draftCtx = resolveInteractiveDraftNumCtx({
    configuredNumCtx: runtime.ollamaNumCtx,
    imageCount: images.length,
    draftNumCtxOverride: Number.isFinite(draftOverride) ? draftOverride : null,
  });
  const ollamaOpts =
    providerName === "ollama"
      ? {
          model,
          numCtx: draftCtx.requestedNumCtx,
          endpointUrl: runtime.ollamaBaseUrl,
          think: false,
        }
      : { model };
  const aiResult = await generateAiForTask("radiology_draft", finalPrompt, images, ollamaOpts);
  const success = aiResult.success;
  const aiResponse = aiResult.text;
  const errorMsg = aiResult.error;

  // Parse findings + impression from AI response
  let draftFindings = "";
  let draftImpression = "";
  let parser = null as ReturnType<typeof buildParserMeta> | null;
  if (success && aiResponse) {
    const findingsMatch = aiResponse.match(/FINDINGS:?\s*([\s\S]*?)(?=IMPRESSION:|$)/i);
    const impressionMatch = aiResponse.match(/IMPRESSION:?\s*([\s\S]*?)$/i);
    draftFindings = findingsMatch?.[1]?.trim() ?? aiResponse.trim();
    draftImpression = impressionMatch?.[1]?.trim() ?? "";
    // Drop cross-modality garbage (chest radiograph on CT Brain, etc.)
    if (
      draftImpression
      && !impressionMatchesStudyContext(draftImpression, { modality, studyDescription })
    ) {
      draftImpression = "";
    }
    parser = buildParserMeta(aiResponse, draftFindings, draftImpression);
  }

  const diag = buildAiReportingDraftDiagnostics({
    requestId,
    worklistId: worklistId ?? null,
    providerName,
    model: model || null,
    promptLength: finalPrompt.length,
    startedAt: routeStartedAt,
    imageMeta,
    aiResult,
    parser,
    clinicOllamaTimeoutSeconds,
    totalElapsedMs: Date.now() - routeT0,
    configuredNumCtx: draftCtx.configuredNumCtx,
    requestedNumCtx: draftCtx.requestedNumCtx,
    numCtxReason: draftCtx.reason,
  });
  logAiReportingDraftDiagnostics(diag, success ? "info" : "error");

  // Save draft to DB
  let draftId: number | null = null;
  if (success) {
    const inserted = await db.insert(aiReportingDraftsTable)
      .values({
        studyInstanceUID: studyInstanceUID ?? null,
        accessionNumber: accessionNumber ?? null,
        patientId: patientId ?? null,
        userId: user.subjectId,
        userName: user.subjectName,
        provider: providerName,
        model: model || null,
        promptText: finalPrompt.substring(0, 2000),
        templateName: null,
        aiResponse: aiResponse.substring(0, 4000),
        draftText: draftFindings.substring(0, 4000),
        status: "draft",
      })
      .returning({ id: aiReportingDraftsTable.id });
    draftId = inserted[0]?.id ?? null;
  }

  // Audit log (non-critical)
  await db.insert(aiReportingAuditLogsTable).values({
    userId: user.subjectId,
    userName: user.subjectName,
    patientId: patientId ?? null,
    studyInstanceUID: studyInstanceUID ?? null,
    accessionNumber: accessionNumber ?? null,
    provider: providerName,
    model: model || null,
    promptText: finalPrompt.substring(0, 2000),
    numImages: images.length,
    anonymized: true,
    includedDemographics: false,
    wasInsertedToReport: false,
    draftId,
    success,
    errorMessage: errorMsg ?? null,
  }).catch(() => { /* non-critical */ });

  if (!success) {
    // Include PHI-safe diagnostic summary so operators see the real 502 cause
    // without grepping only the pino HTTP line.
    res.status(502).json({
      error: errorMsg ?? "AI provider error",
      requestId,
      diagnostics: {
        provider: diag.provider,
        resolvedEndpoint: diag.resolvedEndpoint,
        model: diag.model,
        numberOfImages: diag.numberOfImages,
        totalImageBytes: diag.totalImageBytes,
        imageByteSizes: diag.imageByteSizes,
        seriesSelected: diag.seriesSelected,
        promptLength: diag.promptLength,
        imageFetchElapsedMs: diag.imageFetchElapsedMs,
        providerElapsedMs: diag.providerElapsedMs,
        totalElapsedMs: diag.totalElapsedMs,
        httpStatus: diag.httpStatus,
        responseLength: diag.responseLength,
        finishReason: diag.finishReason,
        parserSuccess: diag.parserSuccess,
        providerReturned: diag.providerReturned,
        errorClass: diag.errorClass,
        errorCode: diag.errorCode,
        errorMessage: diag.errorMessage,
        timeoutStage: diag.timeoutStage,
        timeoutMsConfigured: diag.timeoutMsConfigured,
        clinicOllamaTimeoutSeconds: diag.clinicOllamaTimeoutSeconds,
        configuredNumCtx: diag.configuredNumCtx,
        requestedNumCtx: diag.requestedNumCtx,
        ollamaAvailableContext: diag.ollamaAvailableContext,
        ollamaRequestTokens: diag.ollamaRequestTokens,
        numCtxReason: diag.numCtxReason,
        timeoutSourcesNote: diag.timeoutSourcesNote,
      },
    });
    return;
  }

  res.json({
    // `findings` is the workspace autofill key; `draft` kept for older clients.
    findings: draftFindings,
    draft: draftFindings,
    impression: draftImpression,
    provider: providerName,
    model: model || null,
    draftId,
    requestId,
    aiSafetyLabel: "AI Draft – Requires Radiologist Review",
  });
});

/**
 * POST /api/ai-reporting/polish
 * Phase 6: Language polish — refine grammar/formatting without changing medical content.
 */
router.post("/polish", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!globalSettings.enabled) {
    res.status(403).json({ error: "AI Reporting is disabled." }); return;
  }
  if (!canUse(sReq, globalSettings.allowedRoles)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const user = sReq.staffSession!;
  const { text } = req.body as { text?: string };
  if (!text?.trim()) {
    res.status(400).json({ error: "No text provided." }); return;
  }

  const providerName = await getDefaultProviderName();
  const prompt =
    "You are a medical language editor. Refine the following radiology report text for grammar, clarity, and professional formatting. " +
    "Do NOT change any medical facts, measurements, or findings. Only improve language.\n\n" +
    text.trim() +
    "\n\nReturn ONLY the polished text with no additional commentary.";

  const aiResult = await generateAiForTask("report_enhancement", prompt, [], {});
  const success = aiResult.success;
  const polished = aiResult.text;

  // Audit log
  await db.insert(aiReportingAuditLogsTable).values({
    userId: user.subjectId,
    userName: user.subjectName,
    provider: providerName,
    model: null,
    promptText: prompt.substring(0, 2000),
    numImages: 0,
    anonymized: true,
    success,
    errorMessage: success ? null : (aiResult.error ?? null),
  }).catch(() => { /* non-critical */ });

  if (!success) {
    res.status(502).json({ error: aiResult.error ?? "AI provider error" }); return;
  }

  res.json({ polished: polished.trim(), aiSafetyLabel: "AI Draft – Requires Radiologist Review" });
});

/**
 * POST /api/ai-reporting/image-review
 * Phase 6 C5: Vision-capable AI secondary review. Reuses the existing query
 * infrastructure with vision-mode prompts.
 */
router.post("/image-review", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!globalSettings.enabled) {
    res.status(403).json({ error: "AI Reporting is disabled." }); return;
  }
  if (!canUse(sReq, globalSettings.allowedRoles)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const user = sReq.staffSession!;
  const { worklistId, studyInstanceUID: clientUid, reportBody } = req.body as {
    worklistId?: number;
    studyInstanceUID?: string;
    reportBody?: string;
  };

  let studyInstanceUID: string;
  try {
    studyInstanceUID = await resolveAuthorizedStudyUid({
      worklistId: worklistId ?? null,
      studyInstanceUID: clientUid ?? null,
    });
  } catch (err) {
    if (err instanceof RadiologyIdentityError) {
      res.status(err.httpStatus).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }

  // Resolve provider — prefer vision-capable models
  const taskRoute = await resolveTaskRoute("radiology_draft");
  const providerName = taskRoute?.provider ?? globalSettings.defaultProvider;
  const provConfig = await loadProviderConfig(providerName);
  if (!provConfig || !provConfig.isEnabled) {
    res.status(400).json({ error: `${providerName} provider is disabled or not configured.` }); return;
  }
  const model = taskRoute?.model ?? provConfig.defaultModel ?? "";

  // Build vision prompt
  const prompt =
    "You are an expert radiologist assistant. Review the provided medical images carefully. " +
    "List any significant findings you observe. Be concise and structured. " +
    "If the current report context is provided, note any discrepancies or missed findings.\n\n" +
    (reportBody?.trim() ? `Current report context:\n${reportBody.trim()}\n\n` : "") +
    "Return your findings as bullet points.";

  // Fetch images
  const fetchedReview = await fetchStudyImages({
    studyInstanceUID,
    maxImages: 6,
    maxWidthPx: 512,
  });
  const images = fetchedReview.images;

  if (images.length === 0) {
    res.status(400).json({ error: "No images available for this study." }); return;
  }

  // Call AI with images
  const aiResult = await generateAiForTask("radiology_draft", prompt, images, { model });
  const success = aiResult.success;
  const aiResponse = aiResult.text;

  // Audit log
  await db.insert(aiReportingAuditLogsTable).values({
    userId: user.subjectId,
    userName: user.subjectName,
    studyInstanceUID: studyInstanceUID ?? null,
    provider: providerName,
    model: model || null,
    promptText: prompt.substring(0, 2000),
    numImages: images.length,
    anonymized: true,
    success,
    errorMessage: success ? null : (aiResult.error ?? null),
  }).catch(() => { /* non-critical */ });

  if (!success) {
    res.status(502).json({ error: aiResult.error ?? "AI provider error" }); return;
  }

  res.json({
    aiResponse: aiResponse.trim(),
    provider: providerName,
    model: model || null,
    numImages: images.length,
    aiSafetyLabel: "AI Draft – Requires Radiologist Review",
  });
});

/**
 * GET /api/ai-reporting/previous-reports
 * Phase 6 C6: Fetch previous reports for the same patient.
 */
router.get("/previous-reports", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const worklistId = Number(req.query["worklistId"] ?? 0);
  if (!worklistId) {
    res.status(400).json({ error: "worklistId required." }); return;
  }

  // Look up patient from worklist
  const wl = await db
    .select({ patientId: radiologyWorklistTable.patientId })
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, worklistId))
    .limit(1);
  const patientId = wl[0]?.patientId;
  if (!patientId) {
    res.json({ reports: [] }); return;
  }

  // Find previous radiology reports for this patient
  const reports = await db
    .select({
      id: patientReportsTable.id,
      title: patientReportsTable.title,
      body: patientReportsTable.body,
      impression: patientReportsTable.impression,
      createdAt: patientReportsTable.createdAt,
    })
    .from(patientReportsTable)
    .where(
      and(
        eq(patientReportsTable.patientId, patientId),
        eq(patientReportsTable.type, "radiology"),
      ),
    )
    .orderBy(desc(patientReportsTable.createdAt))
    .limit(10);

  const mapped = reports.map((r) => ({
    id: r.id,
    date: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "Unknown",
    modality: r.title?.split(" ")[0] ?? "Unknown",
    body: r.body ?? "",
    impression: r.impression ?? "",
  }));

  res.json({ reports: mapped });
});

/**
 * POST /api/ai-reporting/compare
 * Phase 6 C6: AI-powered comparison between current and previous report.
 */
router.post("/compare", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!globalSettings.enabled) {
    res.status(403).json({ error: "AI Reporting is disabled." }); return;
  }
  if (!canUse(sReq, globalSettings.allowedRoles)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const user = sReq.staffSession!;
  const { worklistId, previousReportId } = req.body as { worklistId?: number; previousReportId?: number };
  if (!worklistId || !previousReportId) {
    res.status(400).json({ error: "worklistId and previousReportId required." }); return;
  }

  // Fetch previous report
  const prev = await db
    .select({ body: patientReportsTable.body, impression: patientReportsTable.impression, title: patientReportsTable.title })
    .from(patientReportsTable)
    .where(eq(patientReportsTable.id, previousReportId))
    .limit(1);
  if (!prev[0]) {
    res.status(404).json({ error: "Previous report not found." }); return;
  }

  // Fetch current worklist report context (if any)
  const current = await db
    .select({ body: patientReportsTable.body, impression: patientReportsTable.impression })
    .from(patientReportsTable)
    .where(eq(patientReportsTable.studyId, worklistId))
    .orderBy(desc(patientReportsTable.createdAt))
    .limit(1);

  const providerName = await getDefaultProviderName();
  const prompt =
    "Compare the following two radiology reports and highlight changes:\n\n" +
    "=== PREVIOUS REPORT ===\n" +
    `Title: ${prev[0].title ?? "Unknown"}\n` +
    `Findings: ${prev[0].body ?? ""}\n` +
    `Impression: ${prev[0].impression ?? ""}\n\n` +
    "=== CURRENT REPORT ===\n" +
    `Findings: ${current[0]?.body ?? "(draft in progress)"}\n` +
    `Impression: ${current[0]?.impression ?? ""}\n\n` +
    "Instructions:\n" +
    "1. List findings that are NEW in the current report.\n" +
    "2. List findings that have RESOLVED.\n" +
    "3. List findings that are UNCHANGED.\n" +
    "4. Note any WORSENING or IMPROVEMENT.\n" +
    "5. Highlight any discrepancies.\n\n" +
    "Return the comparison as structured bullet points.";

  const aiResult = await generateAiForTask("report_enhancement", prompt, [], {});
  const success = aiResult.success;

  // Audit log
  await db.insert(aiReportingAuditLogsTable).values({
    userId: user.subjectId,
    userName: user.subjectName,
    provider: providerName,
    model: null,
    promptText: prompt.substring(0, 2000),
    numImages: 0,
    anonymized: true,
    success,
    errorMessage: success ? null : (aiResult.error ?? null),
  }).catch(() => { /* non-critical */ });

  if (!success) {
    res.status(502).json({ error: aiResult.error ?? "AI provider error" }); return;
  }

  res.json({
    comparison: aiResult.text.trim(),
    aiSafetyLabel: "AI Draft – Requires Radiologist Review",
  });
});

/**
 * GET /api/ai-reporting/audit-log
 */
router.get("/audit-log", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
  const offset = Number(req.query["offset"] ?? 0);
  const studyUID = req.query["studyInstanceUID"] as string | undefined;

  const rows = await db
    .select()
    .from(aiReportingAuditLogsTable)
    .where(studyUID ? eq(aiReportingAuditLogsTable.studyInstanceUID, studyUID) : undefined)
    .orderBy(desc(aiReportingAuditLogsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(rows);
});

/**
 * POST /api/ai-reporting/drafts
 */
router.post("/drafts", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const user = sReq.staffSession!;
  const {
    id: existingId,
    studyInstanceUID,
    accessionNumber,
    patientId,
    provider,
    model,
    promptText,
    templateName,
    aiResponse,
    draftText,
    status = "draft",
  } = req.body as {
    id?: number;
    studyInstanceUID?: string;
    accessionNumber?: string;
    patientId?: number;
    provider: string;
    model?: string;
    promptText?: string;
    templateName?: string;
    aiResponse?: string;
    draftText?: string;
    status?: string;
  };

  if (existingId) {
    await db.update(aiReportingDraftsTable)
      .set({ draftText, aiResponse, status, updatedAt: new Date() })
      .where(eq(aiReportingDraftsTable.id, existingId));
    res.json({ id: existingId }); return;
  }

  const inserted = await db.insert(aiReportingDraftsTable)
    .values({
      studyInstanceUID: studyInstanceUID ?? null,
      accessionNumber: accessionNumber ?? null,
      patientId: patientId ?? null,
      userId: user.subjectId,
      userName: user.subjectName,
      provider,
      model: model ?? null,
      promptText: promptText ?? null,
      templateName: templateName ?? null,
      aiResponse: aiResponse ?? null,
      draftText: draftText ?? null,
      status,
    })
    .returning({ id: aiReportingDraftsTable.id });

  res.json({ id: inserted[0]?.id });
});

/**
 * GET /api/ai-reporting/drafts/:studyId
 */
router.get("/drafts/:studyId", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const rows = await db
    .select()
    .from(aiReportingDraftsTable)
    .where(eq(aiReportingDraftsTable.studyInstanceUID, req.params["studyId"] ?? ""))
    .orderBy(desc(aiReportingDraftsTable.createdAt));

  res.json(rows);
});

/**
 * POST /api/ai-reporting/insert-to-report
 */
router.post("/insert-to-report", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const user = sReq.staffSession!;
  const { draftId } = req.body as { draftId: number };

  await db.update(aiReportingDraftsTable)
    .set({ status: "inserted", insertedAt: new Date(), insertedBy: user.subjectName })
    .where(eq(aiReportingDraftsTable.id, draftId));

  await db.update(aiReportingAuditLogsTable)
    .set({ wasInsertedToReport: true })
    .where(eq(aiReportingAuditLogsTable.draftId, draftId));

  res.json({ success: true });
});

/**
 * GET /api/ai-reporting/quality-scores
 * Phase 5: Reporting Quality Scoring — aggregate metrics from radiologist feedback.
 */
router.get("/quality-scores", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { from, to, scope = "overall" } = req.query as Record<string, string>;
  const dateFrom = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
  const dateTo = to ? new Date(to) : new Date();

  const whereClause = and(
    gte(radiologyWorklistTable.createdAt, dateFrom),
    lte(radiologyWorklistTable.createdAt, dateTo),
  );

  const [overall, byModality] = await Promise.all([
    db
      .select({
        totalDrafts: sql<number>`count(*)`,
        totalWithFeedback: sql<number>`count(case when ${radiologyWorklistTable.aiFeedback} is not null then 1 end)`,
        helpfulCount: sql<number>`count(case when ${radiologyWorklistTable.aiFeedback}::text like '%"verdict":"helpful"%' then 1 end)`,
        needsImprovementCount: sql<number>`count(case when ${radiologyWorklistTable.aiFeedback}::text like '%"verdict":"needs_improvement"%' then 1 end)`,
        inaccurateCount: sql<number>`count(case when ${radiologyWorklistTable.aiFeedback}::text like '%"verdict":"inaccurate"%' then 1 end)`,
      })
      .from(radiologyWorklistTable)
      .where(whereClause),
    db
      .select({
        modality: radiologyWorklistTable.modality,
        totalWithFeedback: sql<number>`count(case when ${radiologyWorklistTable.aiFeedback} is not null then 1 end)`,
        helpfulCount: sql<number>`count(case when ${radiologyWorklistTable.aiFeedback}::text like '%"verdict":"helpful"%' then 1 end)`,
        needsImprovementCount: sql<number>`count(case when ${radiologyWorklistTable.aiFeedback}::text like '%"verdict":"needs_improvement"%' then 1 end)`,
        inaccurateCount: sql<number>`count(case when ${radiologyWorklistTable.aiFeedback}::text like '%"verdict":"inaccurate"%' then 1 end)`,
      })
      .from(radiologyWorklistTable)
      .where(whereClause)
      .groupBy(radiologyWorklistTable.modality),
  ]);

  const o = overall[0];
  const total = o.totalWithFeedback || 1;
  const qualityScore = (o.helpfulCount * 100 + o.needsImprovementCount * 50) / total;

  const modalityBreakdown = byModality.map((m) => {
    const t = m.totalWithFeedback || 1;
    return {
      modality: m.modality,
      totalWithFeedback: m.totalWithFeedback,
      helpfulCount: m.helpfulCount,
      needsImprovementCount: m.needsImprovementCount,
      inaccurateCount: m.inaccurateCount,
      qualityScore: Number(((m.helpfulCount * 100 + m.needsImprovementCount * 50) / t).toFixed(1)),
      helpfulRate: Number(((m.helpfulCount / t) * 100).toFixed(1)),
    };
  });

  res.json({
    scope,
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
    overall: {
      totalDrafts: o.totalDrafts,
      totalWithFeedback: o.totalWithFeedback,
      helpfulCount: o.helpfulCount,
      needsImprovementCount: o.needsImprovementCount,
      inaccurateCount: o.inaccurateCount,
      qualityScore: Number(qualityScore.toFixed(1)),
      helpfulRate: Number(((o.helpfulCount / total) * 100).toFixed(1)),
    },
    byModality: modalityBreakdown,
  });
});

/**
 * GET /api/ai-reporting/prompt-effectiveness
 * Phase 6: AI Prompt Effectiveness — rank templates by radiologist feedback.
 */
router.get("/prompt-effectiveness", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { from, to, modality } = req.query as Record<string, string>;
  const dateFrom = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
  const dateTo = to ? new Date(to) : new Date();

  const dateFilter = and(
    gte(radiologyWorklistTable.createdAt, dateFrom),
    lte(radiologyWorklistTable.createdAt, dateTo),
  );

  const modalityFilter = modality ? eq(radiologyWorklistTable.modality, modality) : undefined;
  const whereClause = modalityFilter ? and(dateFilter, modalityFilter) : dateFilter;

  const byTemplate = await db
    .select({
      templateName: aiReportingDraftsTable.templateName,
      modality: radiologyWorklistTable.modality,
      totalDrafts: sql<number>`count(*)`,
      totalWithFeedback: sql<number>`count(case when ${radiologyWorklistTable.aiFeedback} is not null then 1 end)`,
      helpfulCount: sql<number>`count(case when ${radiologyWorklistTable.aiFeedback}::text like '%"verdict":"helpful"%' then 1 end)`,
      needsImprovementCount: sql<number>`count(case when ${radiologyWorklistTable.aiFeedback}::text like '%"verdict":"needs_improvement"%' then 1 end)`,
      inaccurateCount: sql<number>`count(case when ${radiologyWorklistTable.aiFeedback}::text like '%"verdict":"inaccurate"%' then 1 end)`,
    })
    .from(aiReportingDraftsTable)
    .leftJoin(radiologyWorklistTable, eq(radiologyWorklistTable.studyInstanceUID, aiReportingDraftsTable.studyInstanceUID))
    .where(whereClause)
    .groupBy(aiReportingDraftsTable.templateName, radiologyWorklistTable.modality);

  const ranked = byTemplate
    .filter((t) => t.templateName)
    .map((t) => {
      const total = t.totalWithFeedback || 1;
      return {
        templateName: t.templateName!,
        modality: t.modality,
        totalDrafts: t.totalDrafts,
        totalWithFeedback: t.totalWithFeedback,
        helpfulCount: t.helpfulCount,
        needsImprovementCount: t.needsImprovementCount,
        inaccurateCount: t.inaccurateCount,
        qualityScore: Number(((t.helpfulCount * 100 + t.needsImprovementCount * 50) / total).toFixed(1)),
        helpfulRate: Number(((t.helpfulCount / total) * 100).toFixed(1)),
      };
    })
    .sort((a, b) => b.qualityScore - a.qualityScore);

  res.json({
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
    modality: modality ?? null,
    templates: ranked,
  });
});

// ──────────────────────────── Phase 3: AI-Powered DICOM Findings ────────────────────────────

/**
 * GET /api/ai-reporting/dicom-findings
 * List AI-generated DICOM findings for the worklist, with optional filter.
 */
router.get("/dicom-findings", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { worklistId, status } = req.query as Record<string, string>;
  const conditions = [];
  if (worklistId) conditions.push(eq(aiDicomFindingsTable.worklistId, Number(worklistId)));
  if (status) conditions.push(eq(aiDicomFindingsTable.status, status));

  const rows = await db
    .select()
    .from(aiDicomFindingsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(aiDicomFindingsTable.createdAt));

  res.json(rows);
});

/**
 * POST /api/ai-reporting/dicom-findings
 * Generate AI DICOM findings for a worklist entry (or save from external inference).
 */
router.post("/dicom-findings", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const b = req.body as {
    worklistId: number;
    suggestedFindings?: string;
    suggestedImpression?: string;
    confidenceScore?: number;
    modality?: string;
    bodyPart?: string;
    studyDescription?: string;
  };

  if (!b.worklistId) { res.status(400).json({ error: "worklistId required" }); return; }

  const [wl] = await db
    .select()
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, b.worklistId))
    .limit(1);

  if (!wl) { res.status(404).json({ error: "Worklist entry not found" }); return; }

  const inserted = await db.insert(aiDicomFindingsTable).values({
    worklistId: b.worklistId,
    studyInstanceUID: wl.studyInstanceUID ?? null,
    accessionNumber: wl.accessionNumber ?? null,
    modality: b.modality ?? wl.modality ?? null,
    bodyPart: b.bodyPart ?? null,
    studyDescription: b.studyDescription ?? wl.studyDescription ?? null,
    suggestedFindings: b.suggestedFindings ?? null,
    suggestedImpression: b.suggestedImpression ?? null,
    confidenceScore: b.confidenceScore ?? null,
  }).returning();

  res.json({ id: inserted[0]?.id, safetyNote: "AI Draft – Requires Radiologist Review" });
});

/**
 * PATCH /api/ai-reporting/dicom-findings/:id
 * Review/accept/reject an AI DICOM finding.
 */
router.patch("/dicom-findings/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const { status, reviewedNotes } = req.body as { status: "accepted" | "rejected" | "reviewed"; reviewedNotes?: string };
  if (!status) { res.status(400).json({ error: "status required" }); return; }

  const user = sReq.staffSession!;
  const [updated] = await db.update(aiDicomFindingsTable)
    .set({
      status,
      reviewedById: user.subjectId,
      reviewedByName: user.subjectName,
      reviewedAt: new Date(),
      reviewedNotes: reviewedNotes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(aiDicomFindingsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

// ──────────────────────────── Phase 9: RAG Vector Store ────────────────────────────

/**
 * GET /api/ai-reporting/rag-documents
 * List RAG document embeddings with optional filter by type/modality/patient.
 */
router.get("/rag-documents", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { documentType, modality, patientId, search } = req.query as Record<string, string>;
  const conditions = [eq(ragDocumentEmbeddingsTable.isActive, true)];
  if (documentType) conditions.push(eq(ragDocumentEmbeddingsTable.documentType, documentType));
  if (modality) conditions.push(eq(ragDocumentEmbeddingsTable.modality, modality));
  if (patientId) conditions.push(eq(ragDocumentEmbeddingsTable.patientId, Number(patientId)));
  if (search) conditions.push(sql`${ragDocumentEmbeddingsTable.content} ILIKE ${`%${search}%`}`);

  const rows = await db
    .select()
    .from(ragDocumentEmbeddingsTable)
    .where(and(...conditions))
    .orderBy(desc(ragDocumentEmbeddingsTable.createdAt))
    .limit(100);

  res.json(rows);
});

/**
 * POST /api/ai-reporting/rag-documents
 * Upsert a RAG document embedding (or plain text placeholder if no embedding engine yet).
 */
router.post("/rag-documents", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const b = req.body as {
    documentId: string;
    documentType: string;
    content: string;
    embedding?: string;
    embeddingDimension?: number;
    modality?: string;
    patientId?: number;
    studyId?: number;
    sourceUrl?: string;
    sourceTitle?: string;
  };

  if (!b.documentId || !b.documentType || !b.content) {
    res.status(400).json({ error: "documentId, documentType, and content required" }); return;
  }

  // Compute a real embedding from the content when the caller didn't supply one
  // and a local embedding engine is configured. Stored as a JSON float array in
  // the existing text column; null (→ keyword-only) when no engine is available.
  let embeddingStr: string | null = b.embedding ?? null;
  let embeddingDim: number = b.embeddingDimension ?? 384;
  if (!embeddingStr) {
    const vec = await embedText(b.content);
    if (vec) { embeddingStr = serializeEmbedding(vec); embeddingDim = vec.length; }
  }

  const existing = await db
    .select({ id: ragDocumentEmbeddingsTable.id })
    .from(ragDocumentEmbeddingsTable)
    .where(eq(ragDocumentEmbeddingsTable.documentId, b.documentId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(ragDocumentEmbeddingsTable)
      .set({
        content: b.content,
        embedding: embeddingStr,
        embeddingDimension: embeddingDim,
        modality: b.modality ?? null,
        patientId: b.patientId ?? null,
        studyId: b.studyId ?? null,
        sourceUrl: b.sourceUrl ?? null,
        sourceTitle: b.sourceTitle ?? null,
        updatedAt: new Date(),
      })
      .where(eq(ragDocumentEmbeddingsTable.id, existing[0].id));
    res.json({ id: existing[0].id, action: "updated", embedded: embeddingStr !== null }); return;
  }

  const inserted = await db.insert(ragDocumentEmbeddingsTable).values({
    documentId: b.documentId,
    documentType: b.documentType,
    content: b.content,
    embedding: embeddingStr,
    embeddingDimension: embeddingDim,
    modality: b.modality ?? null,
    patientId: b.patientId ?? null,
    studyId: b.studyId ?? null,
    sourceUrl: b.sourceUrl ?? null,
    sourceTitle: b.sourceTitle ?? null,
  }).returning();

  res.json({ id: inserted[0]?.id, action: "created", embedded: embeddingStr !== null });
});

/**
 * DELETE /api/ai-reporting/rag-documents/:id
 * Soft-delete a RAG document (set is_active=false).
 */
router.delete("/rag-documents/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  await db.update(ragDocumentEmbeddingsTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(ragDocumentEmbeddingsTable.id, id));
  res.json({ ok: true });
});

/**
 * POST /api/ai-reporting/rag-documents/reembed
 * Back-fill embeddings for active documents that don't have one yet (e.g. rows
 * created before an embedding engine was configured, or when it was offline).
 * Bounded per call; returns counts so a caller can loop until done.
 */
router.post("/rag-documents/reembed", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  if (!(await isEmbeddingAvailable())) {
    res.status(503).json({ error: "No embedding engine configured. Set a local Ollama endpoint (provider settings) first." });
    return;
  }

  const limit = Math.min(Math.max(Number((req.body as { limit?: unknown })?.limit) || 100, 1), 500);
  const pending = await db
    .select({ id: ragDocumentEmbeddingsTable.id, content: ragDocumentEmbeddingsTable.content })
    .from(ragDocumentEmbeddingsTable)
    .where(and(eq(ragDocumentEmbeddingsTable.isActive, true), sql`${ragDocumentEmbeddingsTable.embedding} IS NULL`))
    .limit(limit);

  let embedded = 0;
  let failed = 0;
  for (const row of pending) {
    const vec = await embedText(row.content);
    if (vec) {
      await db.update(ragDocumentEmbeddingsTable)
        .set({ embedding: serializeEmbedding(vec), embeddingDimension: vec.length, updatedAt: new Date() })
        .where(eq(ragDocumentEmbeddingsTable.id, row.id));
      embedded++;
    } else {
      failed++;
    }
  }

  // Are any still pending after this batch? (so the caller knows to loop)
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ragDocumentEmbeddingsTable)
    .where(and(eq(ragDocumentEmbeddingsTable.isActive, true), sql`${ragDocumentEmbeddingsTable.embedding} IS NULL`));

  res.json({ processed: pending.length, embedded, failed, remaining: count });
});

// ──────────────────────────── Phase 10: AI Search & Retrieval ────────────────────────────

/**
 * POST /api/ai-reporting/rag-search
 * Semantic search over RAG documents. Returns text-based matches (cosine similarity
 * computed in JS if no pgvector; otherwise via SQL). Falls back to ILIKE text search
 * if no embedding engine is configured.
 */
router.post("/rag-search", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { query, modality, patientId, topK = 5 } = req.body as {
    query: string;
    modality?: string;
    patientId?: number;
    topK?: number;
  };
  if (!query?.trim()) { res.status(400).json({ error: "query required" }); return; }

  const start = Date.now();
  const conditions = [eq(ragDocumentEmbeddingsTable.isActive, true)];
  if (modality) conditions.push(eq(ragDocumentEmbeddingsTable.modality, modality));
  if (patientId) conditions.push(eq(ragDocumentEmbeddingsTable.patientId, patientId));

  // ── Semantic search when an embedding engine is configured ──────────────────
  // Embed the query, score every candidate doc that has a stored vector by
  // cosine similarity, and rank. Docs without a vector (e.g. pre-embedding rows)
  // are not silently dropped — they're back-filled by keyword match below so the
  // corpus stays searchable during migration.
  const queryVec = await embedText(query);
  let rows: (typeof ragDocumentEmbeddingsTable.$inferSelect)[];
  let mode: "semantic" | "keyword";

  if (queryVec) {
    mode = "semantic";
    const candidates = await db
      .select()
      .from(ragDocumentEmbeddingsTable)
      .where(and(...conditions));
    const scored = candidates
      .map((r) => {
        const vec = parseEmbedding(r.embedding);
        return { r, score: vec ? cosineSimilarity(queryVec, vec) : -1 };
      })
      .filter((s) => s.score > 0)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, topK);

    if (scored.length > 0) {
      const results = scored.map(({ r, score }) => ({
        id: r.id,
        documentId: r.documentId,
        documentType: r.documentType,
        content: r.content.slice(0, 300),
        modality: r.modality,
        sourceTitle: r.sourceTitle,
        score: Math.round(score * 1000) / 1000,
      }));
      rows = scored.map((s) => s.r);
      const durationMs = Date.now() - start;
      await db.insert(ragSearchQueriesTable).values({
        queryText: query,
        embedding: serializeEmbedding(queryVec),
        topK,
        resultsJson: JSON.stringify(results.map((r) => ({ id: r.id, documentId: r.documentId, score: r.score }))),
        userId: sReq.staffSession?.subjectId ?? null,
        userName: sReq.staffSession?.subjectName ?? null,
        durationMs,
      });
      for (const r of rows) {
        await db.update(ragDocumentEmbeddingsTable)
          .set({ searchCount: (r.searchCount ?? 0) + 1, lastSearchedAt: new Date() })
          .where(eq(ragDocumentEmbeddingsTable.id, r.id));
      }
      res.json({ query, results, totalMatches: results.length, durationMs, mode, note: "Semantic vector search (local embeddings)." });
      return;
    }
    // No vector matches (all docs unembedded, or nothing similar) — fall through
    // to keyword search so the query still returns something useful.
    rows = await db
      .select()
      .from(ragDocumentEmbeddingsTable)
      .where(and(...conditions, sql`${ragDocumentEmbeddingsTable.content} ILIKE ${`%${query}%`}`))
      .orderBy(desc(ragDocumentEmbeddingsTable.searchCount))
      .limit(topK);
  } else {
    mode = "keyword";
    rows = await db
      .select()
      .from(ragDocumentEmbeddingsTable)
      .where(and(...conditions, sql`${ragDocumentEmbeddingsTable.content} ILIKE ${`%${query}%`}`))
      .orderBy(desc(ragDocumentEmbeddingsTable.searchCount))
      .limit(topK);
  }

  const results = rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    documentType: r.documentType,
    content: r.content.slice(0, 300),
    modality: r.modality,
    sourceTitle: r.sourceTitle,
    score: null as number | null,
  }));

  const durationMs = Date.now() - start;

  // Log the query
  await db.insert(ragSearchQueriesTable).values({
    queryText: query,
    topK,
    resultsJson: JSON.stringify(results.map((r) => ({ id: r.id, documentId: r.documentId }))),
    userId: sReq.staffSession?.subjectId ?? null,
    userName: sReq.staffSession?.subjectName ?? null,
    durationMs,
  });

  // Increment search counts
  for (const r of rows) {
    await db.update(ragDocumentEmbeddingsTable)
      .set({ searchCount: (r.searchCount ?? 0) + 1, lastSearchedAt: new Date() })
      .where(eq(ragDocumentEmbeddingsTable.id, r.id));
  }

  res.json({
    query,
    results,
    totalMatches: results.length,
    durationMs,
    mode,
    note: mode === "semantic"
      ? "No semantically similar vectors found — showing keyword matches. Re-embed documents if this persists."
      : "Keyword search — configure a local embedding model (Ollama) to enable semantic search.",
  });
});

/**
 * GET /api/ai-reporting/rag-search-history
 * Audit log of recent RAG searches.
 */
router.get("/rag-search-history", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { limit = "25", offset = "0" } = req.query as Record<string, string>;
  const rows = await db
    .select()
    .from(ragSearchQueriesTable)
    .orderBy(desc(ragSearchQueriesTable.createdAt))
    .limit(Number(limit))
    .offset(Number(offset));

  res.json(rows);
});

// ──────────────────────────── Phase 7: Anomaly Detection / Alerting ────────────────────────────

/**
 * GET /api/ai-reporting/anomaly-alerts
 * List anomaly alerts with filters. Staff can view; canConfigure for management.
 */
router.get("/anomaly-alerts", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { status, severity, type, limit = "50" } = req.query as Record<string, string>;
  const conditions = [];
  if (status) conditions.push(eq(anomalyAlertsTable.status, status));
  if (severity) conditions.push(eq(anomalyAlertsTable.severity, severity));
  if (type) conditions.push(eq(anomalyAlertsTable.alertType, type));

  const rows = await db
    .select()
    .from(anomalyAlertsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(anomalyAlertsTable.createdAt))
    .limit(Number(limit));

  res.json(rows);
});

/**
 * POST /api/ai-reporting/anomaly-alerts
 * Create an anomaly alert (e.g. from an automated detector or manual entry).
 */
router.post("/anomaly-alerts", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const b = req.body as {
    alertType: string;
    severity?: string;
    message: string;
    scope?: string;
    relatedId?: number;
    relatedTable?: string;
  };

  if (!b.alertType || !b.message) {
    res.status(400).json({ error: "alertType and message required" }); return;
  }

  const inserted = await db.insert(anomalyAlertsTable).values({
    alertType: b.alertType,
    severity: b.severity ?? "medium",
    message: b.message,
    scope: b.scope ?? null,
    relatedId: b.relatedId ?? null,
    relatedTable: b.relatedTable ?? null,
  }).returning();

  res.json({ id: inserted[0]?.id, safetyNote: "AI Draft – Requires Radiologist Review" });
});

/**
 * PATCH /api/ai-reporting/anomaly-alerts/:id
 * Acknowledge or resolve an anomaly alert.
 */
router.patch("/anomaly-alerts/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const { status, notes } = req.body as { status: "acknowledged" | "resolved" | "ignored" | "open"; notes?: string };
  if (!status) { res.status(400).json({ error: "status required" }); return; }

  const user = sReq.staffSession!;
  const update: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };
  if (status === "acknowledged") {
    update.acknowledgedById = user.subjectId;
    update.acknowledgedByName = user.subjectName;
    update.acknowledgedAt = new Date();
  }
  if (status === "resolved") {
    update.resolvedAt = new Date();
  }
  if (notes) {
    update.message = sql`COALESCE(${anomalyAlertsTable.message}, '') || ' [Note: ' || ${notes} || ']'`;
  }

  const [updated] = await db.update(anomalyAlertsTable).set(update).where(eq(anomalyAlertsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

/**
 * GET /api/ai-reporting/anomaly-alerts/summary
 * Anomaly alert summary counts by severity and status for dashboard.
 */
router.get("/anomaly-alerts/summary", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const rows = await db
    .select({
      severity: anomalyAlertsTable.severity,
      status: anomalyAlertsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(anomalyAlertsTable)
    .groupBy(anomalyAlertsTable.severity, anomalyAlertsTable.status);

  res.json({ summary: rows });
});

// ──────────────────────────── Phase 13: AI Report Diff Viewer ────────────────────────────

/**
 * GET /api/ai-reporting/report-diff/:worklistId
 * Returns AI draft vs. final radiologist report for side-by-side comparison.
 */
router.get("/report-diff/:worklistId", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const wlId = Number(req.params.worklistId);
  const [wl] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, wlId)).limit(1);
  if (!wl) { res.status(404).json({ error: "Worklist not found" }); return; }

  const aiDraft = wl.aiDraftJson ? JSON.parse(wl.aiDraftJson) : null;
  const aiText = aiDraft?.text ?? aiDraft?.content ?? aiDraft?.findings ?? wl.aiDraftJson ?? "";

  const [draft] = await db.select({ id: aiReportingDraftsTable.id, draftText: aiReportingDraftsTable.draftText, status: aiReportingDraftsTable.status })
    .from(aiReportingDraftsTable).where(eq(aiReportingDraftsTable.studyInstanceUID, wl.studyInstanceUID ?? "")).limit(1);

  const finalText = draft?.draftText ?? "";

  res.json({
    worklistId: wlId,
    aiDraft: aiText,
    finalReport: finalText,
    aiDraftStatus: wl.aiDraftStatus,
    aiSafetyLabel: "AI Draft – Requires Radiologist Review",
    // Simple diff: show which lines are present only in AI vs. only in final
    diff: computeSimpleDiff(aiText, finalText),
  });
});

function computeSimpleDiff(ai: string, final: string) {
  const aiLines = ai.split("\n").map((l) => l.trim()).filter(Boolean);
  const finalLines = final.split("\n").map((l) => l.trim()).filter(Boolean);
  const aiSet = new Set(aiLines);
  const finalSet = new Set(finalLines);
  return {
    addedByRadiologist: finalLines.filter((l) => !aiSet.has(l)),
    removedByRadiologist: aiLines.filter((l) => !finalSet.has(l)),
    unchanged: aiLines.filter((l) => finalSet.has(l)),
  };
}

// ──────────────────────────── Phase 14: AI Feedback Loop Analytics ────────────────────────────

/**
 * GET /api/ai-reporting/feedback-loop-analytics
 * Correlates radiologist feedback (thumbs up/down) with AI model/provider performance.
 */
router.get("/feedback-loop-analytics", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { from, to, provider } = req.query as Record<string, string>;
  const dateFrom = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
  const dateTo = to ? new Date(to) : new Date();

  const conditions = [
    gte(aiReportingDraftsTable.createdAt, dateFrom),
    lte(aiReportingDraftsTable.createdAt, dateTo),
  ];

  const rows = await db
    .select({
      provider: aiReportingDraftsTable.provider,
      model: aiReportingDraftsTable.model,
      total: sql<number>`count(*)::int`,
    })
    .from(aiReportingDraftsTable)
    .where(and(...conditions))
    .groupBy(aiReportingDraftsTable.provider, aiReportingDraftsTable.model);

  res.json({ dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString(), byProvider: rows });
});

// ──────────────────────────── Phase 15: Report Template Versioning ────────────────────────────

/**
 * GET /api/ai-reporting/template-versions
 * List versions of a template.
 */
router.get("/template-versions", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { templateId } = req.query as Record<string, string>;
  const conditions = templateId ? [eq(reportTemplateVersionsTable.templateId, templateId)] : [];
  const rows = await db
    .select()
    .from(reportTemplateVersionsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(reportTemplateVersionsTable.version));
  res.json(rows);
});

/**
 * POST /api/ai-reporting/template-versions
 * Save a new version of a template.
 */
router.post("/template-versions", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const b = req.body as {
    templateId: string;
    name: string;
    content: string;
    changeNotes?: string;
  };
  if (!b.templateId || !b.name || !b.content) { res.status(400).json({ error: "templateId, name, and content required" }); return; }

  const [latest] = await db
    .select({ version: reportTemplateVersionsTable.version })
    .from(reportTemplateVersionsTable)
    .where(eq(reportTemplateVersionsTable.templateId, b.templateId))
    .orderBy(desc(reportTemplateVersionsTable.version))
    .limit(1);

  const nextVersion = (latest?.version ?? 0) + 1;
  const user = sReq.staffSession!;

  const inserted = await db.insert(reportTemplateVersionsTable).values({
    templateId: b.templateId,
    version: nextVersion,
    name: b.name,
    content: b.content,
    createdById: user.subjectId,
    createdByName: user.subjectName,
    changeNotes: b.changeNotes ?? null,
  }).returning();

  res.json({ id: inserted[0]?.id, version: nextVersion });
});

// ──────────────────────────── Phase 16: AI Billing Code Suggestions ────────────────────────────

/**
 * GET /api/ai-reporting/billing-suggestions
 * List AI billing suggestions.
 */
router.get("/billing-suggestions", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { worklistId, status } = req.query as Record<string, string>;
  const conditions = [];
  if (worklistId) conditions.push(eq(aiBillingSuggestionsTable.worklistId, Number(worklistId)));
  if (status) conditions.push(eq(aiBillingSuggestionsTable.status, status));
  const rows = await db
    .select()
    .from(aiBillingSuggestionsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(aiBillingSuggestionsTable.createdAt));
  res.json(rows);
});

/**
 * POST /api/ai-reporting/billing-suggestions
 * Create a billing suggestion.
 */
router.post("/billing-suggestions", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const b = req.body as { worklistId: number; cptCodes?: string; icdCodes?: string; overallConfidence?: number; reportId?: number };
  if (!b.worklistId) { res.status(400).json({ error: "worklistId required" }); return; }

  const inserted = await db.insert(aiBillingSuggestionsTable).values({
    worklistId: b.worklistId,
    reportId: b.reportId ?? null,
    cptCodes: b.cptCodes ?? null,
    icdCodes: b.icdCodes ?? null,
    overallConfidence: b.overallConfidence ?? null,
  }).returning();

  res.json({ id: inserted[0]?.id, safetyNote: "AI Draft – Requires Radiologist Review" });
});

/**
 * PATCH /api/ai-reporting/billing-suggestions/:id
 * Review a billing suggestion.
 */
router.patch("/billing-suggestions/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const { status, reviewedNotes } = req.body as { status: "accepted" | "rejected" | "reviewed"; reviewedNotes?: string };
  if (!status) { res.status(400).json({ error: "status required" }); return; }

  const user = sReq.staffSession!;
  const [updated] = await db.update(aiBillingSuggestionsTable).set({
    status,
    reviewedById: user.subjectId,
    reviewedByName: user.subjectName,
    reviewedAt: new Date(),
    reviewedNotes: reviewedNotes ?? null,
    updatedAt: new Date(),
  }).where(eq(aiBillingSuggestionsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

// ──────────────────────────── Phase 17: Peer Review Auto-Assignment ────────────────────────────

/**
 * GET /api/ai-reporting/peer-review-assignments
 * List peer review assignments.
 */
router.get("/peer-review-assignments", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { status, assigneeId } = req.query as Record<string, string>;
  const conditions = [];
  if (status) conditions.push(eq(peerReviewAssignmentsTable.status, status));
  if (assigneeId) conditions.push(eq(peerReviewAssignmentsTable.assignedToId, Number(assigneeId)));
  const rows = await db
    .select()
    .from(peerReviewAssignmentsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(peerReviewAssignmentsTable.createdAt));
  res.json(rows);
});

/**
 * POST /api/ai-reporting/peer-review-assignments
 * Create a peer review assignment.
 */
router.post("/peer-review-assignments", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const b = req.body as {
    reportId: number;
    worklistId?: number;
    assignedToId: number;
    assignedToName?: string;
    priority?: string;
    aiConfidenceScore?: number;
    autoAssignedReason?: string;
  };
  if (!b.reportId || !b.assignedToId) { res.status(400).json({ error: "reportId and assignedToId required" }); return; }

  const user = sReq.staffSession!;
  const inserted = await db.insert(peerReviewAssignmentsTable).values({
    reportId: b.reportId,
    worklistId: b.worklistId ?? null,
    assignedToId: b.assignedToId,
    assignedToName: b.assignedToName ?? null,
    assignedById: user.subjectId,
    assignedByName: user.subjectName,
    priority: b.priority ?? "normal",
    aiConfidenceScore: b.aiConfidenceScore ?? null,
    autoAssignedReason: b.autoAssignedReason ?? null,
  }).returning();

  res.json({ id: inserted[0]?.id });
});

/**
 * PATCH /api/ai-reporting/peer-review-assignments/:id
 * Update peer review status (complete/reject).
 */
router.patch("/peer-review-assignments/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const { status, notes } = req.body as { status: "in_review" | "approved" | "rejected"; notes?: string };
  if (!status) { res.status(400).json({ error: "status required" }); return; }

  const update: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "approved" || status === "rejected") {
    update.completedAt = new Date();
    update.completedNotes = notes ?? null;
  }

  const [updated] = await db.update(peerReviewAssignmentsTable).set(update).where(eq(peerReviewAssignmentsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

// ──────────────────────────── Phase 18: Turnaround Time Analytics ────────────────────────────

/**
 * GET /api/ai-reporting/turnaround-times
 * Turnaround time analytics with optional aggregation.
 */
router.get("/turnaround-times", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { dateFrom, dateTo, modality, radiologistId, groupBy } = req.query as Record<string, string>;
  const conditions = [];
  if (dateFrom) conditions.push(gte(turnaroundTimesTable.dateBucket, dateFrom));
  if (dateTo) conditions.push(lte(turnaroundTimesTable.dateBucket, dateTo));
  if (modality) conditions.push(eq(turnaroundTimesTable.modality, modality));
  if (radiologistId) conditions.push(eq(turnaroundTimesTable.radiologistId, Number(radiologistId)));

  const rows = await db
    .select()
    .from(turnaroundTimesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(turnaroundTimesTable.dateBucket));

  // Aggregation
  const stats: Record<string, { count: number; avgMinutes: number; min: number; max: number }> = {};
  if (groupBy) {
    for (const row of rows) {
      const key = (groupBy === "modality" ? row.modality : groupBy === "radiologist" ? row.radiologistName : row.dateBucket) ?? "unknown";
      if (!stats[key]) stats[key] = { count: 0, avgMinutes: 0, min: Infinity, max: 0 };
      const m = row.minutesToReport ?? 0;
      stats[key].count += 1;
      stats[key].avgMinutes += m;
      stats[key].min = Math.min(stats[key].min, m);
      stats[key].max = Math.max(stats[key].max, m);
    }
    for (const k of Object.keys(stats)) {
      stats[k].avgMinutes = stats[k].count > 0 ? Math.round(stats[k].avgMinutes / stats[k].count) : 0;
    }
  }

  res.json({ rows: groupBy ? undefined : rows, aggregates: groupBy ? stats : undefined });
});

/**
 * POST /api/ai-reporting/turnaround-times
 * Record a turnaround time snapshot.
 */
router.post("/turnaround-times", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const b = req.body as {
    worklistId: number;
    studyId?: number;
    modality?: string;
    radiologistId?: number;
    radiologistName?: string;
    minutesToReport?: number;
    minutesToFirstReview?: number;
    minutesToPeerReview?: number;
    dateBucket: string;
  };
  if (!b.worklistId || !b.dateBucket) { res.status(400).json({ error: "worklistId and dateBucket required" }); return; }

  const inserted = await db.insert(turnaroundTimesTable).values({
    worklistId: b.worklistId,
    studyId: b.studyId ?? null,
    modality: b.modality ?? null,
    radiologistId: b.radiologistId ?? null,
    radiologistName: b.radiologistName ?? null,
    minutesToReport: b.minutesToReport ?? null,
    minutesToFirstReview: b.minutesToFirstReview ?? null,
    minutesToPeerReview: b.minutesToPeerReview ?? null,
    dateBucket: b.dateBucket,
  }).returning();

  res.json({ id: inserted[0]?.id });
});

// ──────────────────────────── Phase 19: AI Training Data Export ────────────────────────────

/**
 * GET /api/ai-reporting/training-data-exports
 * List training data exports.
 */
router.get("/training-data-exports", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const rows = await db
    .select()
    .from(aiTrainingDataExportsTable)
    .orderBy(desc(aiTrainingDataExportsTable.createdAt))
    .limit(50);
  res.json(rows);
});

/**
 * POST /api/ai-reporting/training-data-exports
 * Queue a training data export.
 */
router.post("/training-data-exports", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const b = req.body as {
    exportName: string;
    modality?: string;
    dateFrom?: string;
    dateTo?: string;
    minQualityScore?: number;
  };
  if (!b.exportName) { res.status(400).json({ error: "exportName required" }); return; }

  const user = sReq.staffSession!;
  const inserted = await db.insert(aiTrainingDataExportsTable).values({
    exportName: b.exportName,
    modality: b.modality ?? null,
    dateFrom: b.dateFrom ?? null,
    dateTo: b.dateTo ?? null,
    minQualityScore: b.minQualityScore ?? null,
    status: "pending",
    exportedById: user.subjectId,
    exportedByName: user.subjectName,
  }).returning();

  res.json({ id: inserted[0]?.id, status: "pending" });
});

/**
 * PATCH /api/ai-reporting/training-data-exports/:id
 * Update export status (super-admin only).
 */
router.patch("/training-data-exports/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canConfigure(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const { status, recordsCount, filePath } = req.body as { status: string; recordsCount?: number; filePath?: string };
  if (!status) { res.status(400).json({ error: "status required" }); return; }

  const update: Record<string, unknown> = { status, updatedAt: new Date() };
  if (recordsCount !== undefined) update.recordsCount = recordsCount;
  if (filePath) update.filePath = filePath;

  await db.update(aiTrainingDataExportsTable).set(update).where(eq(aiTrainingDataExportsTable.id, id));
  res.json({ ok: true });
});

// ──────────────────────────── Phase 20: Report Quality Gate ────────────────────────────

/**
 * GET /api/ai-reporting/quality-gates
 * List quality gate checks.
 */
router.get("/quality-gates", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { reportId, passed } = req.query as Record<string, string>;
  const conditions = [];
  if (reportId) conditions.push(eq(reportQualityGatesTable.reportId, Number(reportId)));
  if (passed) conditions.push(eq(reportQualityGatesTable.allPassed, passed === "true"));
  const rows = await db
    .select()
    .from(reportQualityGatesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(reportQualityGatesTable.createdAt));
  res.json(rows);
});

/**
 * POST /api/ai-reporting/quality-gates
 * Run a quality gate check on a report.
 */
router.post("/quality-gates", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const b = req.body as {
    reportId: number;
    findingsPresent?: boolean;
    impressionPresent?: boolean;
    signaturePresent?: boolean;
    clinicalHistoryPresent?: boolean;
    techniquePresent?: boolean;
    comparisonPresent?: boolean;
  };
  if (!b.reportId) { res.status(400).json({ error: "reportId required" }); return; }

  const findingsPresent = b.findingsPresent ?? false;
  const impressionPresent = b.impressionPresent ?? false;
  const signaturePresent = b.signaturePresent ?? false;
  const clinicalHistoryPresent = b.clinicalHistoryPresent ?? false;
  const techniquePresent = b.techniquePresent ?? false;
  const comparisonPresent = b.comparisonPresent ?? false;

  const allPassed = findingsPresent && impressionPresent && signaturePresent;
  const failed = [];
  if (!findingsPresent) failed.push("findings");
  if (!impressionPresent) failed.push("impression");
  if (!signaturePresent) failed.push("signature");
  if (!clinicalHistoryPresent) failed.push("clinical_history");
  if (!techniquePresent) failed.push("technique");
  if (!comparisonPresent) failed.push("comparison");

  const existing = await db
    .select({ id: reportQualityGatesTable.id })
    .from(reportQualityGatesTable)
    .where(eq(reportQualityGatesTable.reportId, b.reportId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(reportQualityGatesTable).set({
      findingsPresent, impressionPresent, signaturePresent,
      clinicalHistoryPresent, techniquePresent, comparisonPresent,
      allPassed, failedChecks: JSON.stringify(failed),
      passedAt: allPassed ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(reportQualityGatesTable.id, existing[0].id));
    res.json({ id: existing[0].id, allPassed, failedChecks: failed });
    return;
  }

  const inserted = await db.insert(reportQualityGatesTable).values({
    reportId: b.reportId,
    findingsPresent, impressionPresent, signaturePresent,
    clinicalHistoryPresent, techniquePresent, comparisonPresent,
    allPassed, failedChecks: JSON.stringify(failed),
    passedAt: allPassed ? new Date() : null,
  }).returning();

  res.json({ id: inserted[0]?.id, allPassed, failedChecks: failed });
});

// ──────────────────────────── Phase 21: Critical Finding Escalation ────────────────────────────

/**
 * GET /api/ai-reporting/critical-findings
 * List critical findings.
 */
router.get("/critical-findings", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { status, patientId } = req.query as Record<string, string>;
  const conditions = [];
  if (status) conditions.push(eq(criticalFindingsTable.status, status));
  if (patientId) conditions.push(eq(criticalFindingsTable.patientId, Number(patientId)));
  const rows = await db
    .select()
    .from(criticalFindingsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(criticalFindingsTable.createdAt));
  res.json(rows);
});

/**
 * POST /api/ai-reporting/critical-findings
 * Create a critical finding record.
 */
router.post("/critical-findings", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const b = req.body as {
    reportId: number;
    worklistId?: number;
    patientId?: number;
    findingKeywords: string[];
    severity?: string;
  };
  if (!b.reportId || !b.findingKeywords?.length) { res.status(400).json({ error: "reportId and findingKeywords required" }); return; }

  const inserted = await db.insert(criticalFindingsTable).values({
    reportId: b.reportId,
    worklistId: b.worklistId ?? null,
    patientId: b.patientId ?? null,
    findingKeywords: JSON.stringify(b.findingKeywords),
    severity: b.severity ?? "high",
  }).returning();

  res.json({ id: inserted[0]?.id });
});

/**
 * PATCH /api/ai-reporting/critical-findings/:id
 * Update notification status.
 */
router.patch("/critical-findings/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const { status, notifiedTo, notificationMethod, escalationReason } = req.body as {
    status: string; notifiedTo?: string; notificationMethod?: string; escalationReason?: string;
  };
  if (!status) { res.status(400).json({ error: "status required" }); return; }

  const update: Record<string, unknown> = { status, updatedAt: new Date() };
  if (notifiedTo) update.notifiedTo = notifiedTo;
  if (notificationMethod) update.notificationMethod = notificationMethod;
  if (escalationReason) update.escalationReason = escalationReason;
  if (status === "notified") update.notifiedAt = new Date();
  if (status === "escalated") update.escalatedAt = new Date();

  await db.update(criticalFindingsTable).set(update).where(eq(criticalFindingsTable.id, id));
  res.json({ ok: true });
});

// ──────────────────────────── Phase 22: AI Provider Health Monitor ────────────────────────────

/**
 * GET /api/ai-reporting/provider-health
 * AI provider health status.
 */
router.get("/provider-health", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { provider, limit = "50" } = req.query as Record<string, string>;
  const conditions = [];
  if (provider) conditions.push(eq(aiProviderHealthLogsTable.provider, provider));
  const rows = await db
    .select()
    .from(aiProviderHealthLogsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(aiProviderHealthLogsTable.createdAt))
    .limit(Number(limit));

  // Compute aggregates per provider
  const providerMap: Record<string, { total: number; success: number; avgLatency: number; lastStatus: string; lastAt: string }> = {};
  for (const row of rows) {
    const p = row.provider;
    const rowAt = row.createdAt ? new Date(row.createdAt).toISOString() : "";
    if (!providerMap[p]) providerMap[p] = { total: 0, success: 0, avgLatency: 0, lastStatus: row.status, lastAt: rowAt };
    providerMap[p].total += 1;
    if (row.isSuccess) providerMap[p].success += 1;
    if (row.latencyMs) providerMap[p].avgLatency += row.latencyMs;
    if (rowAt > providerMap[p].lastAt) {
      providerMap[p].lastStatus = row.status;
      providerMap[p].lastAt = rowAt;
    }
  }
  for (const p of Object.keys(providerMap)) {
    providerMap[p].avgLatency = providerMap[p].total > 0 ? Math.round(providerMap[p].avgLatency / providerMap[p].total) : 0;
  }

  res.json({ logs: rows.slice(0, 20), providers: providerMap });
});

/**
 * POST /api/ai-reporting/provider-health
 * Log a health check result.
 */
router.post("/provider-health", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const b = req.body as {
    provider: string;
    endpointUrl?: string;
    model?: string;
    latencyMs?: number;
    status: string;
    statusCode?: number;
    errorMessage?: string;
    isSuccess?: boolean;
  };
  if (!b.provider || !b.status) { res.status(400).json({ error: "provider and status required" }); return; }

  const inserted = await db.insert(aiProviderHealthLogsTable).values({
    provider: b.provider,
    endpointUrl: b.endpointUrl ?? null,
    model: b.model ?? null,
    latencyMs: b.latencyMs ?? null,
    status: b.status,
    statusCode: b.statusCode ?? null,
    errorMessage: b.errorMessage ?? null,
    isSuccess: b.isSuccess ?? false,
  }).returning();

  res.json({ id: inserted[0]?.id });
});

// ──────────────────────────── Phase 23: Radiology Command Center ────────────────────────────

/**
 * GET /api/ai-reporting/command-center
 * Consolidated KPI dashboard: daily volume, TAT, AI usage, quality scores, anomalies, peer review backlog.
 */
router.get("/command-center", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const today = new Date().toISOString().split("T")[0];

  const [dailyVolume] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(radiologyWorklistTable)
    .where(gte(radiologyWorklistTable.createdAt, new Date(today)));

  const [aiUsage] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiReportingDraftsTable)
    .where(gte(aiReportingDraftsTable.createdAt, new Date(today)));

  const [pendingPeerReview] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(peerReviewAssignmentsTable)
    .where(eq(peerReviewAssignmentsTable.status, "pending"));

  const [openAnomalies] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(anomalyAlertsTable)
    .where(eq(anomalyAlertsTable.status, "open"));

  const [pendingCritical] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(criticalFindingsTable)
    .where(eq(criticalFindingsTable.status, "pending_notification"));

  const [failedQuality] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reportQualityGatesTable)
    .where(eq(reportQualityGatesTable.allPassed, false));

  const [avgTat] = await db
    .select({ avg: sql<number>`COALESCE(AVG(minutes_to_report), 0)::int` })
    .from(turnaroundTimesTable)
    .where(eq(turnaroundTimesTable.dateBucket, today));

  res.json({
    today,
    dailyVolume: dailyVolume?.count ?? 0,
    aiUsageToday: aiUsage?.count ?? 0,
    pendingPeerReview: pendingPeerReview?.count ?? 0,
    openAnomalies: openAnomalies?.count ?? 0,
    pendingCriticalFindings: pendingCritical?.count ?? 0,
    failedQualityGates: failedQuality?.count ?? 0,
    avgTurnaroundMinutes: avgTat?.avg ?? 0,
  });
});

// ──────────────────────────── Phase 24: AI Voice-to-Text Transcription ────────────────────────────

/**
 * GET /api/ai-reporting/voice-transcriptions
 * List all dictations with optional filter.
 */
router.get("/voice-transcriptions", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { status, radiologistId, worklistId, limit = "50" } = req.query;
  const conditions: any[] = [];
  if (status) conditions.push(eq(aiVoiceTranscriptionsTable.status, String(status)));
  if (radiologistId) conditions.push(eq(aiVoiceTranscriptionsTable.radiologistId, Number(radiologistId)));
  if (worklistId) conditions.push(eq(aiVoiceTranscriptionsTable.worklistId, Number(worklistId)));

  const rows = await db
    .select()
    .from(aiVoiceTranscriptionsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(aiVoiceTranscriptionsTable.createdAt))
    .limit(Number(limit));

  res.json(rows);
});

/**
 * GET /api/ai-reporting/voice-transcriptions/:id
 * Detail view of a single transcription.
 */
router.get("/voice-transcriptions/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const [row] = await db.select().from(aiVoiceTranscriptionsTable).where(eq(aiVoiceTranscriptionsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Transcription not found" }); return; }
  res.json(row);
});

/**
 * POST /api/ai-reporting/voice-transcriptions
 * Create a new dictation record. In production, this would be triggered by audio upload.
 * For now, it records the metadata and stores a placeholder audio URL.
 */
router.post("/voice-transcriptions", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { worklistId, reportId, patientId, modality, bodyPart, audioUrl, audioDurationSeconds } = req.body;
  if (!worklistId) { res.status(400).json({ error: "worklistId is required" }); return; }

  const [wl] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, Number(worklistId))).limit(1);
  const patientIdResolved = wl?.patientId ?? null;
  const patient = patientIdResolved ? await db.select().from(patientsTable).where(eq(patientsTable.id, patientIdResolved)).limit(1) : [];
  const session = sReq.staffSession!;

  const inserted = await db.insert(aiVoiceTranscriptionsTable).values({
    worklistId: Number(worklistId),
    reportId: reportId ? Number(reportId) : null,
    patientId: patient?.[0]?.id ?? wl?.patientId ?? null,
    radiologistId: session.subjectId,
    radiologistName: session.subjectName ?? null,
    audioUrl: audioUrl ?? null,
    audioDurationSeconds: audioDurationSeconds ? Number(audioDurationSeconds) : null,
    modality: modality ?? wl?.modality ?? null,
    bodyPart: bodyPart ?? null,
    status: "pending",
    aiSafetyLabel: "AI Draft – Requires Radiologist Review",
  }).returning({ id: aiVoiceTranscriptionsTable.id });

  res.json({ id: inserted[0]?.id, message: "Dictation recorded. Use /transcribe to generate transcript." });
});

/**
 * POST /api/ai-reporting/voice-transcriptions/:id/transcribe
 * Voice transcription engine is not configured (fail closed).
 * Returns 501 — does not invent findings/impression from modality.
 */
router.post("/voice-transcriptions/:id/transcribe", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const [row] = await db.select().from(aiVoiceTranscriptionsTable).where(eq(aiVoiceTranscriptionsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Transcription not found" }); return; }

  // Simulated modality FINDINGS/IMPRESSION generator is intentionally disabled.
  // This endpoint previously invented clinical text instead of transcribing audio.
  res.status(501).json({
    error: "Voice transcription is not configured. No findings or impression were generated.",
    code: "voice_transcription_engine_not_configured",
  });
  return;
});


/**
 * PATCH /api/ai-reporting/voice-transcriptions/:id
 * Radiologist corrects the transcript. Updates correctedText and status.
 */
router.patch("/voice-transcriptions/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const { correctedText, status } = req.body;
  const [row] = await db.select().from(aiVoiceTranscriptionsTable).where(eq(aiVoiceTranscriptionsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Transcription not found" }); return; }

  const updateData: any = { updatedAt: new Date() };
  if (correctedText !== undefined) updateData.correctedText = correctedText;
  if (status) updateData.status = status;

  await db.update(aiVoiceTranscriptionsTable).set(updateData).where(eq(aiVoiceTranscriptionsTable.id, id));

  res.json({ id, correctedText: updateData.correctedText ?? row.correctedText, status: updateData.status ?? row.status });
});

/**
 * POST /api/ai-reporting/voice-transcriptions/:id/insert
 * Insert the corrected transcript into the radiology report.
 * Links to the report generator via reportId or worklistId.
 */
router.post("/voice-transcriptions/:id/insert", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const [row] = await db.select().from(aiVoiceTranscriptionsTable).where(eq(aiVoiceTranscriptionsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Transcription not found" }); return; }

  const correctedText = row.correctedText ?? row.rawTranscript;
  if (!correctedText) { res.status(400).json({ error: "No corrected text available to insert" }); return; }

  await db.update(aiVoiceTranscriptionsTable)
    .set({ insertedIntoReport: true, status: "inserted", updatedAt: new Date() })
    .where(eq(aiVoiceTranscriptionsTable.id, id));

  res.json({
    id,
    insertedText: correctedText,
    aiSafetyLabel: "AI Draft – Requires Radiologist Review",
    message: "Transcript inserted into report. Radiologist must review and finalize.",
  });
});

// ──────────────────────────── Phase 25: AI Patient Communication Assistant ────────────────────────────

/**
 * GET /api/ai-reporting/patient-communications
 * List all AI-drafted patient communications with optional filter.
 */
router.get("/patient-communications", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { status, patientId, communicationType, limit = "50" } = req.query;
  const conditions: any[] = [];
  if (status) conditions.push(eq(aiPatientCommunicationsTable.status, String(status)));
  if (patientId) conditions.push(eq(aiPatientCommunicationsTable.patientId, Number(patientId)));
  if (communicationType) conditions.push(eq(aiPatientCommunicationsTable.communicationType, String(communicationType)));

  const rows = await db
    .select()
    .from(aiPatientCommunicationsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(aiPatientCommunicationsTable.createdAt))
    .limit(Number(limit));

  res.json(rows);
});

/**
 * GET /api/ai-reporting/patient-communications/:id
 * Detail view of a single communication.
 */
router.get("/patient-communications/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const [row] = await db.select().from(aiPatientCommunicationsTable).where(eq(aiPatientCommunicationsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Communication not found" }); return; }
  res.json(row);
});

/**
 * POST /api/ai-reporting/patient-communications
 * Create a new patient communication record. The AI draft is generated based on the original report text.
 */
router.post("/patient-communications", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { worklistId, reportId, patientId, communicationType, language, originalText } = req.body;
  if (!originalText) { res.status(400).json({ error: "originalText is required" }); return; }

  const session = sReq.staffSession!;

  const inserted = await db.insert(aiPatientCommunicationsTable).values({
    worklistId: worklistId ? Number(worklistId) : null,
    reportId: reportId ? Number(reportId) : null,
    patientId: patientId ? Number(patientId) : null,
    communicationType: communicationType ?? "result_summary",
    language: language ?? "en",
    originalText: originalText,
    aiDraft: null,
    status: "pending",
    aiSafetyLabel: "AI Draft – Requires Radiologist Review",
  }).returning({ id: aiPatientCommunicationsTable.id });

  res.json({ id: inserted[0]?.id, message: "Communication record created. Use /draft to generate AI draft." });
});

/**
 * POST /api/ai-reporting/patient-communications/:id/draft
 * Patient-communication AI draft generation is disabled (fail closed).
 * Returns 501 — does not invent clinical interpretation.
 */
router.post("/patient-communications/:id/draft", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const [row] = await db.select().from(aiPatientCommunicationsTable).where(eq(aiPatientCommunicationsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Communication not found" }); return; }

  // AI patient-communication draft generation is intentionally disabled.
  // The previous handler returned canned "normal findings" / "follow up in 2 weeks"
  // text that ignored the report — unsafe for clinical use.
  res.status(501).json({
    error: "AI patient-friendly summaries are not enabled yet. The diagnostic report remains available unchanged.",
    code: "patient_communication_ai_not_configured",
  });
  return;
});

/**
 * PATCH /api/ai-reporting/patient-communications/:id
 * Radiologist reviews and edits the AI draft. Updates status to reviewed.
 */
router.patch("/patient-communications/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const { aiDraft, status } = req.body;
  const [row] = await db.select().from(aiPatientCommunicationsTable).where(eq(aiPatientCommunicationsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Communication not found" }); return; }

  const session = sReq.staffSession!;
  const updateData: any = { updatedAt: new Date() };
  if (aiDraft !== undefined) updateData.aiDraft = aiDraft;
  if (status) {
    updateData.status = status;
    if (status === "reviewed") {
      updateData.reviewedById = session.subjectId;
      updateData.reviewedByName = session.subjectName ?? null;
      updateData.reviewedAt = new Date();
    }
  }

  await db.update(aiPatientCommunicationsTable).set(updateData).where(eq(aiPatientCommunicationsTable.id, id));

  res.json({ id, aiDraft: updateData.aiDraft ?? row.aiDraft, status: updateData.status ?? row.status });
});

/**
 * POST /api/ai-reporting/patient-communications/:id/send
 * Mark the reviewed communication as sent. Does NOT send actual SMS/email —
 * that is handled by the existing notification system (WhatsApp, email, etc.).
 */
router.post("/patient-communications/:id/send", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const [row] = await db.select().from(aiPatientCommunicationsTable).where(eq(aiPatientCommunicationsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Communication not found" }); return; }

  if (row.status !== "reviewed") {
    res.status(400).json({ error: "Communication must be reviewed before sending." });
    return;
  }

  const session = sReq.staffSession!;
  await db.update(aiPatientCommunicationsTable)
    .set({
      status: "sent",
      sentAt: new Date(),
      sentById: session.subjectId,
      sentByName: session.subjectName ?? null,
      updatedAt: new Date(),
    })
    .where(eq(aiPatientCommunicationsTable.id, id));

  res.json({
    id,
    status: "sent",
    message: "Communication marked as sent. Integrate with WhatsApp/email API for actual delivery.",
  });
});

// ──────────────────────────── Phase 26: One-Click Normal Report Templates ────────────────────────────

/**
 * GET /api/ai-reporting/normal-templates
 * List all normal report templates with optional filter by modality.
 */
router.get("/normal-templates", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { modality, category } = req.query;
  const conditions: any[] = [];
  if (modality) conditions.push(eq(aiNormalReportTemplatesTable.modality, String(modality)));
  if (category) conditions.push(eq(aiNormalReportTemplatesTable.category, String(category)));

  const rows = await db
    .select()
    .from(aiNormalReportTemplatesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(aiNormalReportTemplatesTable.sortOrder);

  res.json(rows);
});

/**
 * GET /api/ai-reporting/normal-templates/:id
 * Detail view of a single template.
 */
router.get("/normal-templates/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const [row] = await db.select().from(aiNormalReportTemplatesTable).where(eq(aiNormalReportTemplatesTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(row);
});

/**
 * POST /api/ai-reporting/normal-templates
 * Create a new normal report template.
 */
router.post("/normal-templates", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { name, modality, bodyPart, category, findings, impression, technique, clinicalHistory, comparison, sortOrder } = req.body;
  if (!name || !modality || !findings || !impression) { res.status(400).json({ error: "name, modality, findings, impression are required" }); return; }

  const inserted = await db.insert(aiNormalReportTemplatesTable).values({
    name, modality, bodyPart: bodyPart ?? null, category: category || "normal", findings, impression,
    technique: technique ?? null, clinicalHistory: clinicalHistory ?? null, comparison: comparison ?? null,
    sortOrder: sortOrder ? Number(sortOrder) : 0,
  }).returning({ id: aiNormalReportTemplatesTable.id });

  res.json({ id: inserted[0]?.id });
});

/**
 * PATCH /api/ai-reporting/normal-templates/:id
 * Update a template.
 */
router.patch("/normal-templates/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const { name, modality, bodyPart, category, findings, impression, technique, clinicalHistory, comparison, sortOrder } = req.body;
  const [row] = await db.select().from(aiNormalReportTemplatesTable).where(eq(aiNormalReportTemplatesTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }

  const updateData: any = { updatedAt: new Date() };
  if (name !== undefined) updateData.name = name;
  if (modality !== undefined) updateData.modality = modality;
  if (bodyPart !== undefined) updateData.bodyPart = bodyPart;
  if (category !== undefined) updateData.category = category;
  if (findings !== undefined) updateData.findings = findings;
  if (impression !== undefined) updateData.impression = impression;
  if (technique !== undefined) updateData.technique = technique;
  if (clinicalHistory !== undefined) updateData.clinicalHistory = clinicalHistory;
  if (comparison !== undefined) updateData.comparison = comparison;
  if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder);

  await db.update(aiNormalReportTemplatesTable).set(updateData).where(eq(aiNormalReportTemplatesTable.id, id));
  res.json({ id, ...updateData });
});

/**
 * DELETE /api/ai-reporting/normal-templates/:id
 * Remove a template.
 */
router.delete("/normal-templates/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  await db.delete(aiNormalReportTemplatesTable).where(eq(aiNormalReportTemplatesTable.id, id));
  res.json({ ok: true });
});

/**
 * POST /api/ai-reporting/normal-templates/:id/apply
 * Apply a normal template to a worklist. Returns the full report text.
 */
router.post("/normal-templates/:id/apply", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const { worklistId } = req.body;
  if (!worklistId) { res.status(400).json({ error: "worklistId is required" }); return; }

  const [template] = await db.select().from(aiNormalReportTemplatesTable).where(eq(aiNormalReportTemplatesTable.id, id)).limit(1);
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  const [wl] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, Number(worklistId))).limit(1);
  if (!wl) { res.status(404).json({ error: "Worklist not found" }); return; }

  const session = sReq.staffSession!;
  const reportText = [
    "CLINICAL HISTORY:", template.clinicalHistory ?? "As per referral.",
    "\nTECHNIQUE:", template.technique ?? `${wl.modality} of ${template.bodyPart ?? wl.studyDescription ?? "the requested region"}.`,
    "\nCOMPARISON:", template.comparison ?? "None available.",
    "\nFINDINGS:", template.findings,
    "\nIMPRESSION:", template.impression,
    "\n\n[Reported by: " + (session.subjectName ?? "Radiologist") + "]",
  ].join("\n");

  res.json({
    worklistId: Number(worklistId),
    templateId: id,
    templateName: template.name,
    reportText,
    aiSafetyLabel: "AI Draft – Requires Radiologist Review",
    message: "Template applied. Radiologist must review and finalize the report.",
  });
});

/**
 * POST /api/ai-reporting/normal-templates/merge
 * Merge N templates into a single report. Deduplicates common phrases.
 */
router.post("/normal-templates/merge", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const { templateIds } = req.body as { templateIds?: number[] };
  if (!Array.isArray(templateIds) || templateIds.length < 2) { res.status(400).json({ error: "templateIds must be an array of at least 2 IDs" }); return; }

  const templates = await db
    .select()
    .from(aiNormalReportTemplatesTable)
    .where(inArray(aiNormalReportTemplatesTable.id, templateIds));

  const byId = new Map(templates.map((t) => [t.id, t]));
  const ordered = templateIds.map((id) => byId.get(id)).filter(Boolean) as typeof templates;
  if (ordered.length === 0) { res.status(404).json({ error: "No valid templates found" }); return; }

  const session = sReq.staffSession!;

  // Deduplicate common sentences across findings
  const allSentences = ordered.flatMap((t) => t.findings.split(/\.\s+/));
  const sentenceCounts = new Map<string, number>();
  for (const s of allSentences) {
    const key = s.trim().toLowerCase().replace(/\s+/g, " ");
    if (key.length > 10) sentenceCounts.set(key, (sentenceCounts.get(key) || 0) + 1);
  }
  const commonSentences = new Set([...sentenceCounts.entries()].filter(([, c]) => c > 1).map(([k]) => k));

  const dedupedFindings = ordered.map((t) => {
    const sentences = t.findings.split(/\.\s+/);
    const unique = sentences.filter((s) => {
      const key = s.trim().toLowerCase().replace(/\s+/g, " ");
      return key.length <= 10 || !commonSentences.has(key);
    });
    return { ...t, uniqueFindings: unique.join(". ") };
  });

  const mergedName = ordered.map((t) => `${t.modality} ${t.bodyPart || t.name.split("–")[0]?.trim() || ""}`.replace(/\s+/g, " ").trim()).join(" + ");
  const mergedHeading = ordered.map((t) => `${t.modality} ${t.bodyPart || ""}`.replace(/\s+/g, " ").trim()).join(" WITH ");

  const mergedFindings = dedupedFindings.map((t) => `=== ${t.modality} – ${t.bodyPart || "Study"} ===\n${t.uniqueFindings}`).join("\n\n");
  const mergedImpression = ordered.map((t) => `• ${t.impression}`).join("\n");
  const mergedTechnique = [...new Set(ordered.map((t) => t.technique).filter(Boolean))].join("; ");
  const mergedClinicalHistory = [...new Set(ordered.map((t) => t.clinicalHistory).filter(Boolean))].join("; ");
  const mergedComparison = [...new Set(ordered.map((t) => t.comparison).filter(Boolean))].join("; ");

  const reportText = [
    "STUDY:", mergedHeading,
    "\nCLINICAL HISTORY:", mergedClinicalHistory || "As per referral.",
    "\nTECHNIQUE:", mergedTechnique || "As per protocol.",
    "\nCOMPARISON:", mergedComparison || "None available.",
    "\nFINDINGS:", mergedFindings,
    "\nIMPRESSION:", mergedImpression,
    "\n\n[Reported by: " + (session.subjectName ?? "Radiologist") + "]",
  ].join("\n");

  res.json({
    templateIds,
    mergedName,
    mergedHeading,
    reportText,
    aiSafetyLabel: "AI Draft – Requires Radiologist Review",
    message: "Merged templates applied. Radiologist must review and finalize.",
  });
});

export const aiReportingRouter = router;
