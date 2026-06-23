// Care Diagnostics Fingerprint Bridge
// -------------------------------------------------------------
// Runs on each workstation that has a USB fingerprint scanner.
// Browser pages call http://127.0.0.1:8765/* for capture/identify.
// The bridge talks to:
//   • a vendor adapter (ZKTeco / Mantra MFS100 / Morpho / Mock)
//   • the central ERP API (templates + identify endpoints)
//
// Configuration via environment variables:
//   BRIDGE_PORT          (default 8765)
//   BRIDGE_VENDOR        mock | zkteco | mantra | morpho
//   ERP_BASE_URL         e.g. https://your-erp.example.com
//   ERP_BRIDGE_SECRET    matches FINGERPRINT_BRIDGE_SECRET on the server
//   BRIDGE_ALLOW_ORIGINS comma-separated list (default *)

import express from "express";
import cors from "cors";
import { loadAdapter } from "./adapters/index.js";

const PORT = Number(process.env.BRIDGE_PORT ?? 8765);
const VENDOR = process.env.BRIDGE_VENDOR ?? "mock";
const ERP_BASE = (process.env.ERP_BASE_URL ?? "").replace(/\/$/, "");
const ERP_SECRET = process.env.ERP_BRIDGE_SECRET ?? "";

// Startup-time security validation
if (!ERP_SECRET) {
  console.error("[bridge] FATAL: ERP_BRIDGE_SECRET is not set. The ERP server will reject all bridge requests without it. Set ERP_BRIDGE_SECRET to the same value as FINGERPRINT_BRIDGE_SECRET on the server.");
  process.exit(1);
}

// BRIDGE_ALLOW_ORIGINS must be explicitly configured. Defaults to the ERP
// origin when ERP_BASE_URL is set, or denies all cross-origin requests.
// Using "*" would let any website on the workstation invoke biometric endpoints
// via the browser — it is explicitly rejected.
const _rawAllow = process.env.BRIDGE_ALLOW_ORIGINS ?? "";
if (_rawAllow.trim() === "*") {
  console.error("[bridge] FATAL: BRIDGE_ALLOW_ORIGINS=\"*\" is not permitted. It would allow any website on this workstation to access biometric endpoints. Set it to the specific ERP origin, e.g. https://erp.yourdomain.com");
  process.exit(1);
}

let ALLOW;
if (_rawAllow.trim()) {
  ALLOW = _rawAllow.split(",").map((s) => s.trim()).filter(Boolean);
} else if (ERP_BASE) {
  try {
    ALLOW = [new URL(ERP_BASE).origin];
  } catch {
    ALLOW = [];
  }
} else {
  ALLOW = [];
}

const adapter = await loadAdapter(VENDOR);
console.log(`[bridge] Loaded adapter: ${VENDOR}`);
if (ALLOW.length === 0) {
  console.warn("[bridge] WARNING: No BRIDGE_ALLOW_ORIGINS configured and ERP_BASE_URL is not set. All cross-origin browser requests will be blocked.");
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors({ origin: ALLOW.length > 0 ? ALLOW : false, credentials: false }));

