// ============================================================================
// PR-I11A — the HOPE partner credential, against a REAL PostgreSQL.
//
// The unit tests can prove a helper returns a reason; only a database can prove
// what actually lands in `integration_partners.key_hash` when a container starts
// without HOPE_PARTNER_KEY. That is the whole defect: this file's predecessor
// wrote the SHA-256 of a key published in a public GitHub repository into the
// live partner row on every boot, and re-wrote it there whenever an operator
// tried anything else.
//
// Synthetic keys only, marker-scoped rows, deleted after every test. The partner
// HTTP surface is not mocked where it can be avoided: test D7 drives CARE's own
// `requireIntegrationPartnerAuth` middleware over the row the bootstrap created.
// ============================================================================
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = !!DATABASE_URL;
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });

const sha256hex = (v: string) => createHash("sha256").update(v).digest("hex");

/** Shaped like generateIntegrationKey(): `intgk_` + 64 hex. */
const keyA = `intgk_${"a".repeat(64)}`;
const keyB = `intgk_${"b".repeat(64)}`;

interface PartnerRow {
  id: number;
  code: string;
  key_hash: string | null;
  key_prefix: string | null;
  is_active: boolean;
  permissions: string[];
  callback_url: string | null;
}

async function readPartner(): Promise<PartnerRow | null> {
  const r = await pool.query(
    `select id, code, key_hash, key_prefix, is_active, permissions, callback_url
       from integration_partners where code = 'HOPE' limit 1`,
  );
  return (r.rows[0] as PartnerRow) ?? null;
}

async function readFlag(): Promise<string | null> {
  const r = await pool.query(`select enabled::text as e from feature_flags where key = 'ff_hope_care_referrals' limit 1`);
  return (r.rows[0]?.e as string) ?? null;
}

async function purge() {
  await pool.query(`delete from integration_partner_audit_log where partner_code = 'HOPE'`);
  await pool.query(`delete from integration_partners where code = 'HOPE'`);
  await pool.query(`delete from feature_flags where key = 'ff_hope_care_referrals'`);
}

type Bootstrap = typeof import("./bootstrapHopeCareIntegration");
let bootstrap: Bootstrap;

beforeAll(async () => {
  if (!hasDb) return;
  bootstrap = await import("./bootstrapHopeCareIntegration");
  await purge();
});

afterEach(async () => {
  if (!hasDb) return;
  await purge();
});

afterAll(async () => {
  if (!hasDb) return;
  await purge();
  await pool.end();
});

describe.skipIf(!hasDb)("bootstrapHopeCareIntegration on a real database", () => {
  test("D1 registers the partner from the environment key and enables the flag", async () => {
    const result = await bootstrap.bootstrapHopeCareIntegration({
      HOPE_PARTNER_KEY: keyA,
      INTEGRATION_HOPE_CALLBACK_URL: "http://hope.internal:7080/api/integration/care-callback",
    });

    expect(result).toEqual({ skipped: false, partnerAction: "created", flagEnabled: true });

    const row = await readPartner();
    if (!row) throw new Error("D1 registered no HOPE partner row");
    expect(row.key_hash).toBe(sha256hex(keyA));
    expect(row.key_prefix).toBe(keyA.slice(0, 14));
    expect(row.is_active).toBe(true);
    expect(row.callback_url).toBe("http://hope.internal:7080/api/integration/care-callback");
    expect([...row.permissions].sort()).toEqual([...bootstrap.HOPE_INTEGRATION_PERMISSIONS].sort());
    expect(await readFlag()).toBe("true");
  });

  test("D2 an environment key change is reconciled, so the documented rotation works", async () => {
    await bootstrap.bootstrapHopeCareIntegration({ HOPE_PARTNER_KEY: keyA });
    const created = await readPartner();
    expect(created?.key_hash).toBe(sha256hex(keyA));

    const second = await bootstrap.bootstrapHopeCareIntegration({ HOPE_PARTNER_KEY: keyB });
    expect(second).toEqual({ skipped: false, partnerAction: "updated", flagEnabled: true });

    const updated = await readPartner();
    expect(updated?.key_hash).toBe(sha256hex(keyB));
    expect(updated?.id).toBe(created?.id); // one row per partner code, no duplicates
  });

  test("D3 an unconfigured boot leaves the stored credential exactly as it was", async () => {
    await bootstrap.bootstrapHopeCareIntegration({ HOPE_PARTNER_KEY: keyA });
    const before = await readPartner();
    expect(before?.key_hash).toBe(sha256hex(keyA));

    // Armed only by the flag the Synology templates commit — no key in the env.
    const result = await bootstrap.bootstrapHopeCareIntegration({ HOPE_CARE_INTEGRATION_FORCE: "1" });

    expect(result.skipped).toBe(true);
    if (result.skipped) expect(result.reason).toMatch(/HOPE_PARTNER_KEY/);
    const after = await readPartner();
    expect(after?.key_hash).toBe(sha256hex(keyA));
    expect(after?.key_prefix).toBe(before?.key_prefix);
  });

  test("D4 a blank key is the same refusal, not a rewrite", async () => {
    await bootstrap.bootstrapHopeCareIntegration({ HOPE_PARTNER_KEY: keyA });
    const before = await readPartner();

    const result = await bootstrap.bootstrapHopeCareIntegration({
      HOPE_CARE_INTEGRATION_FORCE: "1",
      HOPE_PARTNER_KEY: "   ",
    });

    expect(result.skipped).toBe(true);
    expect((await readPartner())?.key_hash).toBe(before?.key_hash);
  });

  test("D5 a host with no Hope env at all registers nothing", async () => {
    const result = await bootstrap.bootstrapHopeCareIntegration({ PATH: "/usr/bin" });
    expect(result.skipped).toBe(true);
    expect(await readPartner()).toBeNull();
    expect(await readFlag()).toBeNull();
  });

  test("D6 a key too short to be an issued one registers nothing", async () => {
    const result = await bootstrap.bootstrapHopeCareIntegration({
      HOPE_CARE_INTEGRATION_FORCE: "1",
      HOPE_PARTNER_KEY: "intgk_short",
    });
    expect(result.skipped).toBe(true);
    if (result.skipped) expect(result.reason).toMatch(/characters/);
    expect(await readPartner()).toBeNull();
    expect(await readFlag()).toBeNull();
  });

  test("D7 the bootstrapped credential authenticates through the real middleware", async () => {
    await bootstrap.bootstrapHopeCareIntegration({ HOPE_PARTNER_KEY: keyA });

    const { requireIntegrationPartnerAuth } = await import("../middleware/requireIntegrationPartnerAuth");

    const call = async (bearer: string) => {
      const res: { status?: number; body?: unknown } = {};
      const fakeRes = {
        status(code: number) { res.status = code; return this; },
        json(body: unknown) { res.body = body; return this; },
      } as unknown as import("express").Response;
      let passedThrough = false;
      await requireIntegrationPartnerAuth("diagnostic_referral:read")(
        {
          method: "GET",
          path: "/api/integration/v1/referrals",
          headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
          socket: { remoteAddress: "127.0.0.1" },
        } as unknown as import("express").Request,
        fakeRes,
        () => { passedThrough = true; },
      );
      return { status: res.status, passedThrough };
    };

    expect(await call(keyA)).toEqual({ status: undefined, passedThrough: true });
    expect(await call(keyB)).toEqual({ status: 401, passedThrough: false });
    expect(await call("")).toEqual({ status: 401, passedThrough: false });
  });
});
