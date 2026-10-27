// ============================================================================
// PR-I11A — deployment configuration validation.
//
// The gate that runs at deploy-synology.sh step 2c used to guard exactly three
// keys and to treat "not set" as acceptable, so the Hope ↔ Care pair — the two
// credentials that were committed to a PUBLIC repository — passed it in every
// shape: missing, weak, or the published value itself. These tests pin the four
// outcomes the clinic needs distinguished, and pin that the gate never prints a
// value while doing it.
//
// Synthetic credentials only. Nothing here contains a real key.
// ============================================================================
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  INTEGRATION_GUARDED,
  PUBLISHED_CREDENTIALS,
  auditEnvSecrets,
  checkSecretStrength,
  findPublishedMatch,
  isHopeIntegrationArmed,
  loadEnvFile,
} from "./check-env-secrets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "check-env-secrets.mjs");

const GOOD_PARTNER = `intgk_${"7d1f9c4b".repeat(8)}`; // 70 chars, not a published value
const GOOD_SIGNING = "e3b0c442".repeat(8); // 64 chars
const ARMED = { HOPE_CARE_INTEGRATION_FORCE: "1" };

const namesOf = (problems) => problems.map((p) => p.name).sort();
const problemFor = (problems, name) => problems.find((p) => p.name === name);

describe("isHopeIntegrationArmed", () => {
  test("a host that never mentions Hope is not armed", () => {
    expect(isHopeIntegrationArmed({})).toBe(false);
    expect(isHopeIntegrationArmed({ INTERNAL_API_KEY: GOOD_SIGNING })).toBe(false);
  });

  test("the committed templates arm it", () => {
    expect(isHopeIntegrationArmed({ ...ARMED })).toBe(true);
    expect(isHopeIntegrationArmed({ INTEGRATION_HOPE_CALLBACK_URL: "http://h:7080/cb" })).toBe(true);
    expect(isHopeIntegrationArmed({ HOPE_PARTNER_KEY: GOOD_PARTNER })).toBe(true);
  });
});

describe("auditEnvSecrets — the Hope pair", () => {
  test("armed with neither credential is a configuration failure", () => {
    const { problems } = auditEnvSecrets({ ...ARMED });
    expect(namesOf(problems)).toEqual(["HOPE_PARTNER_KEY", "INTEGRATION_HOPE_SIGNING_SECRET"]);
    for (const name of ["HOPE_PARTNER_KEY", "INTEGRATION_HOPE_SIGNING_SECRET"]) {
      expect(problemFor(problems, name).reason).toMatch(/not set while the Hope integration is armed/);
    }
  });

  test("armed with strong environment-provided credentials passes", () => {
    const { problems } = auditEnvSecrets({
      ...ARMED,
      HOPE_PARTNER_KEY: GOOD_PARTNER,
      INTEGRATION_HOPE_SIGNING_SECRET: GOOD_SIGNING,
    });
    expect(problems).toEqual([]);
  });

  test("not armed: the same missing pair is not a failure", () => {
    expect(auditEnvSecrets({ INTERNAL_API_KEY: GOOD_SIGNING }).problems).toEqual([]);
  });

  test("a truncated partner key is refused by length, not by match", () => {
    const { problems } = auditEnvSecrets({
      ...ARMED,
      HOPE_PARTNER_KEY: GOOD_PARTNER.slice(0, 20),
      INTEGRATION_HOPE_SIGNING_SECRET: GOOD_SIGNING,
    });
    expect(namesOf(problems)).toEqual(["HOPE_PARTNER_KEY"]);
    expect(problems[0].reason).toMatch(/only 20 characters/);
    expect(problems[0].exposed).toBeUndefined();
  });

  test("a placeholder partner key is refused as a placeholder, not as absent", () => {
    // Setting the variable at all is what arms the host, so this is the case where
    // the value — not its absence — is the problem.
    const { problems } = auditEnvSecrets({ HOPE_PARTNER_KEY: "changeme" });
    expect(namesOf(problems)).toEqual(["HOPE_PARTNER_KEY", "INTEGRATION_HOPE_SIGNING_SECRET"]);
    expect(problemFor(problems, "HOPE_PARTNER_KEY").reason).toMatch(/placeholder/);
    expect(problemFor(problems, "HOPE_PARTNER_KEY").exposed).toBeUndefined();
  });

  test("a value matching a published digest is reported as disclosed", () => {
    const burned = `intgk_${"ab".repeat(34)}`;
    const burnedDigest = createHash("sha256").update(burned).digest("hex");
    const published = [{ digest: burnedDigest, label: "synthetic published key" }];

    expect(findPublishedMatch(burned, published)).toEqual(published[0]);
    const { problems } = auditEnvSecrets(
      { ...ARMED, HOPE_PARTNER_KEY: burned, INTEGRATION_HOPE_SIGNING_SECRET: GOOD_SIGNING },
      { published },
    );
    expect(namesOf(problems)).toEqual(["HOPE_PARTNER_KEY"]);
    expect(problems[0].exposed).toBe(true);
    expect(problems[0].reason).toMatch(/this repository published/);
  });

  test("a strong credential that is merely unknown is not called published", () => {
    expect(findPublishedMatch(GOOD_PARTNER)).toBeNull();
  });

  test("the report never carries a secret value", () => {
    const { problems } = auditEnvSecrets({
      ...ARMED,
      HOPE_PARTNER_KEY: GOOD_PARTNER.slice(0, 20),
      INTEGRATION_HOPE_SIGNING_SECRET: "",
    });
    const rendered = JSON.stringify(problems);
    expect(rendered).not.toContain(GOOD_PARTNER.slice(0, 20));
    expect(rendered).not.toContain(GOOD_PARTNER);
  });

  test("each guarded credential tells the operator how to rotate it", () => {
    // Both sides of a pair must change together, so the note has to name the far
    // side's variable or the operator rotates one half and breaks the channel.
    for (const { name, note } of INTEGRATION_GUARDED) {
      expect(note, name).toMatch(/CARE_PARTNER_KEY|CARE_CALLBACK_SECRET/);
    }
    expect(INTEGRATION_GUARDED.map((g) => g.name)).toEqual([
      "HOPE_PARTNER_KEY",
      "INTEGRATION_HOPE_SIGNING_SECRET",
    ]);
  });
});

