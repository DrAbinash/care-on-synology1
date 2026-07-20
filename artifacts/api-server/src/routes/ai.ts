import { Router } from "express";
import { db } from "@workspace/db";
import { patientsTable, ordersTable } from "@workspace/db";
import { orderTestsTable, testsTable, billsTable, paymentsTable, pacsSettingsTable } from "@workspace/db";
import { eq, desc, gte, lte, and } from "drizzle-orm";
import { requireStaffAuth, requireStaffPermission } from "../middleware/requireStaffAuth";
import { RADIOLOGY_WHISPER_PROMPT, normalizeDictation } from "../lib/ai/radiologyDictationVocab";
import {
  generateAiForTask,
} from "@workspace/ai-providers";
import {
  geminiTranscribe,
  buildClinicalNotePrompt,
  buildBillingInsightsPrompt,
  buildPatientMessagePrompt,
  buildRadiologyFindingsPrompt,
  buildRadiologyImpressionPrompt,
  type PatientMessageType,
} from "@workspace/integrations-gemini-ai";

const router = Router();

// Defense-in-depth: enforce staff authentication at the router level.
// These endpoints load patient PHI and billing data and send it to an external
// AI provider — they must never be reachable without a valid staff session.
// Individual routes below add requireStaffPermission matching the data domain
// each endpoint accesses, so that low-privilege staff cannot use AI to
// exfiltrate data from modules they have not been granted.
router.use(requireStaffAuth);

// ─── Unified AI provider helper for legacy AI endpoints ────────────────
// Each endpoint passes its task key so the Model Routing config (Phase 4) can
// send different tasks to different providers/models. With no route configured
// this resolves to the global default provider, matching the prior behavior.
async function legacyAiGenerate(
  task: string,
  prompt: string,
  options?: { maxTokens?: number; provider?: string },
): Promise<string> {
  const result = await generateAiForTask(task, prompt, [], {
    provider: options?.provider,
    maxTokens: options?.maxTokens,
  });
  if (!result.success) {
    throw new Error(result.error || "AI provider error");
  }
  return result.text;
}

