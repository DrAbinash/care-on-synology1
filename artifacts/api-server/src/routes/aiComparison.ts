/**
 * AI Comparison Workspace (Phase 7A)
 * Run the same prompt against multiple providers simultaneously.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { aiProviderSettingsTable, aiReportingAuditLogsTable, radiologyStudiesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import { generateAiResponse, BUILTIN_PROVIDER_NAMES, BUILTIN_PROVIDER_CONFIGS } from "@workspace/ai-providers";
import { DICOM_REDACTION_PERFORMED } from "../lib/ai/dicomRedaction";
import { resolveInteractiveImageEgress, resolveAiSecurityPolicy } from "../lib/ai/aiSecurityPolicy";
import { resolveAuditLocality } from "../lib/ai/imageSendAudit";

export const aiComparisonRouter = Router();

function canUse(req: StaffAuthRequest): boolean {
  const u = req.staffSession ?? null;
  if (!u) return false;
  if (FULL_ACCESS_ROLES.has(u.role)) return true;
  return u.permissions.includes("ai_reporting.use");
}

function canConfigure(req: StaffAuthRequest): boolean {
  const u = req.staffSession ?? null;
  if (!u) return false;
  if (FULL_ACCESS_ROLES.has(u.role)) return true;
  return u.permissions.includes("ai_reporting.configure");
}

/**
 * The ceilings `/vision-trial` already puts on browser-supplied pictures. A
 * comparison fans one body out to every selected provider, so an uncapped paste
 * would be multiplied across all of them rather than sent once.
 */
const MAX_COMPARISON_IMAGES = 6;
const MAX_COMPARISON_IMAGE_CHARS = 3_500_000;
/** One run opens this many provider calls at once, on the same machine that is
 *  already serving the viewer and the models. */
const MAX_COMPARISON_ARMS = 6;

/** Raw base64 or a data URL — both are accepted by the provider layer, which
 *  strips or wraps as each wire format needs. Returns null when the set is
 *  rejected as a whole, never a shortened list. */
function normalizeComparisonImages(raw: unknown): string[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_COMPARISON_IMAGES) return null;
  const out: string[] = [];
  for (const item of raw) {
    const s = typeof item === "string" ? item.trim() : "";
    if (!s || s.length > MAX_COMPARISON_IMAGE_CHARS) return null;
    out.push(s);
  }
  return out;
}

type ComparisonArm = { provider: string; model: string };

/**
 * `arms` is the shape a model comparison needs; `providers` (+ optional
 * `models`) is what every caller sent before, so both still work and neither
 * can quietly mean something else. An empty model means "this provider's
 * configured default", which is the execution layer's decision, not this
 * route's guess.
 */
function resolveArms(
  arms: unknown,
  providers: unknown,
  models: unknown,
): { ok: true; arms: ComparisonArm[] } | { ok: false; error: string } {
  const raw: Array<{ provider?: string; model?: string }> =
    Array.isArray(arms) && arms.length > 0
      ? (arms as Array<{ provider?: string; model?: string }>)
      : Array.isArray(providers)
        ? providers.map((p) => ({
            provider: typeof p === "string" ? p : "",
            model: typeof (models as Record<string, string> | undefined)?.[String(p)] === "string"
              ? String((models as Record<string, string>)[String(p)])
              : "",
          }))
        : [];

  const clean: ComparisonArm[] = [];
  for (const a of raw) {
    const provider = typeof a?.provider === "string" ? a.provider.trim() : "";
    if (!provider) continue;
    const model = typeof a?.model === "string" ? a.model.trim() : "";
    if (clean.some((c) => c.provider === provider && c.model === model)) continue;
    clean.push({ provider, model });
  }

  if (clean.length === 0) return { ok: false, error: "At least one provider is required." };
  if (clean.length > MAX_COMPARISON_ARMS) {
    return { ok: false, error: `Compare at most ${MAX_COMPARISON_ARMS} models at a time.` };
  }
  return { ok: true, arms: clean };
}

/**
 * POST /api/ai-comparison/run
 * Run the same prompt against several model arms at once.
 */
