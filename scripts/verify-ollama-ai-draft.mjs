#!/usr/bin/env node
/**
 * verify-ollama-ai-draft.mjs — Pre-deploy Ollama auto AI draft checks.
 *
 *   pnpm operations:verify-ollama-ai-draft              # full (includes Ollama generate)
 *   pnpm operations:verify-ollama-ai-draft -- --dry-run # connectivity + config only
 *   pnpm operations:verify-ollama-ai-draft -- --json    # machine-readable
 *
 * Requires a running API and staff credentials:
 *   VERIFY_API_URL (default http://localhost:8080)
 *   STAFF_TOKEN  OR  STAFF_USERNAME/STAFF_EMAIL + STAFF_PIN
 */
const JSON_OUT = process.argv.includes("--json");
const DRY_RUN = process.argv.includes("--dry-run");

const C = JSON_OUT
  ? { g: "", r: "", y: "", d: "", n: "" }
  : { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", n: "\x1b[0m" };

async function loginForToken(apiBase) {
  const username = process.env.STAFF_USERNAME || process.env.STAFF_EMAIL;
  const pin = process.env.STAFF_PIN;
  if (!username || !pin) return null;
  const res = await fetch(`${apiBase}/api/portal/staff-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, pin }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.token ?? null;
}

async function verifyViaApi() {
  const apiBase = (process.env.VERIFY_API_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/$/, "");
  const token = process.env.STAFF_TOKEN || await loginForToken(apiBase);
  if (!token) {
    throw new Error(
      "Staff auth required: set STAFF_TOKEN or STAFF_USERNAME/STAFF_EMAIL + STAFF_PIN",
    );
  }

  const res = await fetch(`${apiBase}/api/radiology-ollama/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ dryRun: DRY_RUN, runDraft: !DRY_RUN }),
    signal: AbortSignal.timeout(DRY_RUN ? 60_000 : 180_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `API ${res.status}`);
  }
  return body;
}

function printResult(result) {
  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log("\n" + "=".repeat(60));
  console.log("  Ollama Auto AI Draft — Pre-Deploy Verification");
  console.log("=".repeat(60));
  for (const c of result.checks) {
    const col =
      c.status === "PASS" ? C.g
        : c.status === "FAIL" ? C.r
          : c.status === "WARNING" ? C.y
            : C.d;
    const tag = `${col}${c.status.padEnd(7)}${C.n}`;
    console.log(`  ${tag}  ${c.group} / ${c.name}`);
    console.log(`         ${C.d}${c.detail}${C.n}`);
    if (c.remediation) console.log(`         ${C.y}→ ${c.remediation}${C.n}`);
  }
  console.log("=".repeat(60));
  console.log(result.summary);
  console.log("=".repeat(60));
}

async function main() {
  const result = await verifyViaApi();
  printResult(result);
  if (result.blockingFailed || !result.ok) process.exit(1);
}

main().catch((e) => {
  if (!JSON_OUT) console.error(e instanceof Error ? e.message : e);
  else console.log(JSON.stringify({ ok: false, error: String(e) }));
  process.exit(1);
});
