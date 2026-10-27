// ============================================================================
// PR-I11A — the credential posture probe.
//
// Its whole purpose is to answer "are we running a burned key, and do the two
// hosts agree?" without the operator ever putting a value on screen. So the
// binding test is not the verdict, it is that no output line contains one.
// ============================================================================
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { PAIRS, auditPair, describeCredential, main } from "./integration-credential-posture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "integration-credential-posture.mjs");

const digestOf = (v) => createHash("sha256").update(v).digest("hex");

const KEY_A = `intgk_${"1".repeat(64)}`;
const KEY_B = `intgk_${"2".repeat(64)}`;
const SECRET_A = "a".repeat(64);
const SECRET_B = "b".repeat(64);

const dir = mkdtempSync(join(tmpdir(), "i11a-posture-"));
const envFile = (name, lines) => {
  const p = join(dir, name);
  writeFileSync(p, lines.join("\n"), "utf8");
  return p;
};

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("describeCredential", () => {
  test("reports shape, never the value", () => {
    const c = describeCredential("HOPE_PARTNER_KEY", KEY_A);
    expect(c).toMatchObject({ name: "HOPE_PARTNER_KEY", set: true, length: 70, published: false });
    expect(c.digestPrefix).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(c)).not.toContain(KEY_A);
  });

  test("an unset variable is reported as unset, not as a zero-length secret", () => {
    const c = describeCredential("HOPE_PARTNER_KEY", undefined);
    expect(c.set).toBe(false);
    expect(c.digestPrefix).toBeNull();
    expect(c.published).toBe(false);
  });

  test("a value whose digest is in the published list is flagged, an unknown one is not", () => {
    const burned = `intgk_${"9".repeat(64)}`;
    const published = [{ digest: digestOf(burned), label: "synthetic published key" }];
    expect(describeCredential("HOPE_PARTNER_KEY", burned, published).published).toBe(true);
    expect(describeCredential("HOPE_PARTNER_KEY", KEY_A, published).published).toBe(false);
    expect(describeCredential("HOPE_PARTNER_KEY", "abc", published).published).toBe(false);
  });

  test("reuses the deploy gate's weakness rule so the two can never disagree", () => {
    expect(describeCredential("HOPE_PARTNER_KEY", "changeme").weak).toMatch(/placeholder/);
    expect(describeCredential("HOPE_PARTNER_KEY", KEY_A).weak).toBeNull();
    expect(describeCredential("HOPE_PARTNER_KEY", undefined).weak).toBeNull();
  });
});

describe("auditPair", () => {
  test("a shared value on both sides is a match", () => {
    const p = auditPair(PAIRS[0], { HOPE_PARTNER_KEY: KEY_A }, { CARE_PARTNER_KEY: KEY_A }, []);
    expect(p.match).toBe(true);
    expect(p.rotateRequired).toBe(false);
  });

  test("a value rotated on one side only is a mismatch, and says what that breaks", () => {
    const p = auditPair(PAIRS[0], { HOPE_PARTNER_KEY: KEY_A }, { CARE_PARTNER_KEY: KEY_B }, []);
    expect(p.match).toBe(false);
    expect(p.mismatchSymptom).toMatch(/401/);
  });

  test("an unset side is never reported as a match", () => {
    expect(auditPair(PAIRS[0], { HOPE_PARTNER_KEY: KEY_A }, {}, []).match).toBe(false);
    expect(auditPair(PAIRS[0], {}, {}, []).match).toBe(false);
  });

  test("a published value on either side demands rotation even when the pair matches", () => {
    const burned = `intgk_${"8".repeat(64)}`;
    const published = [{ digest: digestOf(burned), label: "synthetic published key" }];
    const p = auditPair(PAIRS[0], { HOPE_PARTNER_KEY: burned }, { CARE_PARTNER_KEY: burned }, published);
    expect(p.match).toBe(true);
    expect(p.rotateRequired).toBe(true);
  });
});

describe("the pairs the clinic must keep in step", () => {
  test("name both hosts' variables for each direction", () => {
    expect(PAIRS.map((p) => [p.care, p.hope])).toEqual([
      ["HOPE_PARTNER_KEY", "CARE_PARTNER_KEY"],
      ["INTEGRATION_HOPE_SIGNING_SECRET", "CARE_CALLBACK_SECRET"],
    ]);
  });
});

describe("the CLI", () => {
  test("returns 0 for a host whose pair is configured and identical", () => {
    const care = envFile("care.env", [`HOPE_PARTNER_KEY=${KEY_A}`, `INTEGRATION_HOPE_SIGNING_SECRET=${SECRET_A}`]);
    const hope = envFile("hope.env", [`CARE_PARTNER_KEY=${KEY_A}`, `CARE_CALLBACK_SECRET=${SECRET_A}`]);
    expect(main(["--care-file", care, "--hope-file", hope])).toBe(0);
  });

  test("returns 1 when only one host was rotated", () => {
    const care = envFile("care2.env", [`HOPE_PARTNER_KEY=${KEY_A}`, `INTEGRATION_HOPE_SIGNING_SECRET=${SECRET_A}`]);
    const hope = envFile("hope2.env", [`CARE_PARTNER_KEY=${KEY_A}`, `CARE_CALLBACK_SECRET=${SECRET_B}`]);
    expect(main(["--care-file", care, "--hope-file", hope])).toBe(1);
  });

  test("returns 2 when there is no CARE env file to read", () => {
    expect(main(["--care-file", join(dir, "does-not-exist.env")])).toBe(2);
  });

  test("prints no credential value on either side, in either verdict", () => {
    const marker = `intgk_${"e".repeat(64)}`;
    const care = envFile("care3.env", [`HOPE_PARTNER_KEY=${marker}`, "INTEGRATION_HOPE_SIGNING_SECRET="]);
    const hope = envFile("hope3.env", [`CARE_PARTNER_KEY=${marker}`, "CARE_CALLBACK_SECRET="]);
    const r = spawnSync(process.execPath, [SCRIPT, "--care-file", care, "--hope-file", hope], {
      encoding: "utf8",
      cwd: resolve(HERE, ".."),
    });
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toContain("NOT SET");
    expect(out).not.toContain(marker);
    expect(out).not.toContain(marker.slice(0, 20));
    expect(out).not.toMatch(/[0-9a-f]{40,}/);
    // And a probe that rewrites the file it reads would be a worse bug than the one
    // it reports, so the input is checked untouched.
    expect(readFileSync(care, "utf8")).toContain(marker);
  });

  test("names a published value as disclosed, using the injected digest list", () => {
    // The CLI always compares against the real committed digests; the same code
    // path is driven here with a synthetic list so the fixture never holds a real
    // credential.
    const burned = `intgk_${"3".repeat(64)}`;
    const care = envFile("care4.env", [`HOPE_PARTNER_KEY=${burned}`, `INTEGRATION_HOPE_SIGNING_SECRET=${SECRET_A}`]);
    const hope = envFile("hope4.env", [`CARE_PARTNER_KEY=${burned}`, `CARE_CALLBACK_SECRET=${SECRET_A}`]);
    const lines = [];
    const log = console.log;
    console.log = (s) => lines.push(String(s));
    const code = main(
      ["--care-file", care, "--hope-file", hope],
      { published: [{ digest: digestOf(burned), label: "synthetic published key" }] },
    );
    console.log = log;
    expect(code).toBe(1);
    expect(lines.join("\n")).toMatch(/PUBLISHED-IN-GIT/);
    expect(lines.join("\n")).toMatch(/VERDICT: rotate/);
    expect(lines.join("\n")).not.toContain(burned);
  });
});
