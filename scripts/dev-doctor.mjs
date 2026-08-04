#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const checks = [];

function add(name, ok, detail, fix) {
  checks.push({ name, ok, detail, fix });
}

function run(cmd, args) {
  return spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
}

function readEnv() {
  const p = path.join(root, ".env");
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(
    fs.readFileSync(p, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1).replace(/^["']|["']$/g, "")];
      }),
  );
}

const node = run("node", ["--version"]);
add("Node.js", node.status === 0, node.stdout.trim() || node.stderr.trim(), "Install Node.js 22+.");

const pnpm = run("pnpm", ["--version"]);
add("pnpm", pnpm.status === 0, pnpm.stdout.trim() || pnpm.stderr.trim(), "Install pnpm 10.");

const env = readEnv();
const dbUrl = process.env.DATABASE_URL || env.DATABASE_URL;
add("DATABASE_URL", !!dbUrl, dbUrl ? "configured" : "missing", "Add DATABASE_URL to .env or export it in the shell.");

const apiPkg = JSON.parse(fs.readFileSync(path.join(root, "artifacts/api-server/package.json"), "utf8"));
const erpPkg = JSON.parse(fs.readFileSync(path.join(root, "artifacts/diagnostic-erp/package.json"), "utf8"));
add("API dev script", !!apiPkg.scripts?.dev, "@workspace/api-server", "Restore artifacts/api-server/package.json scripts.dev.");
add("ERP dev script", !!erpPkg.scripts?.dev, "@workspace/diagnostic-erp", "Restore artifacts/diagnostic-erp/package.json scripts.dev.");

const pgPortOpen = await new Promise((resolve) => {
  const socket = net.createConnection({ host: "127.0.0.1", port: 5432, timeout: 750 });
  socket.on("connect", () => { socket.destroy(); resolve(true); });
  socket.on("timeout", () => { socket.destroy(); resolve(false); });
  socket.on("error", () => resolve(false));
});
add("PostgreSQL port 5432", pgPortOpen, pgPortOpen ? "reachable" : "not reachable", "Start PostgreSQL: sudo pg_ctlcluster 16 main start");

let failed = 0;
for (const c of checks) {
  const icon = c.ok ? "PASS" : "FAIL";
  console.log(`${icon} ${c.name}: ${c.detail}`);
  if (!c.ok) {
    failed++;
    console.log(`     fix: ${c.fix}`);
  }
}

if (failed > 0) {
  console.log(`\n${failed} check(s) failed. Fix them before starting local dev.`);
  process.exit(1);
}
console.log("\nLocal dev prerequisites look ready.");
