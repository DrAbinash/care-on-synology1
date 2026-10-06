/**
 * draftStructuredJsonWriterLocks.sourceContract.test.ts — every writer of
 * radiology_report_drafts.structured_json must hold the row lock.
 *
 * WHY THIS EXISTS
 *   That column is an envelope shared by two independent features: Ticket A4's
 *   denormalized FindingInstance cache, and the P1 structured-format keys
 *   (format state, observation ledger, viewer measurements, canal-AP
 *   provenance, vascular technique, report-format identity, linked study,
 *   applied patterns). composeStructuredJsonColumn merges into the `existing`
 *   value it is handed, so any writer that reads that value without holding
 *   `SELECT … FOR UPDATE` composes against a snapshot a concurrent writer may
 *   already have superseded — and its UPDATE then silently discards every key
 *   the other one added.
 *
 *   FOR UPDATE only serializes against transactions that ALSO lock. Locking one
 *   of the two writers therefore protects neither. That is exactly what
 *   happened: #850 locked persistCareStructuredJsonPatch and left
 *   regenerateDraftStructuredJson reading and writing the same column through
 *   `db` with no transaction at all, so A4 could still erase a concurrent
 *   patch's keys — reintroducing the bug #850 was titled after.
 *
 *   This test exists so a THIRD writer cannot be added the same way. It is a
 *   source contract because importing these modules evaluates @workspace/db,
 *   which throws without DATABASE_URL, so no DB-less test can introspect the
 *   live call graph.
 *
 * WHAT IT CANNOT SEE
 *   A write expressed as `.set(someObjectBuiltElsewhere)` is opaque here, so
 *   every opaque `.set()` is resolved to its object literal in the same file
 *   and checked for a `structuredJson` key. A column written from a value
 *   assembled in ANOTHER module is invisible; the positive controls below fail
 *   loudly if the scan stops seeing the writers it is supposed to be judging.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = resolve(HERE, "..");

/** core.autocrlf=true on the dev box means CRLF in the working tree and LF in
 *  CI; normalise so multi-line patterns match in both. */
const read = (abs: string) => readFileSync(abs, "utf8").replace(/\r\n/g, "\n");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "testSupport") continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) sourceFiles(abs, out);
    else if (abs.endsWith(".ts") && !abs.endsWith(".test.ts")) out.push(abs);
  }
  return out;
}

/** `.update(radiologyReportDraftsTable)` with the receiver that precedes it. */
const UPDATE_RE = /(\w+)\s*\n?\s*\.update\(\s*radiologyReportDraftsTable\s*\)/g;

/** Text of the `.set(...)` argument that follows an update, brace-balanced. */
function setArgumentAfter(src: string, from: number): string | null {
  const at = src.indexOf(".set(", from);
  if (at === -1 || at - from > 200) return null;
  let depth = 0;
  for (let i = at + 4; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return src.slice(at + 5, i);
    }
  }
  return null;
}

/** Does this `.set()` argument write the shared column? `structuredJsonD1` is
 *  Ticket D3's SEPARATE column and is deliberately not covered here. */
function writesSharedColumn(arg: string): boolean {
  return /(^|[{\s,])structuredJson\s*:/.test(arg);
}

/** Body of the object literal whose `{` is at `open`, brace-balanced. */
function objectLiteralBody(src: string, open: number): string | null {
  if (src[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

type WriteSite = { file: string; line: number; receiver: string };

const sites: WriteSite[] = [];
/** `.set(<identifier>)` — resolved below so an indirect write cannot hide. */
const opaque: Array<{ file: string; line: number; name: string }> = [];

for (const abs of sourceFiles(API_SRC)) {
  const src = read(abs);
  if (!src.includes("radiologyReportDraftsTable")) continue;
  const rel = relative(API_SRC, abs).split(sep).join("/");
  for (const m of src.matchAll(UPDATE_RE)) {
    const arg = setArgumentAfter(src, m.index! + m[0].length);
    if (arg === null) continue;
    const line = src.slice(0, m.index!).split("\n").length;
    const trimmed = arg.trim();
    if (/^\w+$/.test(trimmed)) {
      opaque.push({ file: rel, line, name: trimmed });
      continue;
    }
    if (writesSharedColumn(arg)) sites.push({ file: rel, line, receiver: m[1]! });
  }
}

describe("radiology_report_drafts.structured_json writers", () => {
  it("positive control: the scan sees both known writers, and only them", () => {
    // If this list ever changes, a writer was added or moved — which is the
    // event this file exists to force a human to look at. Update the
    // expectation deliberately, not to make a failure go away.
    expect(sites.map((s) => s.file).sort()).toEqual([
      "lib/persistCareStructuredFormatState.ts",
      "lib/radiologyStructuredJsonCache.ts",
    ]);
  });

  it("every writer goes through a transaction handle, never `db` directly", () => {
    // Writing through `db` means no transaction, which means the FOR UPDATE in
    // the same file (if any) is not held across the read-modify-write.
    const offenders = sites.filter((s) => s.receiver === "db");
    expect(offenders).toEqual([]);
  });

  it("every writer's file takes the row lock with FOR UPDATE", () => {
    for (const site of sites) {
      const src = read(resolve(API_SRC, site.file));
      expect(
        src.includes('.for("update")'),
        `${site.file}:${site.line} writes structured_json without a FOR UPDATE row lock`,
      ).toBe(true);
      expect(
        src.includes(".transaction("),
        `${site.file}:${site.line} writes structured_json outside a transaction`,
      ).toBe(true);
    }
  });

  it("no indirect `.set(obj)` smuggles a write to the shared column", () => {
    // Resolve each opaque argument to its object literal in the same file and
    // confirm it does not carry the shared key. Today the only one is the
    // legacy save-draft `values`, which writes the report's own columns.
    for (const o of opaque) {
      const src = read(resolve(API_SRC, o.file));
      const lit = new RegExp(`(?:const|let)\\s+${o.name}\\s*=\\s*\\{`).exec(src);
      expect(lit, `${o.file}:${o.line} .set(${o.name}) has no resolvable object literal`).not.toBeNull();
      const open = lit!.index + lit![0].length - 1;
      const body = objectLiteralBody(src, open);
      expect(body, `${o.file}:${o.line} .set(${o.name}) object literal is not brace-balanced`).not.toBeNull();
      expect(
        writesSharedColumn(`{${body}}`),
        `${o.file}:${o.line} .set(${o.name}) writes structured_json without the row lock`,
      ).toBe(false);
    }
  });

  it("the two writers lock the same table they write", () => {
    // Guards the other half of the invariant: a FOR UPDATE on some other row
    // (a worklist claim, a study lock) would satisfy the check above while
    // leaving this column unserialized.
    for (const site of sites) {
      const src = read(resolve(API_SRC, site.file));
      expect(
        /\.select\(\{[^}]*structuredJson:\s*radiologyReportDraftsTable\.structuredJson[^}]*\}\)[\s\S]{0,300}?\.for\("update"\)/.test(
          src,
        ),
        `${site.file} does not lock the draft row it reads structured_json from`,
      ).toBe(true);
    }
  });
});
