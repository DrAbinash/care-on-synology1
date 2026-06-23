import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..", "..");

console.log("[verify-codegen] running codegen…");
const codegen = spawnSync("pnpm", ["--filter", "@workspace/api-spec", "run", "codegen"], {
  cwd: root,
  stdio: "inherit",
});
if (codegen.status !== 0) {
  console.error("[verify-codegen] codegen failed");
  process.exit(codegen.status ?? 1);
}

const diff = spawnSync(
  "git",
  ["--no-optional-locks", "diff", "--name-only", "--", "lib/api-zod/src", "lib/api-client-react/src"],
  { cwd: root, encoding: "utf8" },
);
if (diff.status !== 0) {
  console.error("[verify-codegen] git diff failed:", diff.stderr);
  process.exit(diff.status ?? 1);
}

const changed = (diff.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
if (changed.length > 0) {
  console.error("[verify-codegen] generated files are stale. Run `pnpm --filter @workspace/api-spec run codegen` and commit:");
  for (const f of changed) console.error("  - " + f);
  process.exit(1);
}
console.log("[verify-codegen] OK — generated files match the OpenAPI spec.");
