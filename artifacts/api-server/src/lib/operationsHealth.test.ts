import { describe, it, expect } from "vitest";
import {
  aggregateOverall, summarize, exitCodeFor, redactSecrets, safeError, redactMetadata,
  runOneCheck, runAllChecks, type OpsCheck, type OpsCheckDef,
} from "./operationsHealth";

const NOW = new Date("2026-07-21T10:00:00.000Z");

function chk(partial: Partial<OpsCheck> & Pick<OpsCheck, "status" | "required">): OpsCheck {
  return {
    id: partial.id ?? "x", name: partial.name ?? "X", category: partial.category ?? "application",
    status: partial.status, required: partial.required, message: partial.message ?? "",
    checkedAt: NOW.toISOString(), durationMs: partial.durationMs ?? 1, metadata: partial.metadata,
    recommendedAction: partial.recommendedAction,
  };
}

describe("aggregateOverall — required vs optional precedence", () => {
  it("all PASS → PASS; empty → PASS", () => {
    expect(aggregateOverall([])).toBe("PASS");
    expect(aggregateOverall([chk({ status: "PASS", required: true }), chk({ status: "PASS", required: false })])).toBe("PASS");
  });

  it("a REQUIRED FAIL fails the whole deployment", () => {
    expect(aggregateOverall([chk({ status: "PASS", required: true }), chk({ status: "FAIL", required: true })])).toBe("FAIL");
  });

  it("an OPTIONAL FAIL only degrades to WARNING — never fails the deploy", () => {
    expect(aggregateOverall([chk({ status: "PASS", required: true }), chk({ status: "FAIL", required: false })])).toBe("WARNING");
  });

  it("an OPTIONAL UNKNOWN also degrades to WARNING, not UNKNOWN", () => {
    expect(aggregateOverall([chk({ status: "UNKNOWN", required: false })])).toBe("WARNING");
  });

  it("a REQUIRED UNKNOWN surfaces as UNKNOWN (sits between WARNING and FAIL)", () => {
    expect(aggregateOverall([chk({ status: "WARNING", required: true }), chk({ status: "UNKNOWN", required: true })])).toBe("UNKNOWN");
  });

  it("REQUIRED FAIL still beats a REQUIRED UNKNOWN", () => {
    expect(aggregateOverall([chk({ status: "UNKNOWN", required: true }), chk({ status: "FAIL", required: true })])).toBe("FAIL");
  });

  it("SKIPPED checks never influence the overall", () => {
    expect(aggregateOverall([chk({ status: "SKIPPED", required: false }), chk({ status: "PASS", required: true })])).toBe("PASS");
    expect(aggregateOverall([chk({ status: "SKIPPED", required: true })])).toBe("PASS");
  });

  it("a required WARNING yields WARNING overall", () => {
    expect(aggregateOverall([chk({ status: "WARNING", required: true }), chk({ status: "PASS", required: true })])).toBe("WARNING");
  });
});

describe("summarize", () => {
  it("counts every bucket and total", () => {
    const s = summarize([
      chk({ status: "PASS", required: true }), chk({ status: "PASS", required: true }),
      chk({ status: "WARNING", required: true }), chk({ status: "FAIL", required: true }),
      chk({ status: "SKIPPED", required: false }), chk({ status: "UNKNOWN", required: true }),
    ]);
    expect(s).toEqual({ pass: 2, warning: 1, fail: 1, skipped: 1, unknown: 1, total: 6 });
  });
});

describe("exitCodeFor — CLI semantics", () => {
  it("only FAIL is non-zero by default; warnings are exit 0", () => {
    expect(exitCodeFor("PASS")).toBe(0);
    expect(exitCodeFor("WARNING")).toBe(0);
    expect(exitCodeFor("UNKNOWN")).toBe(0);
    expect(exitCodeFor("FAIL")).toBe(1);
  });
  it("strict mode also fails on an unverifiable UNKNOWN overall", () => {
    expect(exitCodeFor("UNKNOWN", { strict: true })).toBe(1);
    expect(exitCodeFor("WARNING", { strict: true })).toBe(0);
    expect(exitCodeFor("PASS", { strict: true })).toBe(0);
  });
});

describe("redactSecrets — no secrets ever reach the browser/terminal", () => {
  it("scrubs postgres connection strings", () => {
    expect(redactSecrets("connect failed postgres://erp:hunter2@care-db:5432/diagnostic_erp"))
      .not.toMatch(/hunter2/);
    expect(redactSecrets("postgresql://a:b@h/d")).toContain("***redacted***");
  });
  it("scrubs password/secret/apiKey/token key=value pairs", () => {
    expect(redactSecrets("ORTHANC_PASSWORD=s3cr3t here")).not.toContain("s3cr3t");
    expect(redactSecrets("api_key: ABC123XYZ")).not.toContain("ABC123XYZ");
    expect(redactSecrets("token=deadbeef")).toContain("***redacted***");
  });
  it("scrubs Bearer and Basic auth headers", () => {
    expect(redactSecrets("Authorization: Bearer eyJhbGciOi.J9.sig")).not.toContain("eyJhbGciOi");
    expect(redactSecrets("Basic ZXJwOmNoYW5nZW1l")).not.toContain("ZXJwOmNoYW5nZW1l");
  });
  it("scrubs inline user:pass@host credentials but keeps the host", () => {
    const out = redactSecrets("http://admin:topsecret@172.16.1.139:8042/system");
    expect(out).not.toContain("topsecret");
    expect(out).toContain("172.16.1.139");
  });
  it("leaves ordinary text untouched", () => {
    expect(redactSecrets("Orthanc reachable (34ms), version 1.12.4")).toBe("Orthanc reachable (34ms), version 1.12.4");
  });
});