// Generate AI clinical notes for a patient — requires /patients permission
// (loads patient demographics, orders, and test history from the patients module)
router.post("/clinical-note", requireStaffPermission("/patients"), async (req, res) => {
  const { patientId } = req.body;
  if (!patientId) { res.status(400).json({ error: "patientId required" }); return; }

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId));
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }

  const orders = await db
    .select({ order: ordersTable, testName: testsTable.name, testCode: testsTable.code, category: testsTable.category })
    .from(ordersTable)
    .leftJoin(orderTestsTable, eq(orderTestsTable.orderId, ordersTable.id))
    .leftJoin(testsTable, eq(testsTable.id, orderTestsTable.testId))
    .where(eq(ordersTable.patientId, patientId))
    .orderBy(desc(ordersTable.createdAt))
    .limit(20);

  const testHistory = orders
    .filter(o => o.testName)
    .map(o => `${o.testCode} (${o.testName}) — ${o.category} — Status: ${o.order.status}`)
    .join("\n");

  const prompt = buildClinicalNotePrompt(
    {
      firstName: patient.firstName,
      lastName: patient.lastName,
      patientId: patient.patientId,
      gender: patient.gender ?? "",
      dateOfBirth: patient.dateOfBirth ?? "",
      bloodGroup: (patient as Record<string, unknown>).bloodGroup as string | null | undefined,
    },
    testHistory,
  );

  try {
    const note = await legacyAiGenerate("clinical_notes", prompt);
    res.json({ note });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Generate billing insights — requires /reports permission
// (reads bills and payments tables and sends financial data to Gemini)
router.post("/billing-insights", requireStaffPermission("/reports"), async (req, res) => {
  const { from, to } = req.body as { from?: string; to?: string };

  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
  const toDate = to ? new Date(to) : new Date();

  const [bills, payments] = await Promise.all([
    db.select().from(billsTable).where(and(gte(billsTable.createdAt, fromDate), lte(billsTable.createdAt, toDate))),
    db.select().from(paymentsTable).where(and(gte(paymentsTable.createdAt, fromDate), lte(paymentsTable.createdAt, toDate))),
  ]);

  const totalRevenue = payments.reduce((s, p) => s + Number(p.amount), 0);
  const paidCount = bills.filter(b => b.status === "paid").length;
  const pendingCount = bills.filter(b => b.status === "pending").length;
  const partialCount = bills.filter(b => b.status === "partial").length;
  const totalDiscount = bills.reduce((s, b) => s + Number(b.discount), 0);
  const collectionRate = bills.length > 0 ? ((paidCount / bills.length) * 100).toFixed(1) : "0";
  const avgBill = bills.length > 0 ? (bills.reduce((s, b) => s + Number(b.totalAmount), 0) / bills.length).toFixed(0) : "0";

  const prompt = buildBillingInsightsPrompt({
    fromLabel: fromDate.toLocaleDateString("en-IN"),
    toLabel: toDate.toLocaleDateString("en-IN"),
    totalBills: bills.length,
    totalRevenue,
    paidCount,
    pendingCount,
    partialCount,
    totalDiscount,
    collectionRate,
    avgBill,
  });

  try {
    const insights = await legacyAiGenerate("billing_insights", prompt);
    res.json({ insights });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Draft patient follow-up message — requires /patients permission
// (loads patient identity information from the patients module)
router.post("/patient-message", requireStaffPermission("/patients"), async (req, res) => {
  const { patientId, type } = req.body as { patientId: number; type: "followup" | "results" | "payment" };
  if (!patientId) { res.status(400).json({ error: "patientId required" }); return; }

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId));
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }

  const prompt = buildPatientMessagePrompt(
    { firstName: patient.firstName, lastName: patient.lastName },
    (type as PatientMessageType) ?? "followup"
  );

  try {
    const message = await legacyAiGenerate("patient_communication", prompt, { maxTokens: 200 });
    res.json({ message });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── Radiology AI assistants ─────────────────────────────────────────────────
// All radiology AI endpoints require /orders permission — they are part of the
// radiology reporting workflow which is gated behind /orders on the server.

// Generate structured findings for a radiology study.
// Body: { modality: string, testName?: string, clinicalHistory?: string, dictation?: string }
// Returns: { findings: string }
router.post("/radiology-findings", requireStaffAuth, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const modality = String(b.modality ?? "").trim();
  const testName = String(b.testName ?? "").trim();
  const clinicalHistory = String(b.clinicalHistory ?? "").trim();
  const dictation = String(b.dictation ?? "").trim();
  if (!modality && !testName) {
    res.status(400).json({ error: "modality or testName required" }); return;
  }
  const prompt = buildRadiologyFindingsPrompt({ modality, testName, clinicalHistory, dictation });

  try {
    const findings = await legacyAiGenerate("report_findings", prompt, { maxTokens: 8192 });
    res.json({ findings });
  } catch (err: unknown) {
    req.log?.error({ err }, "ai radiology-findings failed");
    res.status(502).json({ error: "AI service unavailable. Please try again or write the findings manually." });
  }
});

// Generate a 1–4 line impression bullet list from a findings narrative.
// Body: { findings: string, modality?: string, testName?: string }
router.post("/radiology-impression", requireStaffAuth, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const findings = String(b.findings ?? "").trim();
  const modality = String(b.modality ?? "").trim();
  const testName = String(b.testName ?? "").trim();
  if (!findings) { res.status(400).json({ error: "findings required" }); return; }
  const prompt = buildRadiologyImpressionPrompt({ findings, modality, testName });
  try {
    const impression = await legacyAiGenerate("report_impression", prompt, { maxTokens: 1024 });
    res.json({ impression });
  } catch (err: unknown) {
    req.log?.error({ err }, "ai radiology-impression failed");
    res.status(502).json({ error: "AI service unavailable. Please try again or write the impression manually." });
  }
});

// ─── M1.6B3 — self-hosted (local network) STT proxy ─────────────────────────
// The clinic can point voice transcription at its OWN speech server (e.g. a
// whisper.cpp / faster-whisper container on the NAS) via pacs_settings —
// audio then never leaves the clinic network. This proxy exists because the
// browser cannot call the STT box directly (CORS + keeping its address out of
// client config). The target URL is ADMIN-CONFIGURED ONLY (pacs_settings POST
// is admin-gated), which bounds the SSRF surface to deliberate clinic config.

const LOCAL_STT_SETTINGS = { url: "voice_local_stt_url", kind: "voice_local_stt_kind", model: "voice_local_stt_model", prompt: "voice_local_stt_prompt" } as const;

async function readLocalSttConfig(): Promise<{ url: string; kind: "openai" | "whispercpp"; model: string; prompt: string; language: string } | null> {
  const rows = await db
    .select({ key: pacsSettingsTable.key, value: pacsSettingsTable.value })
    .from(pacsSettingsTable)
    .where(eq(pacsSettingsTable.category, "voice"));
  const get = (k: string) => rows.find((r) => r.key === k)?.value?.trim() ?? "";
  const url = get(LOCAL_STT_SETTINGS.url);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  // Vocabulary-biasing prompt: admin override if set, otherwise the built-in
  // radiology default. Language is the primary subtag of the dictation locale
  // (e.g. "en-IN" → "en"); Whisper wants ISO-639-1. Passing it stabilises short
  // clips instead of relying on per-clip auto-detection.
  const language = (get("voice_language") || "en-IN").split("-")[0].toLowerCase();
  return {
    url: url.replace(/\/+$/, ""),
    kind: get(LOCAL_STT_SETTINGS.kind) === "whispercpp" ? "whispercpp" : "openai",
    model: get(LOCAL_STT_SETTINGS.model),
    prompt: get(LOCAL_STT_SETTINGS.prompt) || RADIOLOGY_WHISPER_PROMPT,
    language: language || "en",
  };
}

// M1.6B2/B3 — capability probe for the voice layer's provider selection.
// Reports ONLY booleans; never key material or the local STT address.
router.get("/transcribe/status", requireStaffAuth, async (_req, res) => {
  const server = Boolean(process.env.AI_INTEGRATIONS_GEMINI_API_KEY && process.env.AI_INTEGRATIONS_GEMINI_BASE_URL);
  let local = false;
  try { local = (await readLocalSttConfig()) !== null; } catch { /* settings unreadable → false */ }
  res.json({ available: server, server, local });
});

// Transcribe against the clinic's own STT server. Body: { audioBase64, mimeType }.
// Supports the two common self-hosted protocols: OpenAI-compatible
// /v1/audio/transcriptions (faster-whisper-server, LocalAI, speaches) and
// whisper.cpp's /inference. Response: { text }.
router.post("/transcribe/local", requireStaffAuth, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const audioBase64 = typeof b.audioBase64 === "string" ? b.audioBase64 : "";
  const mimeType = typeof b.mimeType === "string" && b.mimeType ? b.mimeType : "audio/webm";
  if (!audioBase64) { res.status(400).json({ error: "audioBase64 required" }); return; }
  const approxBytes = Math.floor((audioBase64.length * 3) / 4);
  if (approxBytes > 25_000_000) { res.status(413).json({ error: "Audio too large (max ~25 MB)" }); return; }
  const config = await readLocalSttConfig().catch(() => null);
  if (!config) {
    res.status(503).json({ error: "Local transcription is not configured. Set the STT server URL in Radiology Settings → Voice." });
    return;
  }
  try {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(audioBase64, "base64")], { type: mimeType }), "audio.webm");
    // Vocabulary biasing (initial_prompt) + language + greedy decoding are the
    // three levers that turn a general STT model into a medical-grade one for
    // radiology speech. Sent on both protocols; harmless if the server ignores
    // a field it doesn't support.
    form.append("prompt", config.prompt);
    form.append("language", config.language);
    form.append("temperature", "0");
    let endpoint: string;
    if (config.kind === "whispercpp") {
      endpoint = `${config.url}/inference`;
      form.append("response_format", "json");
    } else {
      endpoint = `${config.url}/v1/audio/transcriptions`;
      form.append("model", config.model || "whisper-1");
      form.append("response_format", "json");
    }
    const upstream = await fetch(endpoint, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
    if (!upstream.ok) {
      req.log?.warn({ status: upstream.status }, "local stt upstream error");
      res.status(502).json({ error: `Local STT server responded ${upstream.status}. Check the server and its protocol setting.` });
      return;
    }
    const data = (await upstream.json().catch(() => null)) as { text?: unknown } | null;
    // Post-process with the deterministic radiology normaliser (acronym casing,
    // units, decimals/dimensions) so every provider returns clean report text.
    const text = normalizeDictation(typeof data?.text === "string" ? data.text : "");
    res.json({ text });
  } catch (err: unknown) {
    req.log?.error({ err }, "local stt transcription failed");
    res.status(502).json({ error: "Local STT server unreachable. Check the URL in Radiology Settings → Voice." });
  }
});

