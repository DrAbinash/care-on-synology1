import { describe, expect, test } from "vitest";
import {
  APPROVED_DEV_DATABASE,
  BLOCKED_STARTUP_STEPS,
  DEV_API_HOST,
  DEV_API_PORT,
  DEV_EGRESS_ALLOW_ENV,
  DEV_DATABASE_URL_ENV,
  DEV_API_PORT_ENV,
  approvedDatabaseTarget,
  decideStartupStep,
  describeIsolation,
  evaluateDatabaseUrl,
  evaluateEgress,
  isIsolated,
  isLoopbackHost,
  parseDatabaseUrl,
  parseEgressAllowlist,
  resolveListenConfig,
} from "./devIsolation";

const ISOLATED = { CARE_DEV_ISOLATED: "1" };

describe("CARE_DEV_ISOLATED flag parsing", () => {
  test.each(["1", "true", "TRUE", "yes", "on", " 1 "])("treats %j as enabled", (raw) => {
    expect(isIsolated({ CARE_DEV_ISOLATED: raw })).toBe(true);
  });

  test.each([undefined, "", "0", "false", "no", "off", "1x", "enabled"])(
    "treats %j as disabled — production behaviour",
    (raw) => {
      expect(isIsolated({ CARE_DEV_ISOLATED: raw })).toBe(false);
    },
  );

  test("an absent variable is not isolated", () => {
    expect(isIsolated({})).toBe(false);
  });
});

describe("startup step registry", () => {
  /**
   * The names the owner's brief enumerates. If one of these is ever dropped from the
   * registry, isolated mode stops suppressing it silently — which is the exact failure
   * this file exists to prevent, so it is pinned rather than trusted.
   */
  test.each([
    "cronScheduler",
    "integrationScheduler",
    "dicomPullAgent",
    "orthancChangesPoller",
    "mriStudyWarmer",
    "missingStudyReconciliation",
    "radiologyJobConsumer",
    "aiReportComposeJobConsumer",
    "hopeIntegrationBootstrap",
    "startupMigrations",
    "pacsSettingsSeed",
    "pluginLoaderUsbScan",
  ])("suppresses %s", (step) => {
    expect(Object.keys(BLOCKED_STARTUP_STEPS)).toContain(step);
    expect(decideStartupStep(step, ISOLATED)).toEqual({ run: false, step, reason: expect.any(String) });
  });

  test("every registered step explains itself", () => {
    for (const [step, reason] of Object.entries(BLOCKED_STARTUP_STEPS)) {
      expect(reason.length, `${step} has no reason`).toBeGreaterThan(10);
    }
  });

  test("an unregistered step throws instead of defaulting to allowed", () => {
    expect(() => decideStartupStep("someNewConsumer", ISOLATED)).toThrow(/someNewConsumer/);
    expect(() => decideStartupStep("someNewConsumer", ISOLATED)).toThrow(/BLOCKED_STARTUP_STEPS/);
    // Unregistered names are refused whether or not the flag is set: the registry is
    // the contract, not a conditional.
    expect(() => decideStartupStep("someNewConsumer", {})).toThrow(/someNewConsumer/);
  });

  test("when isolation is off, registered steps run", () => {
    for (const step of Object.keys(BLOCKED_STARTUP_STEPS)) {
      expect(decideStartupStep(step, {}).run, `${step} should run when not isolated`).toBe(true);
    }
  });
});

