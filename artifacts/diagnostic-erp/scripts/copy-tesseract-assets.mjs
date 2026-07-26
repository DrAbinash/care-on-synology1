#!/usr/bin/env node
/**
 * Copies the tesseract.js runtime assets (worker script, core WASM, English
 * traineddata) from node_modules into public/tesseract/, so the browser
 * fetches them same-origin instead of tesseract.js's CDN defaults
 * (cdn.jsdelivr.net for workerPath/corePath, cdn.jsdelivr.net/npm/@tesseract.js-data
 * for langPath). Re-run this after bumping tesseract.js / tesseract.js-core /
 * @tesseract.js-data versions to refresh the committed copies in public/.
 *
 * Why this matters: a clinic network with outbound restrictions (or this
 * repo's own sandboxed CI) can't reach jsdelivr, so the offline OCR fallback
 * (PurchaseInvoiceScannerPanel's "Scan Offline" path) needs these served from
 * the app's own origin to actually be offline, not just aspirationally so.
 */
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const outDir = join(here, "../public/tesseract");
mkdirSync(outDir, { recursive: true });

function resolveFrom(pkgMain, relativePath) {
  const pkgJsonPath = require.resolve(`${pkgMain}/package.json`);
  return join(dirname(pkgJsonPath), relativePath);
}

const files = [
  { from: resolveFrom("tesseract.js", "dist/worker.min.js"), to: "worker.min.js" },
  { from: resolveFrom("tesseract.js-core", "tesseract-core.wasm.js"), to: "tesseract-core.wasm.js" },
  { from: resolveFrom("tesseract.js-core", "tesseract-core.wasm"), to: "tesseract-core.wasm" },
  { from: resolveFrom("@tesseract.js-data/eng", "4.0.0_best_int/eng.traineddata.gz"), to: "eng.traineddata.gz" },
];

for (const f of files) {
  if (!existsSync(f.from)) {
    console.error(`Missing source file: ${f.from} — is the dependency installed?`);
    process.exitCode = 1;
    continue;
  }
  copyFileSync(f.from, join(outDir, f.to));
  console.log(`Copied ${f.to}`);
}
