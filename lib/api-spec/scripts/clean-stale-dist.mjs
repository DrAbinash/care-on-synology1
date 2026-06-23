import { rm, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..", "..");

const targets = [
  "lib/api-client-react/dist",
  "lib/api-zod/dist",
];

await Promise.all(
  targets.map(async (rel) => {
    const abs = path.join(root, rel);
    await rm(abs, { recursive: true, force: true });
    console.log(`[clean-stale-dist] removed ${rel}`);
  }),
);

// Orval v8.5.3 bug: with mode:"single" (no schemas option) it still injects
// `export * from "./generated/api.schemas"` into lib/api-zod/src/index.ts even
// though api.schemas.ts is never written to disk. Strip the phantom line so
// the barrel only re-exports the real generated/api.ts (which already contains
// all inline Zod schemas). This is the preferred orval-level fix: single mode
// avoids emitting 163 duplicate TypeScript interface files (generated/types/*)
// that were the original source of TS2308 name collisions.
const apiZodIndex = path.join(root, "lib/api-zod/src/index.ts");
try {
  const original = await readFile(apiZodIndex, "utf8");
  const PHANTOM_LINES = [
    `export * from "./generated/api.schemas";`,
    `export * from "./generated/types";`,
  ];
  const stripped = original
    .split("\n")
    .filter((l) => !PHANTOM_LINES.includes(l.trim()))
    .join("\n");
  if (stripped !== original) {
    await writeFile(apiZodIndex, stripped, "utf8");
    console.log("[clean-stale-dist] stripped phantom barrel entries from api-zod index.ts");
  }
} catch (err) {
  console.warn("[clean-stale-dist] could not patch api-zod index.ts:", err);
}

// Rebuild composite libs so consumers (api-server, frontends) immediately
// see the regenerated types and zod schemas. Without this, codegen leaves
// the workspace in a broken typecheck state until something else triggers
// `tsc --build`.
console.log("[clean-stale-dist] rebuilding composite libs (tsc --build --force)…");
const result = spawnSync(
  "pnpm",
  ["exec", "tsc", "--build", "--force", "lib/api-zod", "lib/api-client-react"],
  { cwd: root, stdio: "inherit" },
);
if (result.status !== 0) {
  console.error("[clean-stale-dist] composite lib rebuild failed");
  process.exit(result.status ?? 1);
}
