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
import { createHash } from "node:crypto";
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
import { auditFromRequest } from "../lib/audit";
import {
  sanitizeGlobalSettingsPatch,
  readAiSecurityModeFromJson,
  resolveAiSecurityPolicy,
  resolveInteractiveImageEgress,
  parseAiSecurityMode,
  FALLBACK_AI_SECURITY_MODE,
  type AiSecurityMode,
} from "../lib/ai/aiSecurityPolicy";
import { resolveAuditLocality } from "../lib/ai/imageSendAudit";
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
  classifyEffectiveLocality,
  normalizeAiFailure,
  type AiFailure,
  cloudTextPhiAllowed,
  detectPhiCategories,
  scrubPhiText,
  type PhiCategory,
} from "@workspace/ai-providers";
import { radiologyWorklistTable } from "@workspace/db/schema";
import { assertDraftWritable, RadiologyIdentityError, resolveAuthorizedStudyUid } from "../lib/radiologyIdentity";
import {
  bindInteractiveStudy,
  refuseConflictingPatientClaim,
} from "../lib/ai/interactiveStudyBinding";
import { resolveTestModel } from "../lib/ai/testProviderModel";
import { DICOM_REDACTION_PERFORMED } from "../lib/ai/dicomRedaction";
import {
  AiReportingDraftRequestSchema,
  AiReportingQueryRequestSchema,
  type AiDraftValidation,
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
import { resolveAiAuditOutcome } from "../lib/ai/aiAuditOutcome";
import {
  draftInstructionBlock,
  draftParseFailureMessage,
  parseDraftOutput,
} from "../lib/ai/draftOutputContract";
import {
  executeInteractiveAiCall,
  resolveInteractiveTarget,
  type InteractiveTarget,
} from "../lib/ai/interactiveAiGateway";
import { resolveLocalAiRuntime } from "../lib/aiPipeline/runtimeConfig";
import {
  impressionMatchesStudyContext,
  resolveBuiltinPromptForStudy,
  studyLooksLikeBrain,
  studyLooksLikeChest,
} from "../lib/aiDraftStudyContext";
import { validateComposerOutput } from "../lib/reportComposer/validateOutput";
import { parseComposerSnapshot } from "../lib/reportComposer/types";
import type { CanalApComposerRecord } from "@workspace/measurements";

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

type AiGlobalSettings = {
  enabled: boolean;
  defaultProvider: string;
  defaultPrompt: string;
  defaultPromptTemplate: string;
  includeDemographics: boolean;
  anonymize: boolean;
  /** Opt-in to send prompt text that names a patient to a cloud provider. */
  cloudTextPhiAllowed: boolean;
  /**
   * PR-A2: how strict the image-egress policy is. Normalized on read rather than
   * passed through, so a row written before validation existed cannot make the
   * server permissive by carrying a typo.
   */
  aiSecurityMode: AiSecurityMode;
  allowedRoles: string[];
};

async function getGlobalSettings(): Promise<AiGlobalSettings> {
  const row = await db
    .select({ settingsJson: aiProviderSettingsTable.settingsJson })
    .from(aiProviderSettingsTable)
    .where(eq(aiProviderSettingsTable.provider, "__global__"))
    .limit(1);

  const defaults: AiGlobalSettings = {
    enabled: false,
    defaultProvider: "gemini",
    defaultPrompt: "",
    defaultPromptTemplate: "",
    includeDemographics: false,
    anonymize: true,
    cloudTextPhiAllowed: false,
    aiSecurityMode: FALLBACK_AI_SECURITY_MODE,
    allowedRoles: ["admin", "super_admin", "doctor", "radiologist"],
  };

  if (!row[0]?.settingsJson) {
    return { ...defaults, enabled: await isFeatureEnabledServer(AI_MASTER_FLAG) };
  }
  try {
    const raw = JSON.parse(row[0].settingsJson) as Partial<AiGlobalSettings>;
    return {
      ...defaults,
      ...raw,
      aiSecurityMode: parseAiSecurityMode(raw.aiSecurityMode),
      enabled: await isFeatureEnabledServer(AI_MASTER_FLAG),
    };
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

/**
 * PR-A2B — provenance, stated by the server about the bytes it fetched itself.
 *
 * Every frame an interactive route sends is a JPEG Orthanc rendered from the study
 * this server named, so the source is a fact, not a label the caller chose. The
 * overnight path derives it the identical way (`gatewayInferenceProvider.ts`). An
 * empty count yields an empty list, which the egress helper then omits — an omission
 * the gate reads as "unprovenanced", never as "clean".
 */
function serverResolvedProvenance(imageCount: number): string[] {
  return imageCount > 0 ? Array.from({ length: imageCount }, () => "DICOM") : [];
}

/**
 * PR-A2B — WHO attested, taken off the session rather than out of the body.
 *
 * A request can claim that a clinician confirmed this cloud send; it cannot choose
 * whose name the audit row carries, and it cannot set the clinic's opt-in. That is
 * the difference between an attestation and an authorization, and the reason a
 * boolean in `req.body` is not the thing that lets pixels out of the clinic.
 */
function attestationSubject(
  user: { subjectId: number },
  asserted: boolean | undefined,
): string | null {
  return asserted === true ? `staff-user:${user.subjectId}` : null;
}

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

  // Soft-seed Local OpenAI-Compatible *provider* row only (Bonsai-friendly
  // Settings pre-fill). Never creates/modifies ai_model_routes — opening
  // Settings must not change task routing.
  try {
    const { ensureLocalOpenAiCompatibleDefaults } = await import(
      "../lib/reportComposer/providers/localOpenAiCompatibleConfig"
    );
    await ensureLocalOpenAiCompatibleDefaults();
  } catch {
    /* non-fatal */
  }

  // Re-load providers after soft-seed so the new row appears.
  const providersFresh = await loadProviderConfigs();

  const providersOut: Record<string, object> = {};
  for (const p of providersFresh) {
    const meta = BUILTIN_PROVIDER_CONFIGS[p.provider];
    let displayName: string | null = null;
    let supportsVision = true;
    let supportsText = true;
    let execution: "LOCAL" | "CLOUD" =
      p.provider === "ollama" || p.provider === "local_openai_compatible" ? "LOCAL" : "CLOUD";
    if (p.provider === "local_openai_compatible") {
      const [row] = await db
        .select({ settingsJson: aiProviderSettingsTable.settingsJson })
        .from(aiProviderSettingsTable)
        .where(eq(aiProviderSettingsTable.provider, "local_openai_compatible"))
        .limit(1);
      if (row?.settingsJson) {
        try {
          const parsed = JSON.parse(row.settingsJson) as {
            displayName?: string;
            supportsVision?: boolean;
            supportsText?: boolean;
          };
          displayName = parsed.displayName?.trim() || "Bonsai 2 27B";
          supportsVision = parsed.supportsVision !== false;
          supportsText = parsed.supportsText !== false;
        } catch {
          displayName = "Bonsai 2 27B";
        }
      } else {
        displayName = "Bonsai 2 27B";
      }
    }
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
      displayName,
      supportsVision,
      supportsText,
      execution,
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
      cloudTextPhiAllowed?: boolean;
      /** PR-A2: "development" | "clinical"; validated and admin-gated below. */
      aiSecurityMode?: string;
      allowedRoles?: string[];
    };
    providers?: Record<string, {
      isEnabled?: boolean;
      isDefault?: boolean;
      apiKey?: string;
      defaultModel?: string;
      endpointUrl?: string;
      displayName?: string;
      supportsVision?: boolean;
      supportsText?: boolean;
      jsonMode?: boolean;
    }>;
  };

  if (globalIn !== undefined) {
    // STAGE 1 PR-A2 — this merge used to be `{ ...previous, ...requestBody }`, which
    // persisted any key a client invented. Harmless while every reader picked named
    // keys; not harmless once a SECURITY MODE lives in the same object, where
    // "developmen" or "dev" would be a value the server has to interpret. So the
    // keys are allowlisted and typed here, and an unknown key is refused with a 400
    // instead of being dropped silently — a silently dropped key reads as "saved" to
    // the person who sent it.
    const sanitized = sanitizeGlobalSettingsPatch(globalIn);
    if (!sanitized.ok) {
      res.status(400).json({ error: sanitized.error });
      return;
    }

    // Ruling: only admin / super_admin may change the AI security mode. The rest of
    // AI configuration stays on `canConfigure()` (`ai_reporting.configure` included),
    // because that permission is what this whole screen was built for; the mode is
    // the one field that decides how much patient data may leave, so it is not
    // delegated the same way.
    const session = getStaffSession(sReq);
    if (
      sanitized.patch.aiSecurityMode !== undefined &&
      !(session && FULL_ACCESS_ROLES.has(session.role))
    ) {
      res.status(403).json({
        error: "Only administrators can change the AI security mode.",
      });
      return;
    }

    const existing = await db
      .select({ id: aiProviderSettingsTable.id, settingsJson: aiProviderSettingsTable.settingsJson })
      .from(aiProviderSettingsTable)
      .where(eq(aiProviderSettingsTable.provider, "__global__"))
      .limit(1);

    const prev = existing[0]?.settingsJson
      ? (() => { try { return JSON.parse(existing[0].settingsJson!) as object; } catch { return {}; } })()
      : {};
    const next = { ...prev, ...sanitized.patch };

    if (existing[0]) {
      await db.update(aiProviderSettingsTable)
        .set({ settingsJson: JSON.stringify(next) })
        .where(eq(aiProviderSettingsTable.id, existing[0].id));
    } else {
      await db.insert(aiProviderSettingsTable).values({ provider: "__global__", settingsJson: JSON.stringify(next) });
    }

    // The mode change is recorded in the clinic's existing hash-chained audit trail,
    // with the old and new values, by the existing helper. No second settings-history
    // table: `audit_logs` already carries oldValue/newValue and a `settings` module,
    // and `auditLog` never throws, so an audit failure cannot strand a save.
    if (sanitized.modeChanged) {
      const before = readAiSecurityModeFromJson(existing[0]?.settingsJson);
      const after = sanitized.patch.aiSecurityMode as AiSecurityMode;
      if (before !== after) {
        await auditFromRequest(req, {
          userId: session?.subjectId ?? null,
          userName: session?.subjectName ?? "system",
          role: session?.role ?? "system",
          action: "ai_security_mode_changed",
          module: "settings",
          entityType: "ai_provider_settings",
          entityId: "__global__",
          oldValue: before,
          newValue: after,
          reason: "AI image-egress policy strictness changed by an administrator",
        });
      }
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
    if (provName === "local_openai_compatible") {
      const prevJson = existing[0]?.settingsJson
        ? (() => {
            try {
              return JSON.parse(existing[0].settingsJson!) as Record<string, unknown>;
            } catch {
              return {};
            }
          })()
        : {};
      update.settingsJson = JSON.stringify({
        ...prevJson,
        displayName:
          typeof pd.displayName === "string" && pd.displayName.trim()
            ? pd.displayName.trim()
            : (prevJson.displayName as string) || "Bonsai 2 27B",
        supportsVision: pd.supportsVision !== false,
        supportsText: pd.supportsText !== false,
        jsonMode: pd.jsonMode === true ? true : (prevJson.jsonMode === true),
      });
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

  const { provider, apiKey, model, endpointUrl, probeVision } = req.body as {
    provider: string;
    apiKey?: string;
    model?: string;
    endpointUrl?: string;
    probeVision?: boolean;
  };

  if (!BUILTIN_PROVIDER_NAMES.includes(provider)) {
    res.status(400).json({ error: "Unknown provider." }); return;
  }

  const config = BUILTIN_PROVIDER_CONFIGS[provider];
  let key = apiKey?.trim() ?? "";
  let url = endpointUrl?.trim() ?? "";

  if (config.needsEndpointUrl) {
    if (!url) {
      const stored = await getProviderEndpointUrl(provider);
      if (stored) {
        url = stored;
      } else if (
        provider === "deepseek" ||
        provider === "qwen" ||
        provider === "openai" ||
        provider === "local_openai_compatible"
      ) {
        const { readEnvBaseUrl, COMPATIBLE_PROVIDER_DEFAULTS } = await import("@workspace/ai-providers");
        url = (readEnvBaseUrl(provider) || COMPATIBLE_PROVIDER_DEFAULTS[provider]?.baseURL || "").trim();
      }
      if (!url) {
        res.status(400).json({ error: `No endpoint URL configured for ${config.label}.` });
        return;
      }
    }
  } else {
    if (!key) {
      const stored = await getProviderApiKey(provider);
      if (!stored) { res.status(400).json({ error: "No API key configured for this provider." }); return; }
      key = stored;
    }
  }

  // Cloud OpenAI-compatible providers also accept env API keys when the form/DB key is empty.
  if ((provider === "deepseek" || provider === "qwen" || provider === "openai") && !key) {
    const stored = await getProviderApiKey(provider);
    if (stored) {
      key = stored;
    } else {
      const { readEnvApiKey } = await import("@workspace/ai-providers");
      key = readEnvApiKey(provider) ?? "";
    }
    if (!key) {
      res.status(400).json({ error: "No API key configured for this provider." });
      return;
    }
  }

  // Local OpenAI-Compatible: optional API key (DB/env); empty allowed.
  if (provider === "local_openai_compatible" && !key) {
    const stored = await getProviderApiKey(provider);
    if (stored) key = stored;
    else {
      const { readEnvApiKey } = await import("@workspace/ai-providers");
      key = readEnvApiKey(provider) ?? "";
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
  let visionResult: "pass" | "fail" | "skipped" = "skipped";
  if (probeVision === true && provider === "local_openai_compatible") {
    const maybeVision = instance as { testVision?: (model?: string) => Promise<{ ok: boolean; message: string }> };
    if (typeof maybeVision.testVision === "function") {
      const v = await maybeVision.testVision(modelToTest ?? undefined);
      visionResult = v.ok ? "pass" : "fail";
    }
  }

  res.json({
    success: result.ok,
    model: modelToTest ?? null,
    response: result.message.substring(0, 200),
    availableModels: result.availableModels,
    error: result.ok ? undefined : result.message,
    text: result.ok ? "pass" : "fail",
    vision: visionResult,
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
  const requestId = newAiRequestId();

  const parsedBody = AiReportingQueryRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    const first = parsedBody.error.issues[0];
    res.status(400).json({
      error: `Invalid AI query request: ${first ? `${first.path.join(".") || "body"} — ${first.message}` : "malformed body"}`,
    });
    return;
  }

  const {
    studyInstanceUID: claimedStudyUid,
    patientId: claimedPatientId,
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
    attestCloudImageEgress,
  } = parsedBody.data;

  // TASK E-1 — the same rule `/draft` applies: a request may only name a study this
  // clinic has. `fetchStudyImages` below asks Orthanc for whatever UID arrives, and
  // the audit row at the end files the answer under it, so an unconfirmed UID meant
  // patient frames in front of a model with no row on this server to say whose they
  // were. Confirmed here, and nothing downstream has to re-derive it: the UID a bound
  // request carries is the one the lookup matched.
  const queryBinding = await bindInteractiveStudy({ studyInstanceUID: claimedStudyUid });
  if (!queryBinding.ok) {
    res
      .status(queryBinding.httpStatus)
      .json({ error: queryBinding.message, code: queryBinding.code });
    return;
  }

  // TASK E / the integrated-system ruling — the study is bound, so its patient is
  // known, and the copy in the body is not a second opinion. Below, `patientId` is
  // used to fetch the age and sex that go INTO the prompt, and both it and the
  // accession are filed on the audit row; taking either from the caller let a request
  // dress patient A's study as patient B and leave a record saying so. These three
  // locals are the only identity this route uses from here on — the body's
  // `accessionNumber` is not read at all, since only this server's row can say what a
  // study's accession is.
  const queryIdentity = refuseConflictingPatientClaim(queryBinding, claimedPatientId);
  if (!queryIdentity.ok) {
    res
      .status(queryIdentity.httpStatus)
      .json({ error: queryIdentity.message, code: queryIdentity.code });
    return;
  }
  const studyInstanceUID = queryIdentity.studyInstanceUID;
  const accessionNumber = queryIdentity.accessionNumber;
  const patientId = queryIdentity.patientId;

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

  // Optionally append patient demographics — of the patient this study belongs to.
  //
  // `demographicsInPrompt` is what the audit column gets, because the column answers a
  // question about the prompt and nothing else: on the old line a request could set
  // `includeDemographics`, have no patient to look up (or a lookup that threw), and
  // still file a record saying identifiers went to the provider. The setting and the
  // fact are not the same measurement.
  let demographicsInPrompt = false;
  if (includeDemographics && patientId && !shouldAnonymize) {
    try {
      const pt = await db
        .select({
          // C1 — deliberately NOT selecting the name. Age and sex change what a
          // finding means ("post-menopausal", "at this level of degeneration");
          // a patient's name helps a model summarise a scan in no way at all, and
          // it is the one identifier here that cannot be defended in a prompt
          // heading for a cloud provider. `includeDemographics` now means clinical
          // demographics, not identity — so the name is never fetched either.
          ageValue: patientsTable.ageValue,
          gender: patientsTable.gender,
        })
        .from(patientsTable)
        .where(eq(patientsTable.id, patientId))
        .limit(1);
      if (pt[0]) {
        finalPrompt += `\n\nAge: ${pt[0].ageValue ?? "Unknown"}, Gender: ${pt[0].gender ?? "Unknown"}`;
        demographicsInPrompt = true;
      }
    } catch {
      // non-critical
    }
  }

  if (shouldAnonymize) {
    // The images are a PACS render with the overlay text composited into the
    // pixels, so they can still carry the name, ID and date of birth. The old
    // wording told the model those had been removed — a statement about a step
    // that never runs. This one is true and gives the model something to do.
    finalPrompt = `[Privacy: these images are NOT de-identified and may show the patient's name, ID or date of birth. Do not transcribe any identifier into your answer — refer to "the patient".]\n\n${finalPrompt}`;
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

  // PR-A2B — the clinic's own egress decision, resolved server-side, travels with
  // the pixels. `/query` used to hand `generateAiResponse` nothing but a model, and
  // the image gate denies on a missing term: an authenticated radiologist with
  // Development mode and cloud vision switched on in Settings was refused, while the
  // Settings screen said the door was open.
  const queryImageSourceTypes = serverResolvedProvenance(images.length);
  const queryEgress = await resolveInteractiveImageEgress({
    imageCount: images.length,
    imageSourceTypes: queryImageSourceTypes,
    attestedBy: attestationSubject(user, attestCloudImageEgress),
  });

  // Call AI provider via unified abstraction
  const aiResult = await generateAiResponse(providerName, finalPrompt, images, {
    model,
    ...queryEgress.options,
  });
  // C1 — `/query` already passed its resolved provider to the execution layer, so
  // there was never a second resolution to disagree with the first. What it lacked
  // was the identity the layer reports back: the audit row and the response said
  // what had been ASKED FOR. Now they say what ran, and a provider that cannot be
  // confirmed is not a success.
  const executedIdentity = aiResult.execution ?? null;
  // An answer from a provider that cannot be confirmed needs the same code the
  // gateway raises on `/draft`. Without this branch `/query` answered a refusal
  // with `failure: null` — the one shape a radiologist-facing screen cannot
  // explain, because "the model answered but I cannot attribute it" looks like
  // "nothing happened" on the wire.
  const queryIdentityMismatch = aiResult.success && executedIdentity?.provider !== providerName;
  const queryFailure = queryIdentityMismatch
    ? normalizeAiFailure(aiResult, {
        code: "UNKNOWN",
        detailCode: "PROVIDER_IDENTITY_MISMATCH",
        message:
          `The AI execution layer reported ${executedIdentity?.provider ?? "no provider"} for a request sent to `
          + `${providerName}, so the answer was discarded rather than recorded under a provider that cannot be `
          + "confirmed to have produced it.",
      })
    : normalizeAiFailure(aiResult);
  const success = aiResult.success && executedIdentity?.provider === providerName;
  const aiResponse = success ? aiResult.text : "";
  const errorMsg = queryFailure?.message ?? aiResult.error;
  // What the screen shows and what the record claims are two different questions.
  // `success` above still governs the HTTP status, exactly as it always did; the
  // audit column asks the harder one — was there clinical content to read. On the
  // old line `/query` could file `success = true` beside a non-null `error_message`
  // saying the provider returned nothing, one row asserting and denying the same
  // thing. `/draft` already refused that; `/query` now agrees with it.
  const auditOutcome = resolveAiAuditOutcome({
    providerReportedSuccess: aiResult.success,
    identityVerified: executedIdentity?.provider === providerName,
    failure: queryFailure,
    answerText: aiResult.text,
    providerError: aiResult.error,
  });

  // Audit log (non-critical)
  await db.insert(aiReportingAuditLogsTable).values({
    userId: user.subjectId,
    userName: user.subjectName,
    patientId: patientId ?? null,
    studyInstanceUID: studyInstanceUID ?? null,
    accessionNumber: accessionNumber ?? null,
    provider: executedIdentity?.provider ?? providerName,
    model: executedIdentity?.model ?? (model || null),
    promptText: finalPrompt.substring(0, 2000),
    numImages: images.length,
    anonymized: DICOM_REDACTION_PERFORMED,
    includedDemographics: demographicsInPrompt,
    // PR-A2B — the two columns PR-A added and this path left NULL. `numImages` on
    // its own cannot answer the question an auditor asks ("did a patient's pixels
    // leave the clinic?"), because a refused send and a delivered one look
    // identical until the endpoint's locality is named. The locality is the send
    // layer's own answer, never a guess from the provider's name.
    endpointLocality: resolveAuditLocality(
      executedIdentity?.provider ?? providerName,
      null,
      executedIdentity?.locality ?? null,
    ),
    imageSourceTypes: queryImageSourceTypes.length > 0 ? queryImageSourceTypes.join(",") : null,
    jobReference: "ai_query",
    correlationId: requestId,
    success: auditOutcome.success,
    errorMessage: auditOutcome.errorMessage,
  }).catch(() => { /* non-critical */ });

  if (!success) {
    // The sentence stays exactly as clients have always received it; `failure` is
    // the additive, stable code the UI can branch on. `/query` previously returned
    // a bare 502 while `/draft` returned a full diagnostics object, so the same
    // provider outage looked different depending on which screen asked.
    res.status(502).json({ error: errorMsg ?? "AI provider error", failure: queryFailure ?? null, requestId }); return;
  }

  const response: AiReportingQueryResponse = {
    aiResponse: aiResponse ?? "",
    provider: executedIdentity?.provider ?? providerName,
    model: executedIdentity?.model ?? (model || null),
    executed: executedIdentity ?? undefined,
    failure: queryFailure ?? null,
    numImages: images.length,
    anonymized: DICOM_REDACTION_PERFORMED,
    promptSource,
    promptChars: finalPrompt.length,
    requestId,
  };
  res.json(response);
});

/**
 * Checks the interactive draft path structurally cannot perform. Reported in
 * the response rather than left implied, because a validator that quietly
 * cannot see part of the report is worse than no validator — the green label
 * becomes a claim nobody tested.
 */
const DRAFT_VALIDATION_GAPS = [
  "selected-image overclaim checks: /draft fetches its own middle-slice JPEGs and has no frozen key-image registry, so the snapshot stays TEXT_ONLY",
  "definite laterality and severity correlation: /draft is sent no structured observations, so those two remain advisory",
  "technique grounding: the reporting workspace does not send Technique to this route",
];

/**
 * Run the background composer's own grounding validator over an interactive
 * draft, so the two AI paths cannot drift apart on what counts as invented.
 *
 * This is a call, not a second validator: `validateComposerOutput` already gates
 * the composer's READY state and is already covered by
 * validateOutput.definiteMutations.test.ts and selectedImages.*.test.ts. Before
 * this ran, /draft returned model prose with no grounding check at all, so an
 * invented "severe canal stenosis" was byte-identical on the wire to one the
 * radiologist's own findings supported.
 *
 * Advisory by design — see `AiDraftValidation.blocking`.
 */
function validateDraftGrounding(input: {
  worklistId?: number | null;
  modality?: string;
  studyDescription?: string;
  reportBody?: string | null;
  impression?: string | null;
  clinicalHistory?: string | null;
  draftFindings: string;
  draftImpression: string;
  imagesSentToModel: number;
  /**
   * The draft's canonical canal AP record, resolved by the caller. The interactive
   * path writes into the same report the canal table prints, so a diameter this
   * draft restates wrongly is not a composer-only hazard. Absent for a study with
   * no record, which is every non-spine examination.
   */
  canalAp?: CanalApComposerRecord | null;
}): AiDraftValidation {
  const snapshot = parseComposerSnapshot({
    worklistId: input.worklistId ?? null,
    modality: input.modality,
    studyType: input.studyDescription,
    clinicalHistory: input.clinicalHistory ?? "",
    technique: "",
    findings: input.reportBody ?? "",
    impression: input.impression ?? "",
    recommendation: "",
    observations: [],
  });
  const result = validateComposerOutput(
    snapshot,
    {
      findings: input.draftFindings,
      impression: input.draftImpression,
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    },
    { canalAp: input.canalAp ?? null },
  );
  return {
    ok: result.ok,
    blocking: false,
    errors: result.errors,
    warnings: result.warnings,
    unsupportedMentions: result.unsupportedMentions,
    lateralitySwaps: result.lateralitySwaps,
    levelChanges: result.levelChanges,
    severityEscalations: result.severityEscalations,
    validator: "reportComposer.validateComposerOutput",
    notChecked: DRAFT_VALIDATION_GAPS,
    imagesSentToModel: input.imagesSentToModel,
  };
}

/**
 * POST /api/ai-reporting/egress-preview
 *
 * Read-only. Shows exactly what one send would put on the wire — the real
 * images, the real prompt, the real destination — without calling any model.
 *
 * This exists because a privacy setting is otherwise unverifiable: a banner
 * either asserts redaction or it does not, and staff have no way to check. The
 * verdict here is computed from the same gates the send path uses, so it can
 * disagree with the settings screen and the operator can see the disagreement.
 */
router.post("/egress-preview", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const body = (req.body ?? {}) as {
    studyInstanceUID?: string;
    promptText?: string;
    maxImages?: number;
  };

  const studyInstanceUID = (body.studyInstanceUID ?? "").trim();
  if (studyInstanceUID && !/^[0-9.]+$/.test(studyInstanceUID)) {
    res.status(400).json({ error: "Invalid studyInstanceUID." }); return;
  }

  const taskRoute = await resolveTaskRoute("radiology_draft");
  const providerName = taskRoute?.provider ?? globalSettings.defaultProvider;
  if (!BUILTIN_PROVIDER_NAMES.includes(providerName)) {
    res.status(400).json({ error: "Invalid provider." }); return;
  }
  const provConfig = await loadProviderConfig(providerName);
  const model = taskRoute?.model ?? provConfig?.defaultModel ?? "";
  // STAGE 1 PR-A — locality is read off the endpoint, not off the name.
  //
  // This used to be `isLocalExecutionProvider(providerName)`, which answers
  // "what is this provider called?". The clinic's own rule (PR #907,
  // `classifyEffectiveLocality`) is that a provider named local and pointed at a
  // public address is a cloud destination. That mattered most here, because this
  // route is the one surface that showed an operator the actual pixels: a
  // `local_openai_compatible` entry aimed at the internet reported LOCAL and then
  // handed patient frames to the browser as base64.
  const isLocal = classifyEffectiveLocality(
    providerName,
    provConfig?.endpointUrl ?? null,
  ).locality === "local";

  // PR-A2: the preview asks the same authority the send asks, instead of reading the
  // overnight flag directly. Two readers of one setting is how a preview comes to
  // promise something the send then refuses.
  const securityPolicy = await resolveAiSecurityPolicy();
  const cloudVisionAllowed = securityPolicy.cloudVisionAllowed;

  // Same cap the real drafting path uses, so the preview cannot be used to
  // pull more of a study than an AI call would.
  const maxImages = Math.max(0, Math.min(Math.floor(body.maxImages ?? 6) || 0, 6));
  let images: string[] = [];
  let imageByteSizes: number[] = [];
  let seriesSelected = 0;
  if (studyInstanceUID && maxImages > 0) {
    const fetched = await fetchStudyImages({
      studyInstanceUID,
      maxImages,
      maxWidthPx: 512,
    });
    images = fetched.images;
    imageByteSizes = fetched.imageByteSizes;
    seriesSelected = fetched.seriesSelected;
  }

  const promptText = (body.promptText ?? "").trim();
  const categories: PhiCategory[] = promptText ? detectPhiCategories(promptText) : [];
  const scrubbed = promptText ? scrubPhiText(promptText) : null;

  const textWouldBeRedacted = !isLocal && categories.length > 0 && globalSettings.cloudTextPhiAllowed === true;
  const blocks: Array<{ code: string; reason: string }> = [];
  if (!isLocal && images.length > 0 && !cloudVisionAllowed) {
    blocks.push({
      code: "PHI_IMAGE_CLOUD_BLOCKED",
      reason: `${images.length} clinical image(s) would go to ${providerName}. Cloud vision is not enabled by an administrator.`,
    });
  }
  if (!isLocal && images.length > 0 && securityPolicy.requireAttestation) {
    blocks.push({
      code: "PHI_IMAGE_CLOUD_UNATTESTED",
      reason:
        `${images.length} clinical image(s) would go to ${providerName}, and a patient-derived image needs a clinician to attest that specific request in Clinical mode. `
        + "This preview is not an attestation, so nothing would be sent.",
    });
  }
  if (!isLocal && categories.length > 0 && globalSettings.cloudTextPhiAllowed !== true) {
    blocks.push({
      code: "PHI_TEXT_CLOUD_BLOCKED",
      reason: `The prompt names a patient (${categories.join(", ")}). Nothing would be sent.`,
    });
  }

  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    destination: {
      provider: providerName,
      model: model || null,
      execution: isLocal ? "LOCAL" : "CLOUD",
      routedBy: taskRoute ? `task-route:radiology_draft` : "settings-default",
      providerConfigured: Boolean(provConfig?.isEnabled),
    },
    // PR-A2: which rules this destination is being judged by, read off the server's
    // own policy resolution. A preview that reports the destination without the mode
    // would leave the admin guessing why something was blocked.
    security: {
      mode: securityPolicy.mode,
      cloudVisionAllowed: securityPolicy.cloudVisionAllowed,
      requireAttestation: securityPolicy.requireAttestation,
      strictAudit: securityPolicy.strictAudit,
    },
    images: {
      requested: maxImages,
      seriesSelected,
      count: images.length,
      totalBytes: images.reduce((a, b) => a + b.length, 0),
      perImageBytes: imageByteSizes,
      // STAGE 1 PR-A — the pixels are gone from this response.
      //
      // `frames` used to carry every image as `data:image/jpeg;base64,…`, so this
      // diagnostic route was itself a way to pull a patient's study out of the API
      // — held in a browser tab, a proxy log, and any extension that can read the
      // page. The question the preview exists to answer is how much would leave
      // and to where, and a SHA-256 per frame answers that exactly: two runs match
      // on digest, and nothing renderable is stored or transported.
      frameDigests: images.map((b64) => createHash("sha256").update(b64, "base64").digest("hex")),
      pixelsReturned: false,
    },
    prompt: {
      chars: promptText.length,
      identifierCategories: categories,
      scrubbed: scrubbed?.text ?? "",
      fieldsRedacted: scrubbed?.removedCount ?? 0,
      wouldBeRedacted: textWouldBeRedacted,
    },
    gates: {
      cloudVisionAllowed,
      cloudTextPhiAllowed: globalSettings.cloudTextPhiAllowed === true,
    },
    verdict: blocks.length > 0
      ? { allowed: false, code: blocks[0].code, reason: blocks.map((b) => b.reason).join(" "), blocks }
      : {
          allowed: true,
          code: null,
          reason: isLocal
            ? "On-prem provider — the data does not leave the clinic."
            : "Allowed under the current settings.",
          blocks: [],
        },
  });
});

/**
 * POST /api/ai-reporting/draft
 * Interactive copilot draft generation — reuses existing provider infrastructure
 * with per-task routing and fallback. Accepts the radiologist's current report
 * body + impression as context and returns AI-generated draft sections, each
 * carrying a grounding verdict from the composer's own validator.
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
  const parsedBody = AiReportingDraftRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    const first = parsedBody.error.issues[0];
    res.status(400).json({
      error: `Invalid AI draft request: ${first ? `${first.path.join(".") || "body"} — ${first.message}` : "malformed body"}`,
    });
    return;
  }
  const {
    worklistId,
    studyInstanceUID: studyInstanceUIDBody,
    modality: modalityBody,
    studyDescription: studyDescriptionBody,
    reportBody: reportBodyReq,
    findings: findingsReq,
    impression,
    clinicalHistory,
    provider: providerReq,
    field: fieldReq,
    warmUpOnly,
    attestCloudImageEgress,
  } = parsedBody.data;

  // `field` names the one section the caller will consume. Ctrl+I in the
  // reporting workspace has always posted "impression" and read only
  // `res.impression`, but the handler never destructured the key — so every
  // Ctrl+I also asked the model for a full set of Findings nobody requested,
  // invented them from the same prompt, and returned them under `findings` and
  // `draft` for any surface to offer as a replacement of text the radiologist
  // had already typed.
  const wantsImpressionOnly = fieldReq === "impression";

  // `reportBody` is canonical; `findings` is what the workstation has always
  // sent. Reading only the former meant Ctrl+I asked for an impression without
  // ever giving the model the findings it was supposed to summarise.
  const reportBody = reportBodyReq?.trim() ? reportBodyReq : findingsReq;

  // TASK E-1 — the study this body names is confirmed against this clinic's own
  // rows before a single pixel is asked for, and what the server's row says is what
  // the prompt, the draft row and the audit row all use.
  //
  // The two lookups this replaces read those same tables and then threw the answer
  // away when no row matched: a body naming a UID no worklist row carries still
  // reached `fetchStudyImages` with the CALLER's string, and a `worklistId` whose row
  // has no UID fell through `?? studyInstanceUID` to the caller's claim again. So the
  // frames put in front of the model could come from a study the RIS cannot name, and
  // the draft and audit rows filed under that UID had no accession and no patient to
  // check them against. `/image-review` refuses that shape, and so does
  // `/api/ai-comparison/run` for the row it files — this is the same rule at the door
  // that was missing it, not a new policy.
  //
  // A request that names no study still runs: that is Ctrl+I over findings the
  // radiologist typed, and it fetches no images.
  const binding = await bindInteractiveStudy({
    worklistId,
    studyInstanceUID: studyInstanceUIDBody,
  });
  if (!binding.ok) {
    res.status(binding.httpStatus).json({ error: binding.message, code: binding.code });
    return;
  }
  const studyInstanceUID: string | undefined = binding.studyInstanceUID ?? undefined;
  const accessionNumber: string | undefined = binding.accessionNumber ?? undefined;
  const patientId: number | undefined = binding.patientId ?? undefined;
  // The caller's own modality/description still win, exactly as before: they are
  // labels for the prompt, not identity, and a worklist row with a NULL description
  // must not silently replace what the screen shows.
  const modality = modalityBody?.trim() || binding.modality || undefined;
  const studyDescription =
    studyDescriptionBody?.trim() || binding.studyDescription || undefined;

  // C1 — ONE resolution for the whole request.
  //
  // `/draft` used to resolve a provider here, check that provider's enablement,
  // and then call `generateAiForTask(taskKey, prompt, images, { model })` without
  // the provider — which made the gateway resolve it again from the task route or
  // the global default. The enablement checked below therefore belonged to a
  // provider that might never run, while the draft row, the audit row and the
  // response all reported the checked one anyway. Reproduced in
  // `lib/ai-providers/src/interactiveExecutionContract.test.ts`.
  //
  // Now: the provider resolved and validated here is the provider handed to
  // execution, and what execution reports back is what gets recorded.
  const target: InteractiveTarget = await resolveInteractiveTarget({
    taskKey: "radiology_draft",
    requestedProvider: providerReq,
    defaultProvider: globalSettings.defaultProvider,
  });
  if (!target.ok) {
    res.status(target.httpStatus).json({ error: target.error });
    return;
  }
  const providerName = target.provider;
  const model = target.model ?? "";

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
  // C1 — the section markers this prompt demands and the parser that enforces
  // them are now one contract (`lib/ai/draftOutputContract.ts`), so the handler
  // cannot ask for a format the reader has quietly stopped honouring. The
  // instruction text itself is unchanged.
  finalPrompt += draftInstructionBlock(wantsImpressionOnly ? "impression" : "full");

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

  // PR-A2B — ONE provenance value per request. The same list is what the gate judges
  // and what the audit row claims; computed twice, a row could describe patient
  // frames to an auditor while the decision was made on unattributed ones.
  const draftImageSourceTypes = serverResolvedProvenance(images.length);

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
  // C1 — the options object used to travel WITHOUT a provider, which is exactly
  // what let the gateway pick a different one. The resolved target's provider is
  // now handed to execution, and the identity execution reports is the identity
  // everything below records. A response that cannot be attributed to the
  // provider this request was validated against is not a draft: it is refused.
  //
  // PR-A2B adds the egress terms to the same hand-off. The gateway resolves the
  // clinic's mode; this route only supplies facts about the pixels (Orthanc
  // rendered them from the study named on the server's own worklist row) and, when
  // the radiologist confirmed a cloud send, whose session made that claim.
  const call = await executeInteractiveAiCall({
    target,
    prompt: finalPrompt,
    images,
    imageSourceTypes: draftImageSourceTypes,
    attestedBy: attestationSubject(user, attestCloudImageEgress),
    options: {
      numCtx: draftCtx.requestedNumCtx,
      think: false,
      endpointUrl: runtime.ollamaBaseUrl,
    },
  });
  const aiResult = call.result;
  const identityMismatch = !call.identityVerified;
  const success = aiResult.success && !identityMismatch;
  const aiResponse = identityMismatch ? "" : aiResult.text;
  const errorMsg = call.failure?.message ?? aiResult.error;

  // Parse findings + impression from the AI response. C1: this FAILS CLOSED.
  //
  // The impression branch used to be `match(/IMPRESSION:/)?.[1] ?? aiResponse`,
  // so a model that answered in prose without the marker it was told to emit had
  // its ENTIRE response returned as the Impression — with `parserSuccess: true`.
  // That text then reached the radiologist's Impression ghost layer, one Tab from
  // becoming report content, carrying no evidence that it had ever been identified
  // as an impression. The rule is now: the requested section, or nothing.
  let draftFindings = "";
  let draftImpression = "";
  let parser = null as ReturnType<typeof buildParserMeta> | null;
  let parseFailure: AiFailure | null = null;
  if (success && aiResponse) {
    const parsed = parseDraftOutput({
      aiResponse,
      field: wantsImpressionOnly ? "impression" : "full",
    });
    draftFindings = parsed.findings;
    draftImpression = parsed.impression;
    if (!parsed.ok) {
      // Normalized through the same helper as every provider failure, so a
      // refused parse carries the executed provider/model/deadline like any other
      // `failure` — a client must never see two shapes for one field.
      parseFailure = normalizeAiFailure(aiResult, {
        code: "MALFORMED_RESPONSE",
        message: draftParseFailureMessage(parsed.reason),
      });
    }
    // Drop cross-modality garbage (chest radiograph on CT Brain, etc.) — and say
    // that is what happened, rather than returning a silently empty impression.
    if (
      !parseFailure
      && draftImpression
      && !impressionMatchesStudyContext(draftImpression, { modality, studyDescription })
    ) {
      draftImpression = "";
      parseFailure = normalizeAiFailure(aiResult, {
        code: "EMPTY_RESPONSE",
        message:
          "The draft was discarded because it described a different modality or body region than this study.",
      });
    }
    parser = buildParserMeta(aiResponse, draftFindings, draftImpression);
  }

  /**
   * The one failure object this request answers with. `call.failure` covers what
   * the execution layer saw (policy, configuration, deadline, HTTP, an
   * unattributable provider); `parseFailure` covers the only thing it could not
   * see — the answer arrived and cannot be read as the section requested.
   */
  const draftFailure = call.failure ?? parseFailure;

  // Grounding verdict from the composer's own validator. Advisory — nothing here
  // withholds the draft; it labels it, so ungrounded model prose cannot arrive
  // looking identical to prose the radiologist's own findings support.
  //
  // The canal AP record comes from this study's own draft row, through the same
  // one-draft resolution rule every other reader uses. The interactive draft lands
  // in the same report the canal table prints, so a diameter this answer changed or
  // invented is the identical hazard the composer job is checked for — and a study
  // with no record (every non-spine examination) is checked exactly as before.
  const { loadCanonicalCanalApForWorklist } = await import(
    "../lib/reportComposer/resolveComposeDraft"
  );
  const canalAp = await loadCanonicalCanalApForWorklist(worklistId ?? null);
  const validation = validateDraftGrounding({
    worklistId: worklistId ?? null,
    modality,
    studyDescription,
    reportBody,
    impression,
    clinicalHistory,
    draftFindings,
    draftImpression,
    imagesSentToModel: images.length,
    canalAp,
  });

  const diag = buildAiReportingDraftDiagnostics({
    requestId,
    worklistId: worklistId ?? null,
    // C1 — the identity that executed. The builder already prefers the provider
    // layer's own figures; passing the confirmed identity as well means the
    // fallback can no longer describe a provider that never ran.
    providerName: call.executedProvider ?? providerName,
    model: call.executedModel ?? (model || null),
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

  // Save draft to DB. Skipped for a declared provider warm-up: the model still
  // gets loaded and exercised, and the audit row below still records that an AI
  // call happened, but a study nobody asked about does not acquire a stored
  // draft that GET /drafts/:studyInstanceUID will later hand to whoever opens
  // it. That draft would have been written from a prompt carrying no findings
  // at all — pure image-plus-template invention with no radiologist input.
  let draftId: number | null = null;
  // A refused answer is not a stored draft: `GET /drafts/:studyInstanceUID` hands
  // these rows to whoever opens the study next, so nothing unusable may land here.
  if (success && !draftFailure && !warmUpOnly) {
    const inserted = await db.insert(aiReportingDraftsTable)
      .values({
        studyInstanceUID: studyInstanceUID ?? null,
        accessionNumber: accessionNumber ?? null,
        patientId: patientId ?? null,
        userId: user.subjectId,
        userName: user.subjectName,
        provider: call.executedProvider ?? providerName,
        model: call.executedModel ?? (model || null),
        promptText: finalPrompt.substring(0, 2000),
        templateName: null,
        aiResponse: aiResponse.substring(0, 4000),
        draftText: draftFindings.substring(0, 4000),
        status: "draft",
      })
      .returning({ id: aiReportingDraftsTable.id });
    draftId = inserted[0]?.id ?? null;
  }

  // Audit log (non-critical). C1: the provider and model written here are the ones
  // the EXECUTION layer reported, so an audit row can no longer describe a request
  // as handled by a provider that never received it. `success` means "the
  // radiologist was given usable text", which is what an auditor asks.
  await db.insert(aiReportingAuditLogsTable).values({
    userId: user.subjectId,
    userName: user.subjectName,
    patientId: patientId ?? null,
    studyInstanceUID: studyInstanceUID ?? null,
    accessionNumber: accessionNumber ?? null,
    provider: call.executedProvider ?? providerName,
    model: call.executedModel ?? (model || null),
    promptText: finalPrompt.substring(0, 2000),
    numImages: images.length,
    anonymized: DICOM_REDACTION_PERFORMED,
    includedDemographics: false,
    wasInsertedToReport: false,
    draftId,
    // PR-A2B — the columns PR-A gave the audit table, filled from the send layer's
    // own answer rather than from the provider this route hoped for. A row that says
    // "3 images, provider deepseek" without a locality cannot distinguish the
    // refusal from the egress, which is the one question this table exists to answer.
    endpointLocality: resolveAuditLocality(providerName, null, call.locality),
    imageSourceTypes: draftImageSourceTypes.length > 0 ? draftImageSourceTypes.join(",") : null,
    correlationId: requestId,
    success: success && !draftFailure,
    errorMessage: draftFailure?.message ?? errorMsg ?? null,
  }).catch(() => { /* non-critical */ });

  if (!success) {
    // Include PHI-safe diagnostic summary so operators see the real 502 cause
    // without grepping only the pino HTTP line.
    res.status(502).json({
      error: errorMsg ?? "AI provider error",
      requestId,
      // C1 — one small stable code alongside the sentence the UI has always been
      // given. `error` is deliberately untouched: surfaces match on its wording,
      // and an infrastructure PR does not get to rename a clinician-visible
      // message as a side effect.
      failure: draftFailure ?? null,
      executed: aiResult.execution ?? null,
      resolution: {
        provider: target.provider,
        providerSource: target.providerSource,
        modelSource: target.modelSource,
      },
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
    // Both are empty when the caller asked for an impression only, so no surface
    // can offer model-invented findings as a replacement for text the
    // radiologist already typed. A refused parse (see `failure`) leaves them empty
    // too — the whole response is never substituted for a requested section.
    findings: draftFindings,
    draft: draftFindings,
    impression: draftImpression,
    // C1 — the provider and model that ACTUALLY produced this text, as reported by
    // the execution layer, matching the audit row written above.
    provider: call.executedProvider ?? providerName,
    model: call.executedModel ?? (model || null),
    executed: aiResult.execution ?? null,
    resolution: {
      provider: target.provider,
      providerSource: target.providerSource,
      modelSource: target.modelSource,
    },
    failure: draftFailure ?? null,
    draftId,
    requestId,
    validation,
    aiSafetyLabel: validation.ok
      ? "AI Draft – Requires Radiologist Review"
      : "AI Draft – Ungrounded content flagged – verify before accepting",
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
  const requestId = newAiRequestId();
  const { text } = req.body as { text?: string };
  if (!text?.trim()) {
    res.status(400).json({ error: "No text provided." }); return;
  }

  // C1 — this handler used to label its audit row with `getDefaultProviderName()`
  // while `generateAiForTask("report_enhancement", …, {})` resolved the provider
  // for real, from the task route. Two answers to one question, and the audit row
  // held the wrong one. One resolution now, and the label is whatever executed.
  //
  // Note what is deliberately NOT passed: `globalSettings.defaultProvider`. `/draft`
  // has always validated that row, so on that path the checked provider is the
  // provider that runs. `/polish` never validated it, so inheriting it here would
  // silently move an editorial call onto a different provider than the one it used
  // to reach — an infrastructure PR does not get to change which model a screen
  // talks to as a side effect. Precedence stays task route → global default.
  const polishTarget = await resolveInteractiveTarget({
    taskKey: "report_enhancement",
  });
  if (!polishTarget.ok) {
    res.status(polishTarget.httpStatus).json({ error: polishTarget.error });
    return;
  }

  const prompt =
    "You are a medical language editor. Refine the following radiology report text for grammar, clarity, and professional formatting. " +
    "Do NOT change any medical facts, measurements, or findings. Only improve language.\n\n" +
    text.trim() +
    "\n\nReturn ONLY the polished text with no additional commentary.";

  const polishCall = await executeInteractiveAiCall({ target: polishTarget, prompt, images: [] });
  const aiResult = polishCall.result;
  const success = aiResult.success && polishCall.identityVerified;
  const polished = success ? aiResult.text : "";
  // The gateway already decided. `InteractiveCallOutcome.failure` is documented as
  // "Null means this call may be recorded and returned as a success", and
  // `normalizeAiFailure` answers EMPTY_RESPONSE for a provider that returned 200
  // with nothing in it — yet this row was filed from transport plus identity alone,
  // with `failure` used only for the message once `!success` was already true.
  const auditOutcome = resolveAiAuditOutcome({
    providerReportedSuccess: aiResult.success,
    identityVerified: polishCall.identityVerified,
    failure: polishCall.failure,
    answerText: aiResult.text,
    providerError: aiResult.error,
  });

  // Audit log
  await db.insert(aiReportingAuditLogsTable).values({
    userId: user.subjectId,
    userName: user.subjectName,
    provider: polishCall.executedProvider ?? polishTarget.provider,
    model: polishCall.executedModel,
    promptText: prompt.substring(0, 2000),
    numImages: 0,
    anonymized: DICOM_REDACTION_PERFORMED,
    endpointLocality: resolveAuditLocality(
      polishCall.executedProvider ?? polishTarget.provider,
      null,
      polishCall.locality,
    ),
    jobReference: "ai_polish",
    correlationId: requestId,
    success: auditOutcome.success,
    errorMessage: auditOutcome.errorMessage,
  }).catch(() => { /* non-critical */ });

  if (!success) {
    res.status(502).json({
      error: aiResult.error ?? "AI provider error",
      failure: polishCall.failure ?? null,
      requestId,
    });
    return;
  }

  res.json({
    polished: polished.trim(),
    aiSafetyLabel: "AI Draft – Requires Radiologist Review",
    provider: polishCall.executedProvider ?? polishTarget.provider,
    model: polishCall.executedModel,
    executed: aiResult.execution ?? null,
    // The clinician is handed the text; the screen still needs to be able to say
    // "and that text was empty" without the audit table being the only place that
    // knows. `/draft` returns `failure` on its 200 for exactly this reason.
    failure: polishCall.failure ?? null,
    requestId,
  });
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
  const requestId = newAiRequestId();
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

  // C1 — one resolution with the same precedence this handler always used (task
  // route, then the AI Reporting default), and the resolved provider is now the
  // provider handed to execution. `provConfig` is no longer reachable here, which
  // is the point: nothing downstream can re-resolve and disagree.
  const reviewTarget = await resolveInteractiveTarget({
    taskKey: "radiology_draft",
    defaultProvider: globalSettings.defaultProvider,
  });
  if (!reviewTarget.ok) {
    res.status(reviewTarget.httpStatus).json({ error: reviewTarget.error });
    return;
  }
  const providerName = reviewTarget.provider;
  const model = reviewTarget.model ?? "";

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

  // Call AI with images. C1: through the same single-owner execution boundary as
  // `/draft`, so the provider whose images these are allowed to reach is the
  // provider the audit row names.
  //
  // PR-A2B: the study UID for this route is resolved off the worklist row
  // (`resolveAuthorizedStudyUid`), so the frames are server-provenanced DICOM. No
  // attestation is supplied: this handler has no confirmation step, which means
  // Clinical mode keeps refusing its cloud sends while Development mode — where the
  // administrator's opt-in is the decision — gets through.
  const reviewImageSourceTypes = serverResolvedProvenance(images.length);
  const reviewCall = await executeInteractiveAiCall({
    target: reviewTarget,
    prompt,
    images,
    imageSourceTypes: reviewImageSourceTypes,
  });
  const aiResult = reviewCall.result;
  const success = aiResult.success && reviewCall.identityVerified;
  const aiResponse = success ? aiResult.text : "";
  // A vision review that came back blank is the most expensive version of the same
  // defect: pixels left the clinic, inference ran, and the row said "success".
  const auditOutcome = resolveAiAuditOutcome({
    providerReportedSuccess: aiResult.success,
    identityVerified: reviewCall.identityVerified,
    failure: reviewCall.failure,
    answerText: aiResult.text,
    providerError: aiResult.error,
  });

  // Audit log
  await db.insert(aiReportingAuditLogsTable).values({
    userId: user.subjectId,
    userName: user.subjectName,
    studyInstanceUID: studyInstanceUID ?? null,
    provider: reviewCall.executedProvider ?? providerName,
    model: reviewCall.executedModel ?? (model || null),
    promptText: prompt.substring(0, 2000),
    numImages: images.length,
    anonymized: DICOM_REDACTION_PERFORMED,
    // PR-A2B — same two facts the drafting path now records: whose locality the
    // bytes were addressed to, and what kind of pixels they were.
    endpointLocality: resolveAuditLocality(providerName, null, reviewCall.locality),
    imageSourceTypes: reviewImageSourceTypes.length > 0 ? reviewImageSourceTypes.join(",") : null,
    jobReference: "ai_image_review",
    correlationId: requestId,
    success: auditOutcome.success,
    errorMessage: auditOutcome.errorMessage,
  }).catch(() => { /* non-critical */ });

  if (!success) {
    // `IMAGE_EGRESS_BLOCK` in here is the answer to "why did the vision review
    // fail on a cloud provider?" — which previously surfaced only as a sentence.
    res.status(502).json({
      error: aiResult.error ?? "AI provider error",
      failure: reviewCall.failure ?? null,
      requestId,
    });
    return;
  }

  res.json({
    aiResponse: aiResponse.trim(),
    provider: reviewCall.executedProvider ?? providerName,
    model: reviewCall.executedModel ?? (model || null),
    executed: aiResult.execution ?? null,
    numImages: images.length,
    aiSafetyLabel: "AI Draft – Requires Radiologist Review",
    failure: reviewCall.failure ?? null,
    requestId,
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
  const requestId = newAiRequestId();
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

  // C1's `/polish` fix, applied here: this handler used to label its audit row with
  // `getDefaultProviderName()` while `generateAiForTask("report_enhancement", …)`
  // resolved the provider that actually ran. Two answers to one question, and the
  // record held the one nobody asked. One resolution now, and the row names what
  // executed.
  const compareTarget = await resolveInteractiveTarget({ taskKey: "report_enhancement" });
  if (!compareTarget.ok) {
    res.status(compareTarget.httpStatus).json({ error: compareTarget.error });
    return;
  }
  const providerName = compareTarget.provider;
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

  const compareCall = await executeInteractiveAiCall({ target: compareTarget, prompt, images: [] });
  const aiResult = compareCall.result;
  const success = aiResult.success && compareCall.identityVerified;
  const auditOutcome = resolveAiAuditOutcome({
    providerReportedSuccess: aiResult.success,
    identityVerified: compareCall.identityVerified,
    failure: compareCall.failure,
    answerText: aiResult.text,
    providerError: aiResult.error,
  });

  // Audit log
  await db.insert(aiReportingAuditLogsTable).values({
    userId: user.subjectId,
    userName: user.subjectName,
    provider: compareCall.executedProvider ?? providerName,
    model: compareCall.executedModel ?? null,
    promptText: prompt.substring(0, 2000),
    numImages: 0,
    anonymized: DICOM_REDACTION_PERFORMED,
    endpointLocality: resolveAuditLocality(
      compareCall.executedProvider ?? providerName,
      null,
      compareCall.locality,
    ),
    jobReference: "ai_compare",
    correlationId: requestId,
    success: auditOutcome.success,
    errorMessage: auditOutcome.errorMessage,
  }).catch(() => { /* non-critical */ });

  if (!success) {
    res.status(502).json({
      error: aiResult.error ?? "AI provider error",
      failure: compareCall.failure ?? null,
      requestId,
    });
    return;
  }

  res.json({
    comparison: aiResult.text.trim(),
    aiSafetyLabel: "AI Draft – Requires Radiologist Review",
    provider: compareCall.executedProvider ?? providerName,
    model: compareCall.executedModel ?? null,
    failure: compareCall.failure ?? null,
    requestId,
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
    studyInstanceUID: claimedStudyUid,
    patientId: claimedPatientId,
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
    // Updating a saved draft is not a lesser write than creating one. This row is what
    // `GET /drafts/:studyInstanceUID` shows the next clinician and what
    // `/insert-to-report` copies into a report, yet the door took an id from the body and
    // rewrote whatever row carried it — without looking at whose draft it was, which
    // study it belonged to, or whether it existed at all (a phantom id was answered with
    // `{ id }`, so the drawer said "Draft saved" and kept pointing at nothing).
    //
    // The reporting screen makes this reachable by clicking, not by crafting a request:
    // its Saved Drafts list shows every clinician's drafts for the study, and Load arms
    // whichever id was clicked for the next Save. So the same three facts the create path
    // derives — study, accession, patient — are checked against the row being overwritten.
    // The study the caller is standing in is derived the same way the create path
    // derives it: a claim this clinic cannot confirm is refused here too, because the row
    // about to be rewritten is filed against a study and read back by whoever opens it.
    //
    // The body's patient claim is NOT checked on this branch, deliberately. The update
    // writes `draftText`, `aiResponse` and `status` and no identity column at all, so
    // there is nothing here for a conflicting patient id to become — refusing would be
    // theatre over a value the door ignores, and the same argument (#1111's accession
    // rule) says an untrusted claim that is not stored is dropped, not punished.
    const binding = await bindInteractiveStudy({ studyInstanceUID: claimedStudyUid });
    if (!binding.ok) {
      res.status(binding.httpStatus).json({ error: binding.message, code: binding.code });
      return;
    }

    const [row] = await db
      .select({
        id: aiReportingDraftsTable.id,
        userId: aiReportingDraftsTable.userId,
        userName: aiReportingDraftsTable.userName,
        studyInstanceUID: aiReportingDraftsTable.studyInstanceUID,
      })
      .from(aiReportingDraftsTable)
      .where(eq(aiReportingDraftsTable.id, existingId))
      .limit(1);

    if (!row) {
      res.status(404).json({
        error: `No saved draft with id ${existingId} exists — it was deleted, or it was never saved. Nothing was written. Save again and this text is kept as a new draft of your own.`,
        code: "DRAFT_NOT_FOUND",
      });
      return;
    }

    if (row.studyInstanceUID !== binding.studyInstanceUID) {
      res.status(409).json({
        error:
          `This draft belongs to study ${row.studyInstanceUID ?? "(no study on the record)"}, `
          + `but the screen is on ${binding.studyInstanceUID ?? "(no study named)"}. `
          + "Nothing was changed — the text on this examination belongs in a draft of this examination, "
          + "so save again and it is kept as one.",
        code: "DRAFT_STUDY_MISMATCH",
      });
      return;
    }

    if (row.userId !== user.subjectId) {
      res.status(403).json({
        error:
          `This draft was saved by ${row.userName ?? "a clinician whose name is not on the record"}, `
          + `and it cannot be changed from your account. Nothing was overwritten — save again and your `
          + "text is kept as a new draft of your own, alongside theirs.",
        code: "DRAFT_NOT_YOURS",
      });
      return;
    }

    await db.update(aiReportingDraftsTable)
      .set({ draftText, aiResponse, status, updatedAt: new Date() })
      .where(eq(aiReportingDraftsTable.id, existingId));
    res.json({ id: existingId }); return;
  }

  // A stored draft is not a scratch note: `GET /drafts/:studyInstanceUID` hands it to
  // whoever opens that study next, and `/insert-to-report` copies its text into the
  // report. So the row may only be filed against a study this clinic has, under that
  // study's own accession and its own patient — the same rule `/draft` and `/query`
  // bind by, and the same three columns this route used to take from the body. The
  // body's `accessionNumber` is not read either: only this server's row can say what a
  // study's accession is.
  const binding = await bindInteractiveStudy({ studyInstanceUID: claimedStudyUid });
  if (!binding.ok) {
    res.status(binding.httpStatus).json({ error: binding.message, code: binding.code });
    return;
  }
  const identity = refuseConflictingPatientClaim(binding, claimedPatientId);
  if (!identity.ok) {
    res.status(identity.httpStatus).json({ error: identity.message, code: identity.code });
    return;
  }

  const inserted = await db.insert(aiReportingDraftsTable)
    .values({
      studyInstanceUID: identity.studyInstanceUID,
      accessionNumber: identity.accessionNumber,
      patientId: identity.patientId,
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
 *
 * WHAT THIS DOOR ACTUALLY DOES. The report body belongs to the reporting workspace,
 * and CARE already has exactly one authoritative way for AI wording to reach it: the
 * staged-proposal queue (`stageAiProposal` → the "N proposals staged / Apply" bar →
 * `applyStagedAiProposals` → `applyAiComposerAccepted` → the same awaited `saveDraft`
 * the Save button and Finalize use). This door puts a saved draft into that queue for
 * its own study and writes nothing else. It deliberately does not touch findings or
 * impression: a second writer of the report body, on a page that never showed the
 * radiologist the report they are editing, is how typed text gets replaced by a
 * model's sentence — and the study's own draft row is the only place the current
 * text exists while the workspace holds it unsaved.
 *
 * So `status='inserted'` now means "queued for the report, not yet in it", which is
 * what the reader in the workspace looks for, and the response names the examination
 * the clinician is being sent to.
 */
router.post("/insert-to-report", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const globalSettings = await getGlobalSettings();
  if (!canUse(sReq, globalSettings.allowedRoles)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const user = sReq.staffSession!;
  const { draftId } = req.body as { draftId: number };

  // The drawer's "inserted" stamp is a claim about a record, so it has to name one that
  // exists. This door used to answer `{ success: true }` for any id — including one that
  // had never been saved — and the clinician was told the draft was marked.
  const [row] = await db
    .select({
      id: aiReportingDraftsTable.id,
      studyInstanceUID: aiReportingDraftsTable.studyInstanceUID,
      draftText: aiReportingDraftsTable.draftText,
      aiResponse: aiReportingDraftsTable.aiResponse,
    })
    .from(aiReportingDraftsTable)
    .where(eq(aiReportingDraftsTable.id, draftId))
    .limit(1);
  if (!row) {
    res.status(404).json({
      error: `No saved draft with id ${draftId} exists, so nothing was marked as inserted into a report.`,
      code: "DRAFT_NOT_FOUND",
    });
    return;
  }

  // Queuing text into a report is a claim about an examination, so the examination is
  // read from this clinic's own row exactly as the save door reads it — never from the
  // caller. A draft saved against a StudyInstanceUID nobody has cannot be queued.
  const binding = await bindInteractiveStudy({ studyInstanceUID: row.studyInstanceUID });
  if (!binding.ok) {
    res.status(binding.httpStatus).json({ error: binding.message, code: binding.code });
    return;
  }
  if (!binding.studyInstanceUID) {
    res.status(409).json({
      error: "This draft was saved without an examination, so there is no report to add it to. Open the study, generate or save the draft again, and send it from there.",
      code: "NO_STUDY_UID",
    });
    return;
  }
  if (!((row.draftText ?? row.aiResponse ?? "").trim())) {
    res.status(409).json({
      error: "This saved draft has no text in it, so there is nothing to add to the report.",
      code: "DRAFT_EMPTY",
    });
    return;
  }

  const [worklist] = await db
    .select({
      id: radiologyWorklistTable.id,
      accessionNumber: radiologyWorklistTable.accessionNumber,
    })
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.studyInstanceUID, binding.studyInstanceUID))
    .limit(1);
  if (!worklist) {
    res.status(409).json({
      error: `Study ${binding.studyInstanceUID} is not on a reporting worklist yet, so there is no report to add this draft to.`,
      code: "WORKLIST_NOT_FOUND",
    });
    return;
  }

  // A signed report is not written by an AI queue. This is the workspace's own rule
  // (`assertDraftWritable`, the guard every ordinary save passes through), applied here
  // so the refusal arrives before the clinician is sent to a screen that cannot take it.
  try {
    await assertDraftWritable({ worklistId: worklist.id });
  } catch (err) {
    if (err instanceof RadiologyIdentityError) {
      res.status(err.httpStatus).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }

  await db.update(aiReportingDraftsTable)
    .set({ status: "inserted", insertedAt: new Date(), insertedBy: user.subjectName })
    .where(eq(aiReportingDraftsTable.id, draftId));

  await db.update(aiReportingAuditLogsTable)
    .set({ wasInsertedToReport: true })
    .where(eq(aiReportingAuditLogsTable.draftId, draftId));

  res.json({
    success: true,
    queued: true,
    worklistId: worklist.id,
    studyInstanceUID: binding.studyInstanceUID,
    accessionNumber: worklist.accessionNumber ?? null,
  });
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
 * Whole-subsystem gate: the critical-result COMMUNICATION workflow is optional.
 *
 * This centre does not currently follow a formal critical-result communication
 * protocol, so the workflow ships switched off. `ff_radiology_critical_result_comms`
 * (default OFF, togglable from Settings → Feature Flags) governs the pre-sign
 * acknowledgement block, the interrupt card, the 15-minute SLA timer, the
 * copilot reminders, the Mark Critical Finding panel and the Critical Findings
 * page — and these three endpoints, which are that workflow's only API surface.
 * A gated-off feature must be indistinguishable from a feature that does not
 * exist, so a direct API call gets 404 (the same shape the UI routes use), not
 * a 403/501 that advertises a disabled subsystem.
 *
 * Deliberately NOT gated here: the finding detector (lib/criticalResults.ts),
 * the radiology_critical_findings table and its existing rows, the PACS
 * critical alerts widget, and /api/radiology/critical-findings — those are
 * independent of the communication workflow and stay live either way. No row is
 * ever created, altered or deleted by the toggle.
 *
 * A `router.use` gate would be wrong: this file registers unrelated routes
 * below, and Express would silently apply the flag to all of them. Hence an
 * explicit call at the top of each of the three handlers.
 *
 * The flag key is written as a literal at each call site (not hoisted into a
 * constant) on purpose: radiologyOpsHealth.test.ts's source pin greps the
 * backend for `isFeatureEnabledServer("ff_radiology_*")` literals to prove the
 * registry's `wired: true` is truthful, and a constant would hide this gate
 * from both that check and a plain grep for the key.
 */

/**
 * GET /api/ai-reporting/critical-findings
 * List critical findings.
 */
router.get("/critical-findings", async (req, res): Promise<void> => {
  if (!(await isFeatureEnabledServer("ff_radiology_critical_result_comms"))) { res.status(404).json({ error: "not_found" }); return; }

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
  if (!(await isFeatureEnabledServer("ff_radiology_critical_result_comms"))) { res.status(404).json({ error: "not_found" }); return; }

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
  if (!(await isFeatureEnabledServer("ff_radiology_critical_result_comms"))) { res.status(404).json({ error: "not_found" }); return; }

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
