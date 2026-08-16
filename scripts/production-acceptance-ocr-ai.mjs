#!/usr/bin/env node
/**
 * Production acceptance for CARE OCR → Draft pipeline (LAN).
 *
 * Verifies:
 *   1. Windows OCR worker reachable
 *   2. PaddleOCR loaded
 *   3. qwen3-vl:8b available on Ollama
 *   4. OCR → Draft path works (via CARE /api/ai-pipeline/test)
 *   5. Correct model selected (qwen3-vl:8b / configured standard)
 *   6. Output marked DRAFT
 *   7. Phase timings printed
 *
 * Usage (on Synology or any LAN host that can reach Windows + CARE API):
 *   set -a; source /volume1/docker/care/.env; set +a
 *   node scripts/production-acceptance-ocr-ai.mjs
 *
 * Env:
 *   OCR_WORKER_URL      default http://127.0.0.1:8090
 *   OCR_WORKER_TOKEN    required when worker auth is enabled
 *   OLLAMA_BASE_URL     default http://172.16.1.140:11434
 *   CARE_API_URL        default http://127.0.0.1:8080
 *   STAFF_USERNAME      default abinashsingh@gmail.com
 *   STAFF_PIN           default 1234
 *   EXPECTED_MODEL      default qwen3-vl:8b
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const workerUrl = (process.env.OCR_WORKER_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const workerToken = (process.env.OCR_WORKER_TOKEN || "").trim();
const ollamaUrl = (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_PRIMARY_URL || "http://172.16.1.140:11434").replace(/\/$/, "");
const careApi = (process.env.CARE_API_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const staffUser = process.env.STAFF_USERNAME || "abinashsingh@gmail.com";
const staffPin = process.env.STAFF_PIN || "1234";
const expectedModel = process.env.EXPECTED_MODEL || "qwen3-vl:8b";

const timings = {};
const failures = [];

function ok(label) {
  console.log(`  PASS  ${label}`);
}
function fail(label, detail) {
  failures.push(`${label}: ${detail}`);
  console.log(`  FAIL  ${label} — ${detail}`);
}

function authHeaders() {
  const h = {};
  if (workerToken) h["X-OCR-Token"] = workerToken;
  return h;
}

async function timed(name, fn) {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    timings[name] = Date.now() - t0;
  }
}

async function main() {
  console.log("CARE production acceptance — OCR / Local AI");
  console.log(`  worker=${workerUrl}`);
  console.log(`  ollama=${ollamaUrl}`);
  console.log(`  care=${careApi}`);
  console.log(`  expectedModel=${expectedModel}`);
  console.log("");

  // 1–2. Windows OCR worker + Paddle loaded
  console.log("Phase 1 — OCR worker");
  const health = await timed("workerHealthMs", async () => {
    const res = await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }).catch((e) => {
    fail("Windows OCR worker reachable", String(e.message || e));
    return null;
  });

  if (health) {
    ok("Windows OCR worker reachable");
    if (health.paddle_loaded) ok("PaddleOCR loaded");
    else fail("PaddleOCR loaded", JSON.stringify(health));
  }

  // Direct OCR smoke (token required in production)
  console.log("Phase 2 — OCR smoke");
  const samplesDir = join(root, "ocr-worker", "samples");
  mkdirSync(samplesDir, { recursive: true });
  const sample = join(samplesDir, "warmup-print.png");
  if (!existsSync(sample)) {
    writeFileSync(
      sample,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6aAAAAAElFTkSuQmCC",
        "base64",
      ),
    );
  }
  const ocrSmoke = await timed("workerOcrMs", async () => {
    const buf = readFileSync(sample);
    const form = new FormData();
    form.append("file", new Blob([buf]), "warmup-print.png");
    form.append("profile", "fast");
    const res = await fetch(`${workerUrl}/ocr`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }).catch((e) => {
    fail("OCR POST", String(e.message || e));
    return null;
  });
  if (ocrSmoke) {
    if (ocrSmoke.status === 401 || ocrSmoke.status === 503) {
      fail("OCR POST auth", `HTTP ${ocrSmoke.status} — set matching OCR_WORKER_TOKEN on worker and CARE`);
    } else if (ocrSmoke.status === 422 || ocrSmoke.status === 200) {
      // Tiny PNG may be empty (422) — connectivity + auth still prove the worker path.
      ok(`OCR POST (HTTP ${ocrSmoke.status})`);
    } else {
      fail("OCR POST", `HTTP ${ocrSmoke.status}`);
    }
  }

  // 3. Gemma3:4b available
  console.log("Phase 3 — Ollama qwen3-vl:8b");
  const models = await timed("ollamaTagsMs", async () => {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json.models || []).map((m) => m.name || "").filter(Boolean);
  }).catch((e) => {
    fail("Ollama reachable", String(e.message || e));
    return null;
  });
  if (models) {
    const has = models.some((m) => m === expectedModel || m.startsWith(`${expectedModel}-`) || m.startsWith(`${expectedModel}:`));
    // Also accept exact tag forms like qwen3-vl:8b-q4_K_M
    const hasExact = models.some((m) => m === expectedModel || m.split(":")[0] === expectedModel.split(":")[0] && m.includes(expectedModel.split(":")[1] || ""));
    if (has || hasExact || models.includes(expectedModel)) ok(`${expectedModel} available`);
    else fail(`${expectedModel} available`, `installed=${models.slice(0, 12).join(", ") || "(none)"}`);
  }

  // 4–6. CARE OCR→Draft via staff login + /api/ai-pipeline/test
  console.log("Phase 4 — CARE OCR→Draft");
  let cookie = "";
  const login = await timed("staffLoginMs", async () => {
    const res = await fetch(`${careApi}/api/portal/staff-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: staffUser, pin: staffPin }),
      signal: AbortSignal.timeout(15000),
    });
    const setCookie = res.headers.getSetCookie?.() || [];
    cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
    if (!cookie) {
      const raw = res.headers.get("set-cookie");
      if (raw) cookie = raw.split(",").map((p) => p.split(";")[0].trim()).filter((p) => p.includes("=")).join("; ");
    }
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json, cookie };
  }).catch((e) => {
    fail("Staff login", String(e.message || e));
    return null;
  });

  if (login && login.status >= 200 && login.status < 300 && cookie) {
    ok("Staff login");
  } else if (login) {
    fail("Staff login", `HTTP ${login.status}`);
  }

  let testBody = null;
  if (cookie) {
    testBody = await timed("pipelineTestMs", async () => {
      const res = await fetch(`${careApi}/api/ai-pipeline/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ mode: "STANDARD" }),
        signal: AbortSignal.timeout(120000),
      });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, json };
    }).catch((e) => {
      fail("OCR→Draft pipeline test", String(e.message || e));
      return null;
    });
  }

  if (testBody) {
    if (testBody.status >= 200 && testBody.status < 300) ok("OCR→Draft endpoint");
    else fail("OCR→Draft endpoint", `HTTP ${testBody.status}`);

    const draft = testBody.json?.draft;
    if (draft?.status === "DRAFT" && draft?.labeledDraft === true) ok("Output marked DRAFT");
    else fail("Output marked DRAFT", JSON.stringify(draft));

    const model = testBody.json?.routing?.model;
    if (model === expectedModel || (typeof model === "string" && model.startsWith(expectedModel))) {
      ok(`Correct model selected (${model})`);
    } else {
      fail("Correct model selected", `got=${model} expected=${expectedModel}`);
    }

    if (testBody.json?.timings) {
      Object.assign(timings, Object.fromEntries(
        Object.entries(testBody.json.timings).map(([k, v]) => [`api.${k}`, v]),
      ));
    }
  }

  // 7. Phase timings
  console.log("");
  console.log("Phase timings (ms)");
  for (const [k, v] of Object.entries(timings)) {
    console.log(`  ${k.padEnd(24)} ${v}`);
  }

  console.log("");
  if (failures.length) {
    console.log(`ACCEPTANCE FAILED (${failures.length})`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("ACCEPTANCE PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