describe("safeError — message only, never a stack", () => {
  it("returns a scrubbed, bounded message", () => {
    const err = new Error("connect ECONNREFUSED postgres://erp:pw@db:5432/x");
    const msg = safeError(err);
    expect(msg).not.toContain("pw@");
    expect(msg).not.toContain("\n    at "); // no stack frames
  });
  it("handles non-Error throwables", () => {
    expect(safeError("plain string boom")).toBe("plain string boom");
  });
});

describe("redactMetadata — nested string scrubbing", () => {
  it("scrubs strings one level deep, leaves numbers/booleans", () => {
    const meta = redactMetadata({ url: "postgres://a:b@h/d", latencyMs: 12, ok: true, nested: { token: "token=abc" } });
    expect(meta!.url).toContain("***redacted***");
    expect(meta!.latencyMs).toBe(12);
    expect(meta!.ok).toBe(true);
    expect((meta!.nested as Record<string, unknown>).token).toContain("***redacted***");
  });
});

// ── runner ──────────────────────────────────────────────────────────────────
const RUN_OPTS = { includeOptional: true, timeoutMs: 200, now: NOW };

describe("runOneCheck — timing, isolation, redaction, skip", () => {
  it("wraps a passing check with id/name/category/timing", async () => {
    const def: OpsCheckDef<null> = {
      id: "api", name: "API Health", category: "application", required: true,
      run: async () => ({ status: "PASS", message: "responding" }),
    };
    const c = await runOneCheck(def, null, RUN_OPTS);
    expect(c.status).toBe("PASS");
    expect(c.id).toBe("api");
    expect(c.name).toBe("API Health");
    expect(c.checkedAt).toBe(NOW.toISOString());
    expect(c.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("a thrown error becomes UNKNOWN with a safe message — never propagates", async () => {
    const def: OpsCheckDef<null> = {
      id: "db", name: "DB", category: "database", required: true,
      run: async () => { throw new Error("boom postgres://u:p@h/d"); },
    };
    const c = await runOneCheck(def, null, RUN_OPTS);
    expect(c.status).toBe("UNKNOWN");
    expect(c.message).not.toContain("p@h");
  });

  it("scrubs secrets that a check accidentally puts in its message/metadata", async () => {
    const def: OpsCheckDef<null> = {
      id: "leak", name: "Leaky", category: "application", required: false,
      run: async () => ({ status: "PASS", message: "ok token=SECRETVAL", metadata: { conn: "postgres://a:b@h/d" } }),
    };
    const c = await runOneCheck(def, null, RUN_OPTS);
    expect(c.message).not.toContain("SECRETVAL");
    expect(c.metadata!.conn).toContain("***redacted***");
  });

  it("an optional check is SKIPPED when includeOptional is false", async () => {
    const def: OpsCheckDef<null> = {
      id: "opt", name: "Optional", category: "integrations", required: false, optional: true,
      run: async () => ({ status: "PASS", message: "should not run" }),
    };
    const c = await runOneCheck(def, null, { ...RUN_OPTS, includeOptional: false });
    expect(c.status).toBe("SKIPPED");
    expect(c.message).toMatch(/optional check skipped/);
  });

  it("a hung check is bounded by the timeout → UNKNOWN", async () => {
    const def: OpsCheckDef<null> = {
      id: "slow", name: "Slow", category: "radiology_pacs", required: true,
      run: () => new Promise((resolve) => setTimeout(() => resolve({ status: "PASS", message: "late" }), 5000)),
    };
    const c = await runOneCheck(def, null, { ...RUN_OPTS, timeoutMs: 50 });
    expect(c.status).toBe("UNKNOWN");
    expect(c.message).toMatch(/timed out/);
  });
});

describe("runAllChecks — order preserved, one bad check can't sink the rest", () => {
  it("runs every def and keeps definition order", async () => {
    const defs: Array<OpsCheckDef<null>> = [
      { id: "a", name: "A", category: "application", required: true, run: async () => ({ status: "PASS", message: "" }) },
      { id: "b", name: "B", category: "database", required: true, run: async () => { throw new Error("x"); } },
      { id: "c", name: "C", category: "integrations", required: false, optional: true, run: async () => ({ status: "PASS", message: "" }) },
    ];
    const checks = await runAllChecks(defs, null, { ...RUN_OPTS, includeOptional: false });
    expect(checks.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(checks[0].status).toBe("PASS");
    expect(checks[1].status).toBe("UNKNOWN"); // threw
    expect(checks[2].status).toBe("SKIPPED"); // optional, excluded
    expect(aggregateOverall(checks)).toBe("UNKNOWN"); // required b unknown
  });
});
