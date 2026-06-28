#!/usr/bin/env node
/**
 * bump-build.cjs
 * ==============
 * Auto-increments the build number in version.json before each deployment.
 * Called by docker-compose.yml as a pre-build service (or manually).
 *
 * Usage:
 *   node scripts/bump-build.cjs             -- increments build, prints new number
 *   node scripts/bump-build.cjs --dry-run   -- shows what would happen, no write
 *   node scripts/bump-build.cjs --show      -- prints current version info
 *   node scripts/bump-build.cjs --set 2.1.0 -- sets version manually (no build bump)
 *
 * version.json schema:
 *   {
 *     "version":     "2.0.0",       // Major.Minor.Patch — changed manually
 *     "releaseName": "...",          // Optional human name for this release
 *     "buildNumber": 42,             // Auto-incremented every deployment
 *     "notes":       "..."           // Optional release notes
 *   }
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

const ARGS      = process.argv.slice(2);
const DRY_RUN   = ARGS.includes("--dry-run");
const SHOW_ONLY = ARGS.includes("--show");
const SET_VER   = ARGS.includes("--set") ? ARGS[ARGS.indexOf("--set") + 1] : null;

const VERSION_PATH = path.resolve(__dirname, "../version.json");

if (!fs.existsSync(VERSION_PATH)) {
  console.error("version.json not found at", VERSION_PATH);
  process.exit(1);
}

const ver = JSON.parse(fs.readFileSync(VERSION_PATH, "utf8"));

if (SHOW_ONLY) {
  console.log(`Care Diagnostics ERP`);
  console.log(`Version:  ${ver.version}`);
  console.log(`Build:    ${ver.buildNumber}`);
  console.log(`Release:  ${ver.releaseName || "(unnamed)"}`);
  process.exit(0);
}

if (SET_VER) {
  if (!/^\d+\.\d+\.\d+$/.test(SET_VER)) {
    console.error("Invalid version format. Use Major.Minor.Patch e.g. 2.1.0");
    process.exit(1);
  }
  ver.version = SET_VER;
  fs.writeFileSync(VERSION_PATH, JSON.stringify(ver, null, 2) + "\n");
  console.log(`Version set to ${SET_VER} (build ${ver.buildNumber})`);
  process.exit(0);
}

// Auto-increment build number
const oldBuild = ver.buildNumber;
ver.buildNumber = (oldBuild || 0) + 1;

if (DRY_RUN) {
  console.log(`[dry-run] Would bump build: ${oldBuild} → ${ver.buildNumber}`);
  console.log(`[dry-run] Version: ${ver.version} build ${ver.buildNumber}`);
  process.exit(0);
}

fs.writeFileSync(VERSION_PATH, JSON.stringify(ver, null, 2) + "\n");
console.log(`Build bumped: ${oldBuild} → ${ver.buildNumber}`);
console.log(`Care Diagnostics ERP v${ver.version} build ${ver.buildNumber} (${ver.releaseName || ""})`);

// Print for docker-compose to capture as env var
process.stdout.write(`ERP_VERSION=${ver.version}\nBUILD_NUMBER=${ver.buildNumber}\nRELEASE_NAME=${ver.releaseName || ""}\n`);