describe("isLoopbackHost", () => {
  test.each(["127.0.0.1", "127.9.9.9", "localhost", "LOCALHOST", "::1", "[::1]", "localhost."])(
    "%s is loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  test.each(["172.16.1.139", "192.168.1.137", "10.0.0.5", "100.65.255.115", "8.8.8.8", "caredeoghar.com", "169.254.169.254", ""])(
    "%s is not loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe("egress decisions", () => {
  test("isolation off permits everything (production unchanged)", () => {
    expect(evaluateEgress({ host: "172.16.1.139", port: 8042 }, {}).allowed).toBe(true);
    expect(evaluateEgress({ host: "graph.facebook.com", port: 443 }, {}).allowed).toBe(true);
  });

  test("the clinic's production LAN archive is refused, including the baked default", () => {
    for (const host of ["172.16.1.139", "192.168.1.137", "100.65.255.115", "ohif.caredeoghar.com"]) {
      const decision = evaluateEgress({ host, port: 8042 }, ISOLATED);
      expect(decision.allowed, `${host} must be refused`).toBe(false);
      expect(decision.reason).toContain(host);
    }
  });

  test("loopback development services are allowed with no configuration", () => {
    expect(evaluateEgress({ host: "127.0.0.1", port: APPROVED_DEV_DATABASE.port }, ISOLATED).allowed).toBe(true);
    expect(evaluateEgress({ host: "127.0.0.1", port: DEV_API_PORT }, ISOLATED).allowed).toBe(true);
    expect(evaluateEgress({ host: "localhost", port: 11434 }, ISOLATED).allowed).toBe(true);
    expect(evaluateEgress({ host: "::1", port: 8042 }, ISOLATED).allowed).toBe(true);
  });

  test("an explicitly allowlisted development service is permitted", () => {
    const env = { ...ISOLATED, [DEV_EGRESS_ALLOW_ENV]: "192.168.1.50, orthanc.dev:8042" };
    expect(evaluateEgress({ host: "192.168.1.50", port: 9999 }, env).allowed).toBe(true);
    expect(evaluateEgress({ host: "orthanc.dev", port: 8042 }, env).allowed).toBe(true);
    expect(evaluateEgress({ host: "orthanc.dev", port: 8043 }, env).allowed).toBe(false);
    expect(evaluateEgress({ host: "notlisted.dev", port: 8042 }, env).allowed).toBe(false);
  });

  test("cloud metadata endpoints are refused even when allowlisted", () => {
    const env = { ...ISOLATED, [DEV_EGRESS_ALLOW_ENV]: "169.254.169.254" };
    expect(evaluateEgress({ host: "169.254.169.254", port: 80 }, env).allowed).toBe(false);
  });

  test("a destination with no host is refused rather than guessed", () => {
    expect(evaluateEgress({ host: "", port: 443 }, ISOLATED).allowed).toBe(false);
  });

  test("parseEgressAllowlist accepts the documented forms", () => {
    expect(parseEgressAllowlist(undefined)).toEqual([]);
    expect(parseEgressAllowlist("  ")).toEqual([]);
    expect(parseEgressAllowlist("a.local")).toEqual([{ host: "a.local", port: null }]);
    expect(parseEgressAllowlist("a.local:8042,b.local 10.1.1.1:80")).toEqual([
      { host: "a.local", port: 8042 },
      { host: "b.local", port: null },
      { host: "10.1.1.1", port: 80 },
    ]);
    expect(parseEgressAllowlist("[fd00::2]:8042")).toEqual([{ host: "fd00::2", port: 8042 }]);
  });
});

describe("database validation (fail closed)", () => {
  const approved = `postgresql://erp@127.0.0.1:${APPROVED_DEV_DATABASE.port}/${APPROVED_DEV_DATABASE.database}`;

  test("the approved development database is accepted", () => {
    expect(evaluateDatabaseUrl(approved, ISOLATED).allowed).toBe(true);
  });

  test("localhost is accepted as the same host as 127.0.0.1", () => {
    expect(evaluateDatabaseUrl(`postgresql://erp@localhost:5411/care_dev`, ISOLATED).allowed).toBe(true);
  });

  test("the production database is refused", () => {
    for (const url of [
      "postgresql://erp@172.16.1.139:5432/care_erp",
      "postgresql://care:pw@db.internal:5432/care_erp",
      `postgresql://erp@127.0.0.1:5432/care_dev`,
      `postgresql://erp@127.0.0.1:5411/postgres`,
      `postgresql://erp@127.0.0.1:5412/care_dev`,
    ]) {
      const decision = evaluateDatabaseUrl(url, ISOLATED);
      expect(decision.allowed, `${url} must be refused`).toBe(false);
      expect(decision.reason).toMatch(/[Rr]efusing to start/);
    }
  });

  test("an unset or unparseable DATABASE_URL is refused", () => {
    expect(evaluateDatabaseUrl(undefined, ISOLATED).allowed).toBe(false);
    expect(evaluateDatabaseUrl("", ISOLATED).allowed).toBe(false);
    expect(evaluateDatabaseUrl("not-a-url", ISOLATED).allowed).toBe(false);
    expect(evaluateDatabaseUrl("mysql://erp@127.0.0.1:5411/care_dev", ISOLATED).allowed).toBe(false);
  });

  test("when isolation is off nothing is checked", () => {
    expect(evaluateDatabaseUrl("postgresql://erp@172.16.1.139:5432/care_erp", {}).allowed).toBe(true);
  });

  test("the override exists for another machine but cannot escape loopback", () => {
    expect(approvedDatabaseTarget(ISOLATED)).toEqual(APPROVED_DEV_DATABASE);
    expect(
      approvedDatabaseTarget({ ...ISOLATED, [DEV_DATABASE_URL_ENV]: "postgresql://erp@127.0.0.1:6001/care_other" }),
    ).toEqual({ host: "127.0.0.1", port: 6001, database: "care_other" });
    const escaped = approvedDatabaseTarget({
      ...ISOLATED,
      [DEV_DATABASE_URL_ENV]: "postgresql://erp@172.16.1.139:5432/care_erp",
    });
    expect("error" in escaped ? escaped.error : "").toMatch(/loopback/);
    expect(evaluateDatabaseUrl(approved, { ...ISOLATED, [DEV_DATABASE_URL_ENV]: "postgresql://erp@172.16.1.139:5432/care_erp" }).allowed).toBe(false);
  });

  test("parseDatabaseUrl reads host, port and database", () => {
    expect(parseDatabaseUrl("postgresql://erp@127.0.0.1:5411/care_dev")).toEqual({ host: "127.0.0.1", port: 5411, database: "care_dev" });
    expect(parseDatabaseUrl("postgres://erp@localhost/mydb")).toEqual({ host: "localhost", port: 5432, database: "mydb" });
    expect(parseDatabaseUrl("postgresql://u%40x:p%20ss@127.0.0.1:5411/care_dev?schema=public")).toEqual({
      host: "127.0.0.1",
      port: 5411,
      database: "care_dev",
    });
    expect(parseDatabaseUrl("postgresql://erp@127.0.0.1:5411")).toMatchObject({ error: expect.any(String) });
    expect(parseDatabaseUrl("http://127.0.0.1/care_dev")).toMatchObject({ error: expect.stringMatching(/scheme/) });
  });
});

describe("listen configuration", () => {
  test("unisolated keeps the existing behaviour: PORT from env, host left to Node", () => {
    expect(resolveListenConfig({ PORT: "8080" })).toEqual({ port: 8080 });
    expect(resolveListenConfig({})).toEqual({ port: 8080 });
    expect(resolveListenConfig({ PORT: "abc" })).toEqual({ port: 8080 });
    expect(resolveListenConfig({ PORT: "8080" })).not.toHaveProperty("host");
  });

  test("isolated binds loopback on 8181 and ignores PORT, which belongs to the emergency ERP", () => {
    expect(resolveListenConfig({ ...ISOLATED, PORT: "8080" })).toEqual({ host: DEV_API_HOST, port: DEV_API_PORT });
    expect(resolveListenConfig({ ...ISOLATED, HOST: "0.0.0.0" })).toEqual({ host: DEV_API_HOST, port: DEV_API_PORT });
  });

  test("the dev port can be moved deliberately, but never off loopback", () => {
    expect(resolveListenConfig({ ...ISOLATED, [DEV_API_PORT_ENV]: "8282" })).toEqual({ host: DEV_API_HOST, port: 8282 });
    expect(resolveListenConfig({ ...ISOLATED, [DEV_API_PORT_ENV]: "not-a-port" })).toEqual({ host: DEV_API_HOST, port: DEV_API_PORT });
  });
});

describe("describeIsolation", () => {
  test("off is stated plainly", () => {
    expect(describeIsolation({})).toMatch(/off/);
  });

  test("on reports the suppressed step count and the database it accepted", () => {
    const text = describeIsolation({ ...ISOLATED, DATABASE_URL: "postgresql://erp@127.0.0.1:5411/care_dev" });
    expect(text).toMatch(/ON/);
    expect(text).toContain(String(Object.keys(BLOCKED_STARTUP_STEPS).length));
    expect(text).toContain("care_dev");
  });

  test("on says so when the database is not the approved one", () => {
    const text = describeIsolation({ ...ISOLATED, [DEV_DATABASE_URL_ENV]: "postgresql://erp@172.16.1.139:5432/care_erp" });
    expect(text).toMatch(/INVALID/);
  });
});
