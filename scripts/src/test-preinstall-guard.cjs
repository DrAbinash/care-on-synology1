#!/usr/bin/env node
const { execFileSync } = require("child_process");
const path = require("path");

const SCRIPT = path.resolve(__dirname, "..", "preinstall-check.cjs");

function run(envOverrides) {
  const env = { ...envOverrides, PATH: process.env.PATH };
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      env,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || "", stderr: err.stderr || "" };
  }
}

let passed = 0;
let failed = 0;

function assert(label, result, expectCode, stderrContains) {
  const codeOk = result.code === expectCode;
  const msgOk =
    !stderrContains || result.stderr.includes(stderrContains);
  if (codeOk && msgOk) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label}`);
    if (!codeOk) console.log(`        expected exit ${expectCode}, got ${result.code}`);
    if (!msgOk) console.log(`        stderr missing: "${stderrContains}"`);
    failed++;
  }
}

console.log("preinstall-check.cjs guard tests (pnpm " + execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim() + ")\n");

assert(
  "allows normal pnpm install",
  run({ npm_config_user_agent: "pnpm/10.0.0" }),
  0
);

assert(
  "blocks non-pnpm package managers",
  run({ npm_config_user_agent: "npm/9.0.0" }),
  1,
  "Use pnpm instead"
);

assert(
  "blocks missing user-agent",
  run({}),
  1,
  "Use pnpm instead"
);

assert(
  "blocks pnpm install --prod (npm_command=install)",
  run({
    npm_config_user_agent: "pnpm/10.0.0",
    npm_config_production: "true",
    npm_command: "install",
  }),
  1,
  "Do not run `pnpm install --prod`"
);

assert(
  "blocks pnpm install --prod (npm_command unset)",
  run({
    npm_config_user_agent: "pnpm/10.0.0",
    npm_config_production: "true",
  }),
  1,
  "Do not run `pnpm install --prod`"
);

assert(
  "allows pnpm deploy --prod (npm_command=deploy)",
  run({
    npm_config_user_agent: "pnpm/10.0.0",
    npm_config_production: "true",
    npm_command: "deploy",
  }),
  0
);

assert(
  "allows pnpm deploy --prod (npm_command=Deploy, case-insensitive)",
  run({
    npm_config_user_agent: "pnpm/10.0.0",
    npm_config_production: "true",
    npm_command: "Deploy",
  }),
  0
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
