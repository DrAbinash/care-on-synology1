#!/usr/bin/env node
/**
 * Benchmark harness for OCR engines (non-PHI samples only).
 * Does NOT invent accuracy % without ground truth — reports timings + confidence.
 *
 * Usage:
 *   node scripts/benchmark-ocr-ai.mjs [--paddle-url http://127.0.0.1:8090]
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const samplesDir = join(root, "ocr-worker", "samples");
const outDir = join(root, "docs", "ai-ocr");

const paddleUrl = (process.argv.find((a) => a.startsWith("--paddle-url=")) || "").split("=")[1]
  || process.env.OCR_WORKER_URL
  || "http://127.0.0.1:8090";

async function paddleOcr(filePath, profile) {
  const buf = readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf]), filePath.split(/[\\/]/).pop());
  form.append("profile", profile);
  const t0 = Date.now();
  const res = await fetch(`${paddleUrl.replace(/\/$/, "")}/ocr`, { method: "POST", body: form });
  const ms = Date.now() - t0;
  const json = await res.json().catch(() => ({}));
  return { ms, status: res.status, json };
}

async function main() {
  mkdirSync(samplesDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  // Ensure a tiny non-PHI PNG exists
  const sample = join(samplesDir, "warmup-print.png");
  if (!existsSync(sample)) {
    // 10x10 PNG
    writeFileSync(
      sample,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6aAAAAAElFTkSuQmCC",
        "base64",
      ),
    );
  }

  const health = await fetch(`${paddleUrl}/health`).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  const rows = [];
  for (const profile of ["fast", "accurate"]) {
    try {
      const r = await paddleOcr(sample, profile);
      rows.push({
        sample: "warmup-print.png",
        engine: "paddle",
        profile,
        httpStatus: r.status,
        ocrMs: r.ms,
        meanConfidence: r.json.mean_confidence ?? null,
        pathUsed: r.json.path_used ?? null,
        empty: r.json.empty ?? null,
        device: r.json.device ?? null,
      });
    } catch (e) {
      rows.push({ sample: "warmup-print.png", engine: "paddle", profile, error: String(e) });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    paddleUrl,
    health,
    note: "No accuracy percentage invented — add labelled ground-truth samples under ocr-worker/samples/ for manual review.",
    results: rows,
  };
  const outPath = join(outDir, "BENCHMARK_RESULTS.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
