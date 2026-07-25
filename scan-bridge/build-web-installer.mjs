/**
 * build-web-installer.mjs — generate the self-contained, downloadable Windows
 * installer for the Scan Bridge.
 *
 * It embeds the REAL bridge source (this folder's package.json + src/**) into
 * `web-installer-template.ps1` and writes the result to the ERP's public assets
 * so it's served at `/erp/scanner/install-scan-bridge.ps1` and offered as a
 * "Download installer" button on Form F's ID-capture panel.
 *
 * Single source of truth: the bridge source is never hand-copied — re-run this
 * whenever scan-bridge/src changes:
 *     node scan-bridge/build-web-installer.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // scan-bridge/
const repoRoot = join(here, "..");
const outPath = join(repoRoot, "artifacts/diagnostic-erp/public/scanner/install-scan-bridge.ps1");

// Files the bridge needs at runtime (npm install pulls express/cors separately).
const FILES = [
  "package.json",
  "src/index.js",
  "src/adapters/index.js",
  "src/adapters/wia.js",
  "src/adapters/sane.js",
  "src/adapters/folder-watch.js",
  "src/adapters/mock.js",
];

const blocks = FILES.map((rel) => {
  const content = readFileSync(join(here, rel), "utf8");
  // A single-quoted PowerShell here-string (@' ... '@) is terminated only by a
  // line whose first characters are '@ — guard against that so the embed is safe.
  if (content.split(/\r?\n/).some((line) => line.startsWith("'@"))) {
    throw new Error(`${rel} contains a line starting with '@, which would break the PowerShell here-string. Reformat that line in the source.`);
  }
  const winRel = rel.replace(/\//g, "\\");
  return `$B['${winRel}'] = @'\n${content}\n'@`;
}).join("\n\n");

const template = readFileSync(join(here, "web-installer-template.ps1"), "utf8");
if (!template.includes("#__EMBEDDED_FILES__")) {
  throw new Error("web-installer-template.ps1 is missing the #__EMBEDDED_FILES__ placeholder.");
}
const output = template.replace("#__EMBEDDED_FILES__", blocks);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, output, "utf8");
console.log(`Wrote ${outPath} (${output.length} bytes, embedding ${FILES.length} files).`);