// Transcribe a short voice dictation. Body: { audioBase64, mimeType }
// Browsers' built-in Web Speech API does the live transcription on the client;
// this endpoint is the server-side fallback for browsers that lack it (Firefox,
// Safari on some devices) or when the radiologist uploads a recorded clip.
router.post("/transcribe", requireStaffAuth, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const audioBase64 = typeof b.audioBase64 === "string" ? b.audioBase64 : "";
  const mimeType = typeof b.mimeType === "string" && b.mimeType ? b.mimeType : "audio/webm";
  if (!audioBase64) { res.status(400).json({ error: "audioBase64 required" }); return; }
  // Reject anything > ~7.5 MB after base64 expansion to stay under Gemini's 8 MB inline cap.
  const approxBytes = Math.floor((audioBase64.length * 3) / 4);
  if (approxBytes > 7_500_000) {
    res.status(413).json({ error: "Audio chunk too large (max ~7.5 MB). Split into shorter clips." });
    return;
  }
  try {
    const raw = await geminiTranscribe(audioBase64, mimeType);
    res.json({ text: normalizeDictation(raw) });
  } catch (err: unknown) {
    req.log?.error({ err }, "ai transcribe failed");
    res.status(502).json({ error: "Voice transcription is temporarily unavailable. Please try again." });
  }
});

