/**
 * The auto-retention switch cannot start a purge by itself.
 *
 * `care-orthanc-retention` reads this endpoint every 300 s and deletes Orthanc
 * studies until `keepStudies` remain, ordered by Orthanc ARRIVAL time rather than
 * StudyDate. Measured on the live archive (2026-11-14): 6,634 studies, and no
 * `orthanc_retention_keep_studies` / `orthanc_retention_cleanup_trigger` row in
 * `pacs_settings` at all — the endpoint's own defaults were 500 and 520. So the
 * previous behaviour was that one switch flip, with no number ever entered by
 * anyone, sentenced 6,134 studies to deletion on the next cycle, and which 6,134
 * was decided by arrival order rather than by anybody's clinical judgement.
 *
 * There was also no test on this endpoint at all. These cases are the first.
 *
 * What is asserted is the response the sidecar actually consumes, not the code
 * path: `enabled` false AND the two numbers zero, because a sidecar that reads a
 * usable `keepStudies` while believing itself disabled has the same gun loaded.
 * The failure is only prevented if the endpoint offers nothing to act on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { pacsSettingsTable } from "@workspace/db/schema";
import { hasDatabaseUrl } from "../testSupport/apiTestApp";

const maybe = hasDatabaseUrl() ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const INTERNAL_KEY = `vitest-retention-${RUN}-${randomUUID()}`;

const KEY_ENABLED = "orthanc_auto_retention_enabled";
const KEY_KEEP = "orthanc_retention_keep_studies";
const KEY_TRIGGER = "orthanc_retention_cleanup_trigger";
const ALL_KEYS = [KEY_ENABLED, KEY_KEEP, KEY_TRIGGER];

let app: Awaited<ReturnType<typeof import("../testSupport/apiTestApp").createTestApp>>;

// These three rows are shared settings, not this suite's property: a suite that
// lands afterwards on the same database must find them exactly as it left them.
type Backup = { key: string; value: string | null; category: string };
let backup: Backup[] = [];

async function writeSetting(key: string, value: string): Promise<void> {
  await db.delete(pacsSettingsTable).where(eq(pacsSettingsTable.key, key));
  await db
    .insert(pacsSettingsTable)
    .values({ key, value, category: "orthanc", isSecret: false });
}

async function readPolicy() {
  return request(app)
    .get("/api/internal/radiology/retention-policy")
    .set("Authorization", `Bearer ${INTERNAL_KEY}`);
}

maybe("GET /api/internal/radiology/retention-policy — fail closed", () => {
  const savedApiKey = process.env.INTERNAL_API_KEY;

  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = INTERNAL_KEY;
    backup = await db
      .select({ key: pacsSettingsTable.key, value: pacsSettingsTable.value, category: pacsSettingsTable.category })
      .from(pacsSettingsTable)
      .where(inArray(pacsSettingsTable.key, ALL_KEYS));
    await db.delete(pacsSettingsTable).where(inArray(pacsSettingsTable.key, ALL_KEYS));
    const { createTestApp } = await import("../testSupport/apiTestApp");
    app = await createTestApp();
  });

  afterAll(async () => {
    await db.delete(pacsSettingsTable).where(inArray(pacsSettingsTable.key, ALL_KEYS));
    if (backup.length) {
      await db.insert(pacsSettingsTable).values(
        backup.map((b) => ({ key: b.key, value: b.value, category: b.category, isSecret: false })),
      );
    }
    process.env.INTERNAL_API_KEY = savedApiKey;
  });

  it("refuses to arm when only the switch exists", async () => {
    // The exact live state: toggle on, both numbers never written.
    await writeSetting(KEY_ENABLED, "true");

    const res = await readPolicy();
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.policyConfigured).toBe(false);
    // Not 500/520. A number the sidecar could obey is the payload of the defect.
    expect(res.body.keepStudies).toBe(0);
    expect(res.body.cleanupTrigger).toBe(0);
  });

  it("refuses when the trigger does not sit above the keep count", async () => {
    // keep=2000 trigger=2000 would make the sidecar's own clamp invent a trigger,
    // i.e. delete on a policy nobody wrote the second half of.
    await writeSetting(KEY_ENABLED, "true");
    await writeSetting(KEY_KEEP, "2000");
    await writeSetting(KEY_TRIGGER, "2000");

    const res = await readPolicy();
    expect(res.body.enabled).toBe(false);
    expect(res.body.policyConfigured).toBe(false);
    expect(res.body.keepStudies).toBe(0);
  });

  it("refuses on a non-numeric value instead of coercing one", async () => {
    // `Number("1000 ")` and `Number("1e2")` both produce a number; the sidecar's
    // integer check is what keeps `keep="all"` from becoming `keep=NaN`.
    await writeSetting(KEY_ENABLED, "true");
    await writeSetting(KEY_KEEP, "all");
    await writeSetting(KEY_TRIGGER, "5000");

    const res = await readPolicy();
    expect(res.body.enabled).toBe(false);
    expect(res.body.policyConfigured).toBe(false);
  });

  it("arms when both numbers are written and the switch is on", async () => {
    await writeSetting(KEY_ENABLED, "true");
    await writeSetting(KEY_KEEP, "1200");
    await writeSetting(KEY_TRIGGER, "1400");

    const res = await readPolicy();
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.policyConfigured).toBe(true);
    expect(res.body.keepStudies).toBe(1200);
    expect(res.body.cleanupTrigger).toBe(1400);
  });

  it("reports the numbers as configured while staying off when the switch is off", async () => {
    // The settings page has to be able to tell "configured but disabled" apart
    // from "unconfigured", otherwise the admin UI cannot explain its own lock.
    await writeSetting(KEY_ENABLED, "false");
    await writeSetting(KEY_KEEP, "1200");
    await writeSetting(KEY_TRIGGER, "1400");

    const res = await readPolicy();
    expect(res.body.enabled).toBe(false);
    expect(res.body.policyConfigured).toBe(true);
    expect(res.body.keepStudies).toBe(1200);
  });
});