describe("auditEnvSecrets — the guards that already existed", () => {
  test("a weak INTERNAL_API_KEY still fails (the old gate is not weakened)", () => {
    const { problems } = auditEnvSecrets({ INTERNAL_API_KEY: "1234567890" });
    expect(namesOf(problems)).toContain("INTERNAL_API_KEY");
  });

  test("an unset INTERNAL_API_KEY is still tolerated (unchanged contract)", () => {
    expect(auditEnvSecrets({}).problems).toEqual([]);
  });

  test("checkSecretStrength keeps reporting an unset value as 'not set'", () => {
    expect(checkSecretStrength("")).toEqual({ reason: "not set" });
    expect(checkSecretStrength(undefined)).toEqual({ reason: "not set" });
    expect(checkSecretStrength(GOOD_SIGNING)).toBeNull();
  });
});

describe("the templates this repository ships", () => {
  // Red before the scrub, green after: `deploy-synology.sh` copies
  // deploy/synology/care.env to .env on a fresh host, so a credential written in
  // a template is a credential that reaches production. The gate must instead
  // refuse the deployment it produces.
  const TEMPLATES = [
    "deploy/synology/care.env",
    "deploy/synology/hope.env",
    ".env.example",
  ];

  test("contain no credential the repository has published", () => {
    for (const rel of TEMPLATES) {
      const env = loadEnvFile(resolve(HERE, "..", rel));
      for (const name of ["HOPE_PARTNER_KEY", "INTEGRATION_HOPE_SIGNING_SECRET", "CARE_PARTNER_KEY", "CARE_CALLBACK_SECRET"]) {
        expect(findPublishedMatch(env[name]), `${rel} ${name}`).toBeNull();
      }
    }
  });

  test("arm the integration, which makes a copied template a failing configuration", () => {
    const env = loadEnvFile(resolve(HERE, "..", "deploy/synology/care.env"));
    expect(isHopeIntegrationArmed(env)).toBe(true);
    expect(namesOf(auditEnvSecrets(env).problems)).toEqual([
      "HOPE_PARTNER_KEY",
      "INTEGRATION_HOPE_SIGNING_SECRET",
    ]);
  });
});

describe("PUBLISHED_CREDENTIALS", () => {
  test("is a list of sha256 digests, never values", () => {
    expect(PUBLISHED_CREDENTIALS.length).toBeGreaterThan(0);
    for (const p of PUBLISHED_CREDENTIALS) {
      expect(p.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(p.label).toMatch(/HOPE_PARTNER_KEY|INTEGRATION_HOPE_SIGNING_SECRET/);
    }
    expect(new Set(PUBLISHED_CREDENTIALS.map((p) => p.digest)).size).toBe(PUBLISHED_CREDENTIALS.length);
  });
});

describe("the deploy script must not hand a credential to .env", () => {
  // deploy-synology.sh used to append both Hope credentials into any .env that
  // lacked them. The committed-secret scanner does not catch that shape (its
  // assignment rule needs `NAME=value`, and the script calls a function with two
  // quoted arguments), so this is the only guard against it coming back — matched
  // on the argument pair rather than on the helper's name, so renaming
  // `ensure_env_key` cannot route the check around itself.
  const script = readFileSync(resolve(HERE, "..", "deploy-synology.sh"), "utf8").replace(/\r\n/g, "\n");
  const CALL = /"(HOPE_PARTNER_KEY|INTEGRATION_HOPE_SIGNING_SECRET|CARE_PARTNER_KEY|CARE_CALLBACK_SECRET)"\s+"([^"]{8,})"/g;

  test("passes no non-empty value for either Hope credential", () => {
    const offenders = [...script.matchAll(CALL)].map((m) => `${m[1]} = ${m[2].length} chars`);
    expect(offenders).toEqual([]);
  });

  test("still writes the two non-secret wiring lines it always has", () => {
    // Fail-closed must not turn into "the integration is never wired at all".
    expect(script).toMatch(/ensure_env_key "INTEGRATION_HOPE_CALLBACK_URL"/);
    expect(script).toMatch(/ensure_env_key "HOPE_CARE_INTEGRATION_FORCE"/);
    expect(script).toMatch(/check-env-secrets\.mjs --file \.env/);
  });
});