function erp(path, init = {}) {
  if (!ERP_BASE) throw new Error("ERP_BASE_URL not configured");
  return fetch(`${ERP_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(ERP_SECRET ? { "x-bridge-secret": ERP_SECRET } : {}),
      ...(init.headers ?? {}),
    },
  }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
    return r.json();
  });
}

// ── Health / device status ─────────────────────────────
app.get("/health", async (_req, res) => {
  try {
    const status = await adapter.status();
    res.json({ ok: true, vendor: VENDOR, version: "1.0.0", erp: !!ERP_BASE, ...status });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Live capture (used during enrollment) ──────────────
// Requires a captureToken obtained from POST /api/bridge/capture-challenge by an
// authenticated staff session. Without this token the raw biometric template
// is never exposed, preventing exfiltration by malicious scripts on the ERP origin.
app.post("/capture", async (req, res) => {
  try {
    const { captureToken } = req.body ?? {};
    if (!captureToken) {
      return res.status(400).json({ error: "captureToken is required. The ERP client must obtain one via POST /api/bridge/capture-challenge before calling /capture." });
    }
    let validation;
    try {
      validation = await erp("/api/bridge/validate-capture-token", {
        method: "POST",
        body: JSON.stringify({ captureToken }),
      });
    } catch (e) {
      return res.status(401).json({ error: e.message || "Invalid capture token" });
    }
    if (!validation.ok) {
      return res.status(401).json({ error: validation.error || "Invalid capture token" });
    }
    const { template, quality } = await adapter.capture();
    res.json({ vendor: VENDOR, template, quality });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Enroll: capture → POST to ERP ──────────────────────
// Requires an enrollToken obtained from POST /api/bridge/enroll-challenge by an
// authenticated staff session. Without this token the ERP server will reject
// the enrollment, preventing unauthorised fingerprint registration.
app.post("/enroll", async (req, res) => {
  try {
    const { scope, scopeId, fingerName, enrollToken } = req.body ?? {};
    if (!scope || !scopeId) return res.status(400).json({ error: "scope and scopeId required" });
    if (!enrollToken) return res.status(400).json({ error: "enrollToken is required. The ERP client must obtain one via POST /api/bridge/enroll-challenge before calling /enroll." });
    const { template, quality } = await adapter.capture();
    const stored = await erp("/api/bridge/enroll", {
      method: "POST",
      headers: { "x-enroll-token": enrollToken },
      body: JSON.stringify({ scope, scopeId, vendor: VENDOR, template, quality, fingerName }),
    });
    res.json({ ok: true, template: stored });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Identify: capture → fetch candidate templates → match locally ──
app.post("/identify", async (req, res) => {
  try {
    const { scope } = req.body ?? {};
    if (!scope) return res.status(400).json({ error: "scope required" });
    const { template: liveTemplate } = await adapter.capture();
    const candidates = await erp(`/api/bridge/templates?scope=${encodeURIComponent(scope)}`);
    if (!candidates.length) return res.status(404).json({ error: "No templates enrolled yet" });

    // Use the vendor adapter to score every candidate locally
    let best = null;
    for (const c of candidates) {
      const score = await adapter.match(liveTemplate, c.template);
      if (!best || score > best.score) best = { ...c, score };
    }
    if (!best || best.score < adapter.threshold) {
      return res.status(404).json({ error: "No fingerprint matched", bestScore: best?.score ?? 0 });
    }
    res.json({ templateId: best.id, scope: best.scope, scopeId: best.scopeId, score: best.score });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Punch attendance: identify staff + tell ERP ────────
// Requires punchToken obtained from POST /api/bridge/punch-challenge by an
// authenticated staff session. Without it the ERP server rejects the punch.
app.post("/staff-punch", async (req, res) => {
  try {
    const { action, punchToken } = req.body ?? {};
    if (!punchToken) return res.status(400).json({ error: "punchToken is required. The ERP client must obtain one via POST /api/bridge/punch-challenge before calling /staff-punch." });
    const { template: live } = await adapter.capture();
    const candidates = await erp(`/api/bridge/templates?scope=staff`);
    if (!candidates.length) return res.status(404).json({ error: "No staff fingerprints enrolled" });
    let best = null;
    for (const c of candidates) {
      const s = await adapter.match(live, c.template);
      if (!best || s > best.score) best = { ...c, score: s };
    }
    if (!best || best.score < adapter.threshold) return res.status(404).json({ error: "Not recognised" });
    const result = await erp("/api/bridge/staff-punch", {
      method: "POST",
      headers: { "x-punch-token": punchToken },
      body: JSON.stringify({ templateId: best.id, action: action ?? "in" }),
    });
    res.json({ ...result, score: best.score });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── User login: identify user + get a session token ────
// Requires loginToken obtained from POST /api/bridge/login-challenge. No staff
// session is needed to get the login-challenge (fingerprint IS the auth), but
// requiring the two-step flow prevents raw single-fetch scripted login attempts.
app.post("/user-login", async (req, res) => {
  try {
    const { loginToken } = req.body ?? {};
    if (!loginToken) return res.status(400).json({ error: "loginToken is required. Obtain one via POST /api/bridge/login-challenge before calling /user-login." });
    const { template: live } = await adapter.capture();
    const candidates = await erp(`/api/bridge/templates?scope=user`);
    if (!candidates.length) return res.status(404).json({ error: "No users enrolled" });
    let best = null;
    for (const c of candidates) {
      const s = await adapter.match(live, c.template);
      if (!best || s > best.score) best = { ...c, score: s };
    }
    if (!best || best.score < adapter.threshold) return res.status(404).json({ error: "Not recognised" });
    const session = await erp("/api/bridge/user-login", {
      method: "POST",
      headers: { "x-login-token": loginToken },
      body: JSON.stringify({ templateId: best.id }),
    });
    res.json({ ...session, score: best.score });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[bridge] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[bridge] ERP: ${ERP_BASE || "(not configured)"}`);
});
