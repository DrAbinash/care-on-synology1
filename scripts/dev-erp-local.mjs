#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const envPath = path.join(root, ".env");

function loadDotenv() {
  const env = { ...process.env };
  if (!fs.existsSync(envPath)) return env;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    const value = line.slice(i + 1).replace(/^["']|["']$/g, "");
    if (env[key] == null) env[key] = value;
  }
  return env;
}

const env = loadDotenv();
if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Run `pnpm dev:doctor` for setup guidance.");
  process.exit(1);
}

const children = [
  spawn("pnpm", ["--filter", "@workspace/api-server", "run", "dev"], { cwd: root, env, stdio: "inherit" }),
  spawn("pnpm", ["--filter", "@workspace/diagnostic-erp", "run", "dev"], { cwd: root, env, stdio: "inherit" }),
];

function stop(signal = "SIGTERM") {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => { stop("SIGINT"); process.exit(130); });
process.on("SIGTERM", () => { stop("SIGTERM"); process.exit(143); });

Promise.race(children.map((child) => new Promise((resolve) => child.on("exit", resolve)))).then((code) => {
  stop();
  process.exit(typeof code === "number" ? code : 1);
});