describe("the published digests, anchored to the repository's own history", () => {
  // The two constants in check-env-secrets.mjs are the only machine-readable record
  // of which values were burned — and nothing in a test can name those values,
  // because copying one into a test is the thing being prohibited. So the digests
  // are checked against the commit that still contained them, read out of git.
  // A shallow CI checkout (actions/checkout default fetch-depth 1) has no such
  // object, which is why this is guarded rather than assumed: locally it is the
  // proof that the ratchet and the gate are talking about the same two secrets.
  const REF = "6e649ffc"; // this PR's parent: the last commit whose care.env still carried both
  const historic = (() => {
    const r = spawnSync("git", ["show", `${REF}:deploy/synology/care.env`], { encoding: "utf8" });
    return r.status === 0 ? r.stdout : null;
  })();

  const valueOf = (text, name) => (text.match(new RegExp(`^${name}=(\\S+)$`, "m")) || [])[1] ?? "";

  test.skipIf(!historic)("each digest is the sha256 of a value that was really committed", () => {
    const partner = valueOf(historic, "HOPE_PARTNER_KEY");
    const signing = valueOf(historic, "INTEGRATION_HOPE_SIGNING_SECRET");
    expect(partner.length).toBe(70);
    expect(signing.length).toBe(64);
    const p1 = findPublishedMatch(partner);
    const p2 = findPublishedMatch(signing);
    expect(p1).not.toBeNull();
    expect(p2).not.toBeNull();
    expect(p1.digest).not.toBe(p2.digest);
    expect(p1.label).toMatch(/partner key/);
    expect(p2.label).toMatch(/signing secret/);
  });

  test("no digest is the hash of a placeholder anyone might paste", () => {
    for (const candidate of ["", "REPLACE_ME", "changeme", "undefined", "null", "your-internal-api-key-here"]) {
      expect(findPublishedMatch(candidate)).toBeNull();
    }
  });
});

describe("the CLI contract deploy-synology.sh depends on", () => {
  const dir = mkdtempSync(join(tmpdir(), "i11a-env-"));
  const write = (name, body) => {
    const p = join(dir, name);
    writeFileSync(p, body, "utf8");
    return p;
  };
  const run = (file, extraArgs = []) => {
    const r = spawnSync(process.execPath, [SCRIPT, "--file", file, ...extraArgs], {
      encoding: "utf8",
    });
    // Both streams are joined: findings go to stderr, the pass line to stdout, and
    // a gate whose output a test cannot see is a gate nobody can silence-check.
    return { code: r.status, text: `${r.stdout || ""}${r.stderr || ""}` };
  };

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("exits 1 and names the variables when the armed host has no credentials", () => {
    const f = write("nokeys.env", "HOPE_CARE_INTEGRATION_FORCE=1\nINTERNAL_API_KEY=abc123abc123abc123\n");
    const r = run(f);
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/HOPE_PARTNER_KEY/);
    expect(r.text).toMatch(/INTEGRATION_HOPE_SIGNING_SECRET/);
  });

  test("exits 0 for a configured host", () => {
    const f = write(
      "good.env",
      `HOPE_CARE_INTEGRATION_FORCE=1\nHOPE_PARTNER_KEY=${GOOD_PARTNER}\nINTEGRATION_HOPE_SIGNING_SECRET=${GOOD_SIGNING}\n`,
    );
    expect(run(f).code).toBe(0);
  });

  test("exits 0 for a host that does not use Hope at all", () => {
    const f = write("nointegration.env", "INTERNAL_API_KEY=abc123abc123abc123\n");
    expect(run(f).code).toBe(0);
  });

  test("--warn-only reports the same findings and exits 0", () => {
    const f = write("nokeys.env", "HOPE_CARE_INTEGRATION_FORCE=1\n");
    const r = run(f, ["--warn-only"]);
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/WARNING/);
    expect(r.text).toMatch(/HOPE_PARTNER_KEY/);
  });

  test("never prints a configured value, in either mode", () => {
    // The value has to be one the gate REPORTS: a finding for a different variable
    // would leave this test green while the reported line printed its own secret.
    const marker = `intgk_${"f00dbeef".repeat(2)}`; // 22 chars: present, too short, and unique
    const f = write("leak.env", `HOPE_CARE_INTEGRATION_FORCE=1\nHOPE_PARTNER_KEY=${marker}\nINTEGRATION_HOPE_SIGNING_SECRET=${marker}\n`);
    for (const args of [[], ["--warn-only"]]) {
      const r = run(f, args);
      expect(r.text).toMatch(new RegExp(`HOPE_PARTNER_KEY is only ${marker.length} characters`));
      expect(r.text).not.toContain(marker);
    }
  });
});
