#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const routeIndex = fs.readFileSync(path.join(root, "artifacts/api-server/src/routes/index.ts"), "utf8");
const openapiPath = path.join(root, "lib/api-spec/openapi.yaml");
const openapi = fs.existsSync(openapiPath) ? fs.readFileSync(openapiPath, "utf8") : "";

const mounts = Array.from(new Set(Array.from(routeIndex.matchAll(/router\.use\("([^"]+)"/g))
  .map((m) => `/api${m[1]}`.replace(/\/+/g, "/"))
  .filter((p) => p !== "/api/")));
const rawDocumented = Array.from(openapi.matchAll(/^\s{2}(\/[^:]+):/gm)).map((m) => m[1]);
const documented = new Set(rawDocumented.flatMap((p) => [p, `/api${p}`.replace(/\/+/g, "/")]));

const rows = mounts.map((mount) => {
  const covered = Array.from(documented).some((p) => p === mount || p.startsWith(`${mount}/`) || mount.startsWith(`${p}/`));
  return { mount, covered };
}).sort((a, b) => a.mount.localeCompare(b.mount));

const covered = rows.filter((r) => r.covered).length;
const report = {
  generatedAt: new Date().toISOString(),
  mountCount: rows.length,
  documentedMounts: covered,
  coveragePercent: rows.length ? Math.round((covered / rows.length) * 1000) / 10 : 0,
  gaps: rows.filter((r) => !r.covered).map((r) => r.mount),
};

console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--fail-under=100") && report.gaps.length > 0) process.exit(1);
