/**
 * AI Comparison Workspace (Phase 7A)
 * Run the same prompt against multiple providers simultaneously.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { aiProviderSettingsTable, aiReportingAuditLogsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import { generateAiResponse, BUILTIN_PROVIDER_NAMES } from "@workspace/ai-providers";
import { DICOM_REDACTION_PERFORMED } from "../lib/ai/dicomRedaction";
import { resolveInteractiveImageEgress } from "../lib/ai/aiSecurityPolicy";
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
 * POST /api/ai-comparison/run
 * Run the same prompt against multiple providers.
 */
aiComparisonRouter.post("/run", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canUse(sReq)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const { prompt, providers, images, attestCloudImageEgress } = req.body as {
    prompt: string;
    providers: string[];
    images?: string[];
    /** PR-A2B — the clinician's own confirmation, in Clinical mode only. See
     *  `AiReportingQueryRequestSchema` for what this is and, importantly, is not. */
    attestCloudImageEgress?: boolean;
  };

  if (!prompt?.trim()) { res.status(400).json({ error: "Prompt is required." }); return; }
  if (!Array.isArray(providers) || providers.length === 0) {
    res.status(400).json({ error: "At least one provider is required." }); return;
  }

  const user = sReq.staffSession!;
  const imgs = images ?? [];

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
  const egress = await resolveInteractiveImageEgress({
    imageCount: imgs.length,
    attestedBy: attestCloudImageEgress === true ? `staff-user:${user.subjectId}` : null,
  });

  const results = await Promise.all(
    providers.map(async (providerName) => {
      const start = Date.now();
      const result = await generateAiResponse(providerName, prompt, imgs, {
        ...egress.options,
      });
      const elapsedMs = Date.now() - start;

      // Audit log
      await db.insert(aiReportingAuditLogsTable).values({
        userId: user.subjectId,
        userName: user.subjectName,
        provider: providerName,
        model: null,
        promptText: prompt.substring(0, 2000),
        numImages: imgs.length,
        anonymized: DICOM_REDACTION_PERFORMED,
        // PR-A2B — the columns PR-A added to this table. A comparison run is exactly
        // where an auditor would look for "did a patient's picture reach a cloud
        // endpoint", and a row with a count and no locality cannot answer that.
        endpointLocality: resolveAuditLocality(
          providerName,
          null,
          result.execution?.locality ?? null,
        ),
        success: result.success,
        errorMessage: result.success ? null : (result.error ?? null),
      }).catch(() => { /* non-critical */ });

      return {
        provider: providerName,
        response: result.text,
        success: result.success,
        error: result.error || null,
        elapsedMs,
        aiSafetyLabel: "AI Draft – Requires Radiologist Review",
      };
    }),
  );

  res.json({ results });
});

/**
 * GET /api/ai-comparison/providers
 * List available providers.
 */
aiComparisonRouter.get("/providers", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canUse(sReq)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const builtIn = BUILTIN_PROVIDER_NAMES.map((name) => ({
    name,
    label: name === "openai" ? "OpenAI" : name === "gemini" ? "Google Gemini" : name === "anthropic" ? "Anthropic Claude" : name === "ollama" ? "Ollama" : name,
  }));

  res.json({ providers: builtIn });
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

  const { prompt, provider, response } = req.body as {
    prompt?: string;
    provider?: string;
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
    model: null,
    promptText: prompt.substring(0, 2000),
    numImages: 0,
    anonymized: DICOM_REDACTION_PERFORMED,
    success: true,
    errorMessage: null,
  }).catch(() => { /* non-critical */ });

  res.json({ success: true, aiSafetyLabel: "AI Draft – Requires Radiologist Review" });
});
