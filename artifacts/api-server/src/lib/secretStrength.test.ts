import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkSecretStrength, weakSecretMessage, MIN_SECRET_LENGTH, reportWeakGuardedSecrets } from "./secretStrength";

const __dirname = dirname(fileURLToPath(import.meta.url));

// /api/internal/backup/download runs pg_dump and streams the ENTIRE patient
// database. Its router is mounted under the public /api/ prefix
// (routes/index.ts) and docker/nginx.conf proxies all of /api/ from the
// internet. There is no IP allowlist — the bearer token is the only control.
//
// Production was deployed with INTERNAL_API_KEY=1234, so this was a public
// database export:
//
//   curl -H "Authorization: Bearer 1234" \
//     https://<host>/api/internal/backup/download?format=gzip
//
// The auth code was already correct — fails closed when unset, constant-time
// compare. Nothing could distinguish a strong secret from "1234". These tests
// pin that a weak secret is now refused exactly like a missing one, and — most
// importantly — drive the REAL middleware with the real production value to
// prove the endpoint is actually closed rather than merely documented as such.

describe("checkSecretStrength", () => {
  test("the exact production value is rejected", () => {
    const w = checkSecretStrength("1234");
    expect(w).not.toBeNull();
    expect(w!.reason).toContain("well-known placeholder");
  });

  test("unset and empty are rejected", () => {
    for (const v of [undefined, null, "", "   "]) {
      expect(checkSecretStrength(v as string | undefined)?.reason).toBe("not set");
    }
  });

  test("common placeholders are rejected regardless of case or padding", () => {
    for (const v of ["changeme", "CHANGEME", "  Password  ", "secret", "admin", "test", "default", "api_key"]) {
      expect(checkSecretStrength(v), `${v} must be rejected`).not.toBeNull();
    }
  });

  test("anything shorter than the minimum is rejected", () => {
    const short = "aB3$xY9!kP2";
    expect(short.length).toBeLessThan(MIN_SECRET_LENGTH);
    expect(checkSecretStrength(short)?.reason).toContain("minimum");
  });

  test("long but low-entropy values are rejected", () => {
    // Clears the length bar, has no entropy.
    expect(checkSecretStrength("aaaaaaaaaaaaaaaaaaaaaaaa")?.reason).toContain("distinct characters");
    expect(checkSecretStrength("01234567890123456789")?.reason).toBeTruthy();
  });

  test("a realistic generated secret is accepted", () => {
    // `openssl rand -base64 32` shape.
    for (const v of [
      "kJ8n2Qw7Zx4Vb9Rt6Yu1Ip3Ol5As0Df=",
      "7f3a9c2e8b1d4650a7c3e9f2b8d1460537ace9bd2f814c06",
      "xK9$mP2#vQ7@nR4!tY6&wZ1*",
    ]) {
      expect(checkSecretStrength(v), `${v} must be accepted`).toBeNull();
    }
  });

  test("the operator message names the variable but never leaks the value", () => {
    const secret = "1234";
    const msg = weakSecretMessage("INTERNAL_API_KEY", checkSecretStrength(secret)!);
    expect(msg).toContain("INTERNAL_API_KEY");
    expect(msg).toContain("openssl rand");
    expect(msg, "the secret itself must never appear in a log or response").not.toContain(secret);
  });
});

// ── End-to-end through the real routers ──────────────────────────────────────
// Reaches into the Express Router stack and invokes the actual middleware, so
// this proves the endpoint is closed rather than asserting on source text.

type Handler = (req: unknown, res: unknown, next: () => void) => void | Promise<void>;

function fakeRes() {
  const out: { code?: number; body?: unknown } = {};
  const res = {
    status(c: number) { out.code = c; return res; },
    json(b: unknown) { out.body = b; return res; },
    header: () => undefined,
    setHeader: () => undefined,
  };
  return { res, out };
}

/** The auth guard is the first `router.use(...)` layer with no route path. */
async function runGuard(router: { stack: Array<{ route?: unknown; handle: Handler }> }, authHeader: string) {
  const layer = router.stack.find((l) => !l.route);
  expect(layer, "expected a router-level auth middleware").toBeTruthy();
  const { res, out } = fakeRes();
  let passed = false;
  const req = { header: (n: string) => (n.toLowerCase() === "authorization" ? authHeader : undefined), headers: {} };
  await layer!.handle(req, res, () => { passed = true; });
  return { passed, ...out };
}

