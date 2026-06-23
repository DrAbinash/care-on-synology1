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

  const { prompt, providers, images } = req.body as {
    prompt: string;
    providers: string[];
    images?: string[];
  };

  if (!prompt?.trim()) { res.status(400).json({ error: "Prompt is required." }); return; }
  if (!Array.isArray(providers) || providers.length === 0) {
    res.status(400).json({ error: "At least one provider is required." }); return;
  }

  const user = sReq.staffSession!;
  const results = await Promise.all(
    providers.map(async (providerName) => {
      const start = Date.now();
      const result = await generateAiResponse(providerName, prompt, images ?? [], {});
      const elapsedMs = Date.now() - start;

      // Audit log
      await db.insert(aiReportingAuditLogsTable).values({
        userId: user.subjectId,
        userName: user.subjectName,
        provider: providerName,
        model: null,
        promptText: prompt.substring(0, 2000),
        numImages: images?.length ?? 0,
        anonymized: true,
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
    anonymized: true,
    success: true,
    errorMessage: null,
  }).catch(() => { /* non-critical */ });

  res.json({ success: true, aiSafetyLabel: "AI Draft – Requires Radiologist Review" });
});