// ─── Phase 8: Teaching AI Assistant ──────────────────────────────────────────
router.post("/teaching-assistant", requireStaffAuth, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const text = String(b.text ?? "").trim();
  const mode = String(b.mode ?? "full");
  if (!text) { res.status(400).json({ error: "text required" }); return; }

  const prompt = `You are an AI Teaching Assistant for radiology residents.
Based on the following case findings, generate structured teaching material:

${text}

Generate:
1. A concise 2-paragraph summary of the case
2. 5-7 key learning points (bullet points)
3. A differential diagnosis list with brief rationale
4. 5-7 exam pearls for radiology boards
5. 5-6 multiple-choice exam questions (format: question, 4 options A-D, correct answer letter, explanation)
6. A "Why this diagnosis" paragraph explaining the key findings
7. 3-4 references to similar case types

Return as JSON with keys: summary, learningPoints, differentialDiagnosis, examPearls, examQuestions (array of strings like "Q1\nA) ...\nB) ...\nC) ...\nD) ...\nAnswer: A\nExplanation: ..."), whyThisCase, similarCases, teachingLevel.
Do NOT auto-finalize or sign. The radiologist is the final authority.`;

  try {
    const result = await legacyAiGenerate("teaching_assistant", prompt, { maxTokens: 4096 });
    // Parse JSON from the response
    let parsed: Record<string, unknown> = {};
    try {
      const match = result.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch {
      // Fallback to plain text
      parsed = { summary: result, learningPoints: "", differentialDiagnosis: "", examPearls: "", examQuestions: [], whyThisCase: "", similarCases: "", teachingLevel: "resident" };
    }
    res.json({
      result: {
        summary: String(parsed.summary ?? result),
        learningPoints: String(parsed.learningPoints ?? ""),
        differentialDiagnosis: String(parsed.differentialDiagnosis ?? ""),
        examPearls: String(parsed.examPearls ?? ""),
        examQuestions: Array.isArray(parsed.examQuestions) ? parsed.examQuestions.map((q: unknown) => String(q)) : [],
        whyThisCase: String(parsed.whyThisCase ?? ""),
        similarCases: String(parsed.similarCases ?? ""),
        teachingLevel: String(parsed.teachingLevel ?? "resident"),
      },
    });
  } catch (err: unknown) {
    req.log?.error({ err }, "ai teaching-assistant failed");
    res.status(502).json({ error: "AI service unavailable. Please try again." });
  }
});

