/**
 * line-endings.test.mjs — the guard for the guard
 * ======================================================================
 *
 * Two Windows-only failure classes were measured on 2026-10-13, both caused by a
 * checkout that converts LF blobs into a CRLF working copy (`core.autocrlf=true`,
 * and until this PR no `.gitattributes` rule covered these files):
 *
 *   1. `scripts/audit-migration-ledger.mjs` starts with `#!/usr/bin/env node`.
 *      With CRLF, vite's SSR transform leaves the shebang in place, V8 sees `#!`
 *      as a statement and throws `SyntaxError: Invalid or unexpected token` with
 *      no location — the suite reports `(0 test)`, so nothing points at the byte
 *      that did it. Deleting the shebang (keeping CRLF) or converting to LF both
 *      clear it.
 *   2. Byte-for-byte goldens (`structuredReport/__fixtures__/renderer/*.body.txt`)
 *      and the compose text `dockerCompose.test.ts` parses were compared against
 *      CRLF copies: 5 + 10 assertions red on this platform only, the clinical text
 *      identical apart from `\r`.
 *
 * `.gitattributes` declares the rules. This file checks that the rules are still
 * there, that the tree they govern is non-empty, and — via `git check-attr`, which
 * is what a checkout will actually consult — that they resolve for the real paths.
 * It deliberately does NOT scan the working copy for CR bytes: a checkout made
 * before the rules landed is stale on Windows no matter what the repository says,
 * and a test that fails for that reason only teaches people to ignore tests. CI and
 * the NAS are LF by construction; the platform that can drift is told by the rules,
 * and the measured red→green evidence for each class is in the PR that added them.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const RENDERER_FIXTURES = "artifacts/api-server/src/lib/structuredReport/__fixtures__/renderer";

/**
 * `rule` — what `.gitattributes` must keep saying (case 1 below).
 * `scan` — how to find the files this checkout must not have converted (case 2).
 * `*.sh` is governed by the attributes but not scanned: nothing in the vitest
 * suite reads a shell script through a transform, so a stale CRLF copy of a
 * deploy script cannot produce a misleading test result.
 */
const GOVERNED = [
  { rule: "*.mjs text eol=lf", scan: { dir: "scripts", match: (f) => f.endsWith(".mjs") } },
  { rule: "*.cjs text eol=lf", scan: { dir: "scripts", match: (f) => f.endsWith(".cjs") } },
  { rule: "*.sh text eol=lf", scan: null },
  { rule: "docker-compose.yml text eol=lf", scan: { files: ["docker-compose.yml"] } },
  {
    rule: "**/__fixtures__/renderer/*.body.txt text eol=lf",
    scan: {
      files: fs
        .readdirSync(path.join(REPO, RENDERER_FIXTURES))
        .filter((f) => f.endsWith(".body.txt"))
        .map((f) => `${RENDERER_FIXTURES}/${f}`),
    },
  },
];

function scannedFiles() {
  const out = new Set();
  for (const g of GOVERNED) {
    if (!g.scan) continue;
    for (const f of g.scan.files || []) out.add(f);
    if (g.scan.dir) {
      const abs = path.join(REPO, g.scan.dir);
      for (const entry of fs.readdirSync(abs)) {
        const absEntry = path.join(abs, entry);
        if (fs.statSync(absEntry).isFile() && g.scan.match(entry)) out.add(`${g.scan.dir}/${entry}`);
      }
    }
  }
  return [...out].sort();
}

describe("line endings a checkout must not change", () => {
  // Comments go first. Measured: commenting a rule out with `# *.mjs text eol=lf`
  // satisfied a raw `attrs.includes(rule)` assertion — the rule still appears in the
  // file, and only `git check-attr` noticed that it no longer applies.
  const attrs = fs
    .readFileSync(path.join(REPO, ".gitattributes"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

  it("keeps an eol=lf rule for every governed pattern", () => {
    // Losing a rule has to fail something: each of the five is what makes one of
    // the two measured classes impossible on a fresh checkout.
    for (const g of GOVERNED) {
      expect(attrs, `.gitattributes is missing "${g.rule}"`).toContain(g.rule);
    }
  });

  it("scans the files that actually carry the hazard", () => {
    // A guard over an empty list passes forever. The list is derived from the tree,
    // so this pins the count to what the fixtures directory really holds.
    const files = scannedFiles();
    expect(files).toContain("scripts/audit-migration-ledger.mjs");
    expect(files).toContain("docker-compose.yml");
    expect(files.filter((f) => f.endsWith(".body.txt"))).toHaveLength(5);
    expect(files.length).toBeGreaterThan(15);
  });

  it("applies those rules to the real paths, not just to the pattern text", () => {
    // A pattern that matches nothing is the failure mode this whole class has:
    // the rule reads fine in .gitattributes and no file is governed. `git check-attr`
    // answers the question the checkout will actually ask, on every platform, and
    // does not depend on whether this working copy was made before the rule landed.
    const sample = [
      "scripts/audit-migration-ledger.mjs",
      "scripts/check-migration-order.cjs",
      "docker-compose.yml",
      `${RENDERER_FIXTURES}/example1MriBrain.body.txt`,
    ];
    let out;
    try {
      out = execFileSync("git", ["check-attr", "text", "eol", "--", ...sample], {
        cwd: REPO,
        encoding: "utf8",
      });
    } catch (e) {
      throw new Error(
        "git check-attr failed, so line-ending governance cannot be verified here: " + e.message,
      );
    }
    const lines = out.split(/\r?\n/).filter(Boolean);
    // One line per attribute per path: `text` and `eol`.
    expect(lines).toHaveLength(sample.length * 2);
    for (const rel of sample) {
      const mine = lines.filter((l) => l.startsWith(`${rel}:`));
      expect(mine.some((l) => l.endsWith("text: set")), `${rel} is not marked text`).toBe(true);
      expect(mine.some((l) => l.endsWith("eol: lf")), `${rel} is not pinned to LF`).toBe(true);
    }
  });
});
