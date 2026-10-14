// ============================================================================
// PR-I11A — the committed-secret ratchet.
//
// `scripts/check-no-committed-secrets.mjs` existed only in the sibling HOPE
// repository; CARE had no guard at all, which is how a live partner key and a
// live callback signing secret sat in `.env.example`, `deploy/synology/*.env`,
// `deploy-synology.sh` and a stray `patch` file in a PUBLIC repository from July
// to October 2026. Wiring it to CI is only worth doing if the ratchet cannot be
// loosened by the person it is meant to catch, so these tests pin the exact
// three ways it fails open: a baseline that no longer matches reality, a
// baseline nobody regenerated, and output that leaks the value it found.
// ============================================================================
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "check-no-committed-secrets.mjs");
const COMMITTED_BASELINE = resolve(HERE, "committed-secrets-baseline.json");

/** Findings are reported as `↑ <path>: a → b`, and every path here contains dots. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const dir = mkdtempSync(join(tmpdir(), "i11a-baseline-"));
const run = (args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd: resolve(HERE, "..") });
  return { code: r.status, text: `${r.stdout || ""}${r.stderr || ""}` };
};

let fresh;
beforeAll(() => {
  fresh = join(dir, "fresh-baseline.json");
  const w = run(["--write-baseline", "--baseline", fresh]);
  expect(w.code, w.text).toBe(0);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const readCounts = (p) => JSON.parse(readFileSync(p, "utf8"));

describe("the committed baseline", () => {
  test("matches the repository as it now stands, file for file", () => {
    // The CI step compares against this exact file. Regenerating reality and
    // diffing is the only way to catch a baseline that was hand-edited upward —
    // or one that drifted because someone moved a finding to another line.
    expect(readCounts(COMMITTED_BASELINE)).toEqual(readCounts(fresh));
  });

  test("CI passes with it", () => {
    const r = run(["--baseline", COMMITTED_BASELINE]);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toMatch(/passed against baseline/);
  });

  test("does not carry an entry for the deleted stray `patch` file", () => {
    // `patch` was a `git format-patch` output committed by #350 that held both
    // Hope credentials. Its absence here is the record that it is gone.
    expect(Object.keys(readCounts(COMMITTED_BASELINE))).not.toContain("patch");
    expect(existsSync(resolve(HERE, "..", "patch"))).toBe(false);
  });

  test("records a positive count for every file it is vouching for", () => {
    // A `0` entry would be a free slot to hide a future finding in, and an empty
    // baseline would mean the guard has never actually fired on this repository.
    const counts = readCounts(COMMITTED_BASELINE);
    const entries = Object.entries(counts);
    expect(entries.length).toBeGreaterThan(0);
    for (const [file, n] of entries) expect(n, file).toBeGreaterThan(0);
  });
});

describe("the ratchet cannot be loosened", () => {
  test("one finding more than the baseline fails", () => {
    const doctored = join(dir, "lower.json");
    const counts = readCounts(fresh);
    const file = Object.keys(counts)[0];
    counts[file] = counts[file] - 1;
    writeFileSync(doctored, JSON.stringify(counts), "utf8");

    const r = run(["--baseline", doctored]);
    expect(r.code).toBe(1);
    expect(r.text).toMatch(new RegExp(`↑ ${escapeRe(file)}`));
  });

  test("a finding in a file the baseline has never heard of fails outright", () => {
    const doctored = join(dir, "missing-entry.json");
    const counts = readCounts(fresh);
    const file = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const findings = counts[file];
    delete counts[file]; // as if the credential landed in a file nobody recorded
    writeFileSync(doctored, JSON.stringify(counts), "utf8");

    const r = run(["--baseline", doctored]);
    expect(r.code).toBe(1);
    expect(r.text).toMatch(new RegExp(`↑ ${escapeRe(file)}: 0 → ${findings}`));
  });

  test("a shrink must be re-recorded rather than left above reality", () => {
    const doctored = join(dir, "higher.json");
    const counts = readCounts(fresh);
    const file = Object.keys(counts)[0];
    counts[file] = counts[file] + 1;
    writeFileSync(doctored, JSON.stringify(counts), "utf8");

    const r = run(["--baseline", doctored]);
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/↓/);
    expect(r.text).toMatch(/--write-baseline/);
  });

  test("a missing baseline is a failure, not a skip", () => {
    const r = run(["--baseline", join(dir, "nope.json")]);
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/baseline .* is missing/);
  });
});

describe("the report is not a second leak", () => {
  test("no printed line carries an unmasked long secret", () => {
    const r = run([]);
    // Without --baseline the scanner lists every finding; each must be masked.
    for (const line of r.text.split("\n")) {
      expect(line, line.slice(0, 60)).not.toMatch(/[0-9a-f]{40,}/i);
      expect(line, line.slice(0, 60)).not.toMatch(/intgk_[0-9a-f]{20,}/i);
    }
  });

  test("names every finding with file, line and rule", () => {
    const r = run([]);
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/deploy\/synology\/care\.env:\d+\s+—\s+/);
  });
});