describe("the internal routers refuse to serve behind a weak secret", () => {
  const saved = { ...process.env };
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { process.env = { ...saved }; });

  test("INTERNAL_API_KEY=1234 — the correct bearer no longer opens the DB export", async () => {
    process.env["INTERNAL_API_KEY"] = "1234";
    const mod = await import("../routes/internal-backup");
    const router = (mod.default ?? (mod as Record<string, unknown>)["internalBackupRouter"]) as never;

    // Even presenting the EXACT configured key must not get through.
    const r = await runGuard(router, "Bearer 1234");
    expect(r.passed, "a weak key must never authenticate").toBe(false);
    expect(r.code).toBe(503);
    expect(JSON.stringify(r.body)).toContain("INTERNAL_API_KEY");
    expect(JSON.stringify(r.body), "must not echo the secret").not.toContain('"1234"');
  });

  test("a strong INTERNAL_API_KEY still authenticates normally", async () => {
    const strong = "kJ8n2Qw7Zx4Vb9Rt6Yu1Ip3Ol5As0Df";
    process.env["INTERNAL_API_KEY"] = strong;
    const mod = await import("../routes/internal-backup");
    const router = (mod.default ?? (mod as Record<string, unknown>)["internalBackupRouter"]) as never;

    expect((await runGuard(router, `Bearer ${strong}`)).passed).toBe(true);
    // ...and a wrong key is still rejected, with 401 not 503.
    const bad = await runGuard(router, "Bearer wrong-but-long-enough-value");
    expect(bad.passed).toBe(false);
    expect(bad.code).toBe(401);
  });

  test("CRON_SECRET gets the same treatment", async () => {
    process.env["CRON_SECRET"] = "changeme";
    const mod = await import("../routes/internal-cron");
    const router = (mod.default ?? (mod as Record<string, unknown>)["internalCronRouter"]) as never;

    const r = await runGuard(router, "Bearer changeme");
    expect(r.passed).toBe(false);
    expect(r.code).toBe(503);
    expect(JSON.stringify(r.body)).toContain("CRON_SECRET");
  });

  test("DICOM study intake is deliberately NOT blocked — blocking it would stop ingestion", async () => {
    // care_erp_sync.py (the Orthanc→ERP hook) posts to
    //   /api/internal/radiology/studies
    //   /api/internal/radiology/dicom-event
    // with the same INTERNAL_API_KEY. Applying the weak-secret block to that
    // router would silently stop studies reaching the ERP — a clinical outage
    // traded for a security fix. The exposure there is closed by ROTATING the
    // key, not by refusing traffic. This pins the decision so a future change
    // does not "complete" the hardening and break radiology.
    const src = readFileSync(join(__dirname, "..", "routes", "internal-radiology.ts"), "utf8");
    expect(src, "internal-radiology must not adopt the weak-secret block").not.toContain("checkSecretStrength");
  });

  test("an unset key is still refused — the original fail-closed behaviour is intact", async () => {
    delete process.env["INTERNAL_API_KEY"];
    const mod = await import("../routes/internal-backup");
    const router = (mod.default ?? (mod as Record<string, unknown>)["internalBackupRouter"]) as never;

    const r = await runGuard(router, "Bearer anything");
    expect(r.passed).toBe(false);
    expect(r.code).toBe(503);
  });
});

describe("the boot-time report names what is still exposed", () => {
  test("a weak INTERNAL_API_KEY is reported, and says DICOM/HL7 remain reachable", () => {
    const lines: string[] = [];
    const weak = reportWeakGuardedSecrets((m) => lines.push(m), { INTERNAL_API_KEY: "1234" } as NodeJS.ProcessEnv);
    expect(weak).toEqual(["INTERNAL_API_KEY"]);
    expect(lines[0]).toContain("SECURITY");
    expect(lines[0]).toContain("DICOM study intake");
    expect(lines[0]).toContain("care_erp_sync.py");
    expect(lines[0], "must never print the value").not.toContain('"1234"');
  });

  test("an UNSET CRON_SECRET is not reported — that is a normal feature-off state", () => {
    const lines: string[] = [];
    const weak = reportWeakGuardedSecrets((m) => lines.push(m), { INTERNAL_API_KEY: "kJ8n2Qw7Zx4Vb9Rt6Yu1Ip3Ol5As0Df" } as NodeJS.ProcessEnv);
    expect(weak).toEqual([]);
    expect(lines).toEqual([]);
  });

  test("strong secrets produce no output at all", () => {
    const lines: string[] = [];
    const weak = reportWeakGuardedSecrets((m) => lines.push(m), {
      INTERNAL_API_KEY: "kJ8n2Qw7Zx4Vb9Rt6Yu1Ip3Ol5As0Df",
      CRON_SECRET: "7f3a9c2e8b1d4650a7c3e9f2b8d14605",
    } as NodeJS.ProcessEnv);
    expect(weak).toEqual([]);
    expect(lines).toEqual([]);
  });
});
