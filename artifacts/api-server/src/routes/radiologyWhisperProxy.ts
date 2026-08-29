// ─────────────────────────────────────────────────────────────────────────────
// Local Whisper STT proxy — for air-gapped radiology deployments.
//
// Radiology environments without internet can't use the browser's Web Speech
// API (which requires Google/Microsoft cloud STT). This route proxies audio
// to a local Whisper / faster-whisper instance running on the same network.
//
// Configuration (env):
//   WHISPER_URL=http://192.168.1.250:8091/transcribe
//   WHISPER_API_KEY=optional bearer token
//   WHISPER_MODEL=base  (tiny|base|small|medium|large — default: base)
//
// If WHISPER_URL is not set, this route returns 503 with a clear message so
// the frontend can fall back to Web Speech API.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from "express";
import multer from "multer";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB — Whisper limit
});

// ── Health check ──────────────────────────────────────────────────────────────
router.get("/health", (_req: Request, res: Response) => {
  const whisperUrl = process.env.WHISPER_URL;
  if (!whisperUrl) {
    return res.json({
      available: false,
      reason: "WHISPER_URL not configured — local STT unavailable. Set WHISPER_URL to enable air-gapped dictation.",
      model: null,
    });
  }
  return res.json({
    available: true,
    url: whisperUrl,
    model: process.env.WHISPER_MODEL || "base",
  });
});

// ── Transcribe ────────────────────────────────────────────────────────────────
router.post("/transcribe", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    const whisperUrl = process.env.WHISPER_URL;
    if (!whisperUrl) {
      return res.status(503).json({
        error: "Local Whisper STT is not configured. Set WHISPER_URL env var.",
        fallback: "Use the browser's Web Speech API (Chrome/Edge with internet).",
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided. Send multipart/form-data with an 'audio' field." });
    }

    const model = process.env.WHISPER_MODEL || "base";
    const language = (req.body.language as string) || "en";
    const apiKey = process.env.WHISPER_API_KEY;

    // Build form data for the Whisper instance
    const formData = new FormData();
    const audioBytes = new Uint8Array(req.file.buffer);
    formData.append("audio", new Blob([audioBytes], { type: req.file.mimetype }), req.file.originalname || "dictation.webm");
    formData.append("model", model);
    formData.append("language", language);

    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const whisperRes = await fetch(whisperUrl, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text().catch(() => "unknown error");
      return res.status(502).json({
        error: `Whisper STT returned ${whisperRes.status}: ${errText}`,
        whisperUrl,
      });
    }

    const result = await whisperRes.json() as { text?: string; segments?: any[]; language?: string };
    const text = (result.text || "").trim();

    if (!text) {
      return res.status(422).json({
        error: "Whisper STT returned empty text — no speech detected.",
        ok: false,
        empty: true,
      });
    }

    return res.json({
      ok: true,
      text,
      language: result.language || language,
      model,
      segments: result.segments?.length || 0,
    });
  } catch (err) {
    console.error("[whisper-proxy] Error:", err);
    return res.status(500).json({
      error: "Failed to transcribe audio via local Whisper.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