router.post("/teaching-mode", requireStaffAuth, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const text = String(b.text ?? "").trim();
  if (!text) { res.status(400).json({ error: "text required" }); return; }

  const prompt = `You are an expert radiology educator. Generate teaching material for the following case:

${text}

Generate:
1. "Why This Diagnosis" - explain the radiological reasoning step-by-step
2. "Differential Diagnosis" - list top 5 differential diagnoses with distinguishing features
3. "Learning Points" - 5-7 key educational points
4. "Exam Pearls" - 5-7 tips for radiology board exams
5. "References" - suggested reading or similar case types

Return as JSON with keys: why, differentialDiagnosis, learningPoints, examPearls, references, teachingLevel, similarCases.
Do NOT auto-finalize or sign. The radiologist is the final authority.`;

  try {
    const result = await legacyAiGenerate("teaching_mode", prompt, { maxTokens: 4096 });
    let parsed: Record<string, unknown> = {};
    try {
      const match = result.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch {
      parsed = { why: result, differentialDiagnosis: "", learningPoints: "", examPearls: "", references: "", teachingLevel: "resident", similarCases: "" };
    }
    res.json({
      result: {
        why: String(parsed.why ?? result),
        differentialDiagnosis: String(parsed.differentialDiagnosis ?? ""),
        learningPoints: String(parsed.learningPoints ?? ""),
        examPearls: String(parsed.examPearls ?? ""),
        references: String(parsed.references ?? ""),
        teachingLevel: String(parsed.teachingLevel ?? "resident"),
        similarCases: String(parsed.similarCases ?? ""),
      },
    });
  } catch (err: unknown) {
    req.log?.error({ err }, "ai teaching-mode failed");
    res.status(502).json({ error: "AI service unavailable. Please try again." });
  }
});

router.post("/teaching-presentation", requireStaffAuth, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const text = String(b.text ?? "").trim();
  const mode = String(b.mode ?? "slides");
  if (!text) { res.status(400).json({ error: "text required" }); return; }

  let prompt = "";
  if (mode === "slides") {
    prompt = `Generate a teaching presentation with 5-7 slides for the following radiology case:
${text}

Return as JSON: slides (array of {title, content, type} where type is "case"|"image"|"question"|"summary"|"reference"), duration, unknownCase.
Each slide should have 50-100 words of content suitable for projection.
Do NOT auto-finalize or sign. The radiologist is the final authority.`;
  } else if (mode === "quiz") {
    prompt = `Generate 5 multiple-choice quiz questions based on the following radiology case:
${text}

Return as JSON: quiz (array of {question, options (array of 4 strings), correctAnswer (0-3), explanation}), duration.
Do NOT auto-finalize or sign. The radiologist is the final authority.`;
  } else {
    prompt = `Generate an "unknown case" teaching presentation from the following radiology case:
${text}

Return as JSON: unknownCase {findings, impression, reveal}, slides (array of {title, content, type}), duration.
The unknown case should present only the findings first, then reveal the diagnosis.
Do NOT auto-finalize or sign. The radiologist is the final authority.`;
  }

  try {
    const result = await legacyAiGenerate("teaching_presentation", prompt, { maxTokens: 4096 });
    let parsed: Record<string, unknown> = {};
    try {
      const match = result.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch {
      parsed = {
        slides: [{ title: "Case", content: result, type: "case" }],
        quiz: [],
        unknownCase: { findings: text, impression: "", reveal: result },
        duration: "10 min",
      };
    }
    res.json({
      result: {
        slides: Array.isArray(parsed.slides) ? parsed.slides : [{ title: "Case", content: result, type: "case" }],
        quiz: Array.isArray(parsed.quiz) ? parsed.quiz : [],
        unknownCase: (parsed.unknownCase as Record<string, string> | undefined) ?? { findings: text, impression: "", reveal: result },
        duration: String(parsed.duration ?? "10 min"),
      },
    });
  } catch (err: unknown) {
    req.log?.error({ err }, "ai teaching-presentation failed");
    res.status(502).json({ error: "AI service unavailable. Please try again." });
  }
});

export default router;