aiComparisonRouter.post("/run", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canUse(sReq)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const { prompt, providers, arms, images, models, studyInstanceUid, attestCloudImageEgress } = req.body as {
    prompt: string;
    providers?: string[];
    /** Provider + model pairs, which is what a comparison actually is: two Ollama
     *  models and one cloud model are three arms but only two providers, and a
     *  provider→model map cannot name that. */
    arms?: Array<{ provider?: string; model?: string }>;
    images?: string[];
    /** Provider name → model name, so one run can put the same pictures in front of
     *  a chosen local model and a chosen cloud model. Omitted means "whatever this
     *  provider is configured to use", which is what every caller did before. */
    models?: Record<string, string>;
    /** The study the screen has open. Checked against the RIS and filed with the
     *  run; see below for what this does and does not claim. */
    studyInstanceUid?: string;
    /** PR-A2B — the clinician's own confirmation, in Clinical mode only. See
     *  `AiReportingQueryRequestSchema` for what this is and, importantly, is not. */
    attestCloudImageEgress?: boolean;
  };

  if (!prompt?.trim()) { res.status(400).json({ error: "Prompt is required." }); return; }
  const resolved = resolveArms(arms, providers, models);
  if (!resolved.ok) {
    res.status(400).json({ error: resolved.error });
    return;
  }
  const requestedArms = resolved.arms;

  const user = sReq.staffSession!;
  const imgs = normalizeComparisonImages(images);
  if (imgs === null) {
    // Rejected here rather than truncated: a comparison whose cloud arm silently
    // dropped three of the six pictures the local arm saw is not a comparison.
    res.status(400).json({
      error: `Send at most ${MAX_COMPARISON_IMAGES} images, each up to ${MAX_COMPARISON_IMAGE_CHARS} base64 characters.`,
    });
    return;
  }

  // PR-A2B — the clinic's egress decision, resolved ONCE for the whole fan-out.
  //
  // This route used to hand `generateAiResponse` an empty options object, which for
  // an image-bearing comparison meant the image gate saw no opt-in and denied: the
  // one screen built for "local model versus cloud model" could never put a picture
  // in front of the cloud model, in either security mode. Resolving once per request
  // also keeps the comparison honest — two arms of the same A/B cannot be judged by
  // two different readings of the settings if the admin flips the switch mid-run.
  //
  // `imageSourceTypes` is deliberately absent. These bytes arrive in the request
  // body, so nothing on this server can say whose pixels they are, and the gate
  // reads an omission as unprovenanced: free to go out in Development mode because
  // the administrator decided that, refused in Clinical mode until a clinician
  // attests. A client cannot supply the opt-in or the identity — both are read off
  // the clinic's stored settings and this request's session.
  //
  // The study the screen says it is comparing is checked against the RIS: not as
  // proof that these bytes came out of that study (they were fetched by the browser,
  // so they cannot be), but because an audit row that names a study has to name one
  // that exists here. A made-up or another clinic's UID is refused rather than filed.
  const claimedStudy = typeof studyInstanceUid === "string" ? studyInstanceUid.trim() : "";
  if (claimedStudy) {
    const [known] = await db
      .select({ id: radiologyStudiesTable.id })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.studyInstanceUid, claimedStudy))
      .limit(1);
    if (!known) {
      res.status(400).json({ error: "No radiology study in this clinic carries that DICOM StudyInstanceUID." });
      return;
    }
  }

  const egress = await resolveInteractiveImageEgress({
    imageCount: imgs.length,
    attestedBy: attestCloudImageEgress === true ? `staff-user:${user.subjectId}` : null,
  });

  const results = await Promise.all(
    requestedArms.map(async (arm, armIndex) => {
      const start = Date.now();
      const result = await generateAiResponse(arm.provider, prompt, imgs, {
        ...(arm.model ? { model: arm.model } : {}),
        ...egress.options,
      });
      const elapsedMs = Date.now() - start;

      // Audit log
      await db.insert(aiReportingAuditLogsTable).values({
        userId: user.subjectId,
        userName: user.subjectName,
        studyInstanceUID: claimedStudy || null,
        provider: arm.provider,
        model: result.execution?.model ?? (arm.model || null),
        promptText: prompt.substring(0, 2000),
        numImages: imgs.length,
        anonymized: DICOM_REDACTION_PERFORMED,
        // PR-A2B — the columns PR-A added to this table. A comparison run is exactly
        // where an auditor would look for "did a patient's picture reach a cloud
        // endpoint", and a row with a count and no locality cannot answer that.
        endpointLocality: resolveAuditLocality(
          arm.provider,
          null,
          result.execution?.locality ?? null,
        ),
        success: result.success,
        errorMessage: result.success ? null : (result.error ?? null),
      }).catch(() => { /* non-critical */ });

      return {
        armIndex,
        provider: arm.provider,
        requestedModel: arm.model || null,
        response: result.text,
        success: result.success,
        error: result.error || null,
        elapsedMs,
        // What the doctor compared has to be what actually answered. `execution` is
        // written by the layer that opened the socket, so the card can name the model
        // that was really sent and say whether the call ever left the clinic —
        // `attempted: false` is a policy stop before any bytes went anywhere.
        model: result.execution?.model ?? null,
        locality: result.execution?.locality ?? null,
        attempted: result.execution?.attempted ?? false,
        imageCount: imgs.length,
        aiSafetyLabel: "AI Draft – Requires Radiologist Review",
      };
    }),
  );

  res.json({ results });
});

