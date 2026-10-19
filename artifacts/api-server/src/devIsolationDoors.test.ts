import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * The doors that the fetch and http-agent guards cannot cover, because they are not
 * HTTP: SMTP (`nodemailer` opens its own socket), DICOM DIMSE (raw TCP), and the two
 * queue dispatchers (whose damage is not the send but the state they write while
 * pretending to send).
 *
 * These are run against a DATABASE_URL pointing at a CLOSED loopback port. So if a
 * function reached the database at all, it would reject or hang instead of returning
 * the empty summary — returning promptly is itself the proof that nothing was
 * claimed, counted, failed or dead-lettered.
 */
const WATCHED_KEYS = ["CARE_DEV_ISOLATED", "DATABASE_URL"] as const;
const originalEnv: Record<string, string | undefined> = {};
for (const key of WATCHED_KEYS) originalEnv[key] = process.env[key];

const ISOLATED = {
  CARE_DEV_ISOLATED: "1",
  DATABASE_URL: "postgresql://erp@127.0.0.1:59998/care_dev",
};

function useIsolatedEnv(): void {
  Object.assign(process.env, ISOLATED);
}

function restoreEnv(): void {
  for (const key of WATCHED_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeAll(useIsolatedEnv);
afterAll(restoreEnv);

describe("integration outbox dispatch (partner callbacks)", () => {
  test("isolated mode returns an empty summary without claiming or POSTing", async () => {
    const { dispatchPendingOutbox } = await import("./services/integration/outbox");
    const summary = await dispatchPendingOutbox({ limit: 20 });
    expect(summary).toEqual({ claimed: 0, sent: 0, failed: 0, dead: 0, recovered: 0, conflicts: 0 });
  });
});

describe("WhatsApp outbox dispatch (patient-facing sends)", () => {
  test("isolated mode returns an empty summary without claiming or sending", async () => {
    const mod = await import("./services/whatsapp/WhatsAppOutbox");
    const summary = await mod.dispatchPendingWaOutbox({ limit: 20 });
    expect(summary).toMatchObject({ claimed: 0, sent: 0, failed: 0, dead: 0, suppressed: 0, recovered: 0, conflicts: 0 });
  });
});

describe("SMTP transport", () => {
  test("isolated mode builds no transport, so every sender takes its unavailable path", async () => {
    const { getTransporter } = await import("./email");
    expect(await getTransporter()).toBeNull();
  });
});

describe("DIMSE pull agent", () => {
  test("isolated mode does not start the poll loop", async () => {
    const mod = await import("./services/dicom-pull-agent/dimse-agent");
    expect(mod.isDimsePullAgentRunning()).toBe(false);
    mod.startDimsePullAgent();
    expect(mod.isDimsePullAgentRunning()).toBe(false);
  });

  test("isolated mode refuses a connectivity test instead of associating with a modality", async () => {
    const mod = await import("./services/dicom-pull-agent/dimse-agent");
    const result = await mod.testNodeConnection({ host: "198.51.100.7", port: 104, aeTitle: "ORTHANC", modality: "MR" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("CARE_DEV_ISOLATED");
  });
});

describe("the doors are inert when isolation is off", () => {
  test("without the flag the dispatcher goes past the guard into its real work", async () => {
    delete process.env.CARE_DEV_ISOLATED;
    const { dispatchPendingOutbox } = await import("./services/integration/outbox");
    // The database here is a closed loopback port, so the unguarded path can only
    // ever sit waiting on a connection or fail — what it must NOT do is come back
    // immediately with the isolated zero-summary. Racing a timer keeps this fast and
    // deterministic instead of depending on pg's 10-second connect timeout.
    const pending = Symbol("still-running");
    const attempted = dispatchPendingOutbox({ limit: 1 }).then(
      (s) => s,
      (err: unknown) => `reached-the-database: ${String((err as Error)?.message ?? err)}`,
    );
    const outcome = await Promise.race([
      attempted,
      new Promise((resolve) => setTimeout(() => resolve(pending), 250)),
    ]);
    // Either it is already talking to the database (rejection above) or it is still
    // trying — both are proof the guard did not short-circuit. The isolated answer
    // would have been the all-zero summary, returned synchronously.
    expect(outcome).not.toEqual({ claimed: 0, sent: 0, failed: 0, dead: 0, recovered: 0, conflicts: 0 });
    useIsolatedEnv();
  });
});
