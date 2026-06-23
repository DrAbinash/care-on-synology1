#!/usr/bin/env node
//
// Preinstall guard — keeps the workspace healthy by:
//   1. Removing stray package-lock.json / yarn.lock files
//   2. Blocking non-pnpm package managers
//   3. Blocking `pnpm install --prod` (corrupts the shared virtual store)
//      while still allowing `pnpm deploy --prod` (isolated, safe)
//
// pnpm sets `npm_command` to the subcommand name ("install", "deploy", etc.)
// and `npm_config_production` to "true" when `--prod` is passed.
// Verified on pnpm 10.33.2 — if pnpm is upgraded, re-run:
//   pnpm --filter @workspace/scripts run test:preinstall-guard
// to confirm the env vars are still set as expected.
//
const fs = require("fs");
const path = require("path");

for (const lock of ["package-lock.json", "yarn.lock"]) {
  const p = path.join(__dirname, "..", lock);
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
    } catch {}
  }
}

const ua = process.env.npm_config_user_agent || "";
if (!ua.startsWith("pnpm/")) {
  console.error("Use pnpm instead (run: npm i -g pnpm && pnpm install)");
  process.exit(1);
}

if (process.env.npm_config_production === "true") {
  const cmd = (process.env.npm_command || "").toLowerCase();
  if (cmd !== "deploy") {
    console.error(
      "ERROR: Do not run `pnpm install --prod` in this workspace.\n" +
      "It prunes devDependencies from the shared virtual store, breaking\n" +
      "CLI binaries (e.g. vite) that other packages depend on.\n" +
      "Use `pnpm deploy --prod <target-dir>` for isolated prod node_modules."
    );
    process.exit(1);
  }
}