/**
 * GET /api/ai-comparison/providers
 * List available providers, with the models each one offers to compare.
 *
 * The models come from the provider catalogue the execution layer already uses,
 * not a second list typed out in the page — which is how the comparison screen
 * ended up offering four providers while the server knew seven, and no model at
 * all. Ollama's own models are read live by the caller through
 * `POST /api/radiology-ollama/list-models`, because a pulled model is a fact about
 * the clinic's machine rather than about this catalogue.
 */
aiComparisonRouter.get("/providers", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canUse(sReq)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const providers = BUILTIN_PROVIDER_NAMES.map((name) => ({
    name,
    label: BUILTIN_PROVIDER_CONFIGS[name]?.label ?? name,
    models: BUILTIN_PROVIDER_CONFIGS[name]?.defaultModels ?? [],
  }));

  // The same resolver the run itself consults, so the screen and the gate cannot
  // disagree about what mode the clinic is in or whether cloud vision is enabled.
  // The ops-settings endpoint that holds the switch is admin-only; a reporting
  // clinician needs these two facts to know why a cloud arm will be refused, and
  // that is what this answers — not a second source of truth to configure.
  const policy = await resolveAiSecurityPolicy();

  res.json({
    providers,
    policy: {
      mode: policy.mode,
      cloudVisionAllowed: policy.cloudVisionAllowed,
      requireAttestation: policy.requireAttestation,
    },
  });
});

/**
 * POST /api/ai-comparison/save-winner
 * Save the selected winner response.
 */
aiComparisonRouter.post("/save-winner", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canUse(sReq)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const { prompt, provider, model, response } = req.body as {
    prompt?: string;
    provider?: string;
    model?: string;
    response?: string;
  };

  if (!prompt || !provider || !response) {
    res.status(400).json({ error: "prompt, provider, and response are required." }); return;
  }

  const user = sReq.staffSession!;
  await db.insert(aiReportingAuditLogsTable).values({
    userId: user.subjectId,
    userName: user.subjectName,
    provider,
    // "Which answer did the doctor keep?" is only answerable if the model that
    // produced it travels with it; this column used to be null for every row.
    model: typeof model === "string" && model.trim() ? model.trim() : null,
    promptText: prompt.substring(0, 2000),
    numImages: 0,
    anonymized: DICOM_REDACTION_PERFORMED,
    success: true,
    errorMessage: null,
  }).catch(() => { /* non-critical */ });

  res.json({ success: true, aiSafetyLabel: "AI Draft – Requires Radiologist Review" });
});
