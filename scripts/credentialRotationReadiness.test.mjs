// ============================================================================
// HOPE credential-rotation READINESS — the guard behind
// docs/CARE_HOPE_CREDENTIAL_ROTATION_RUNBOOK.md.
//
// A runbook is a set of factual claims about code that nobody executes. The one
// that matters here is not "is the prose pretty" but "will an operator in a
// fifteen-minute window trust a sentence that stopped being true months ago, and
// rotate the wrong half of a pair". Every case below therefore re-reads the
// shipped source and the shipped config, and asserts the document against them:
//
//   * every `file:line` the runbook cites must resolve, and the identifier named
//     next to it must actually be there — a hallucinated line number is the exact
//     failure mode a citation-only review cannot catch;
//   * every environment-variable name must exist in compose or the real template,
//     so the runbook cannot invent a knob an operator would hunt for;
//   * the precedence claim (env vs database) is checked against the live source
//     text, not against a paraphrase of it;
//   * the document must still forbid execution, must still carry a rollback per
//     step, and must never itself contain a secret-shaped string.
//
// Nothing here opens a database, a socket or a credential value. No .env is read:
// the live secret is deliberately not observable from this checkout, and the
// runbook says so rather than guessing.
// ============================================================================
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { PAIRS } from "./integration-credential-posture.mjs";
import { INTEGRATION_GUARDED, PUBLISHED_CREDENTIALS } from "./check-env-secrets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const DOC_REL = "docs/CARE_HOPE_CREDENTIAL_ROTATION_RUNBOOK.md";
const DOC = readFileSync(join(REPO, DOC_REL), "utf8");
const DOC_LINES = DOC.split(/\r?\n/);

const at = (rel) => join(REPO, rel);
const src = (rel) => readFileSync(at(rel), "utf8");
const linesOf = (rel) => src(rel).split(/\r?\n/);
const lineAt = (rel, n) => linesOf(rel)[n - 1];

/** ±5 line window, so a citation that lands on an adjacent continuation still passes. */
const windowOf = (rel, n, span = 5) =>
  linesOf(rel).slice(Math.max(0, n - 1 - span), n + span).join("\n");

/** The one piece of a quoted claim the cited lines can be checked against. A route
 *  is mounted from a prefix, so only its last segment appears in source; an env name
 *  is literal; anything else is reduced to an identifier from the phrase. */
function claimToken(claim) {
  if (claim.includes("/")) {
    const segs = claim.split(/[/\s]+/).filter(Boolean);
    const last = String(segs[segs.length - 1] || "").replace(/[^A-Za-z0-9_:.-]/g, "");
    if (last) return last;
  }
  const caps = claim.match(/\b[A-Z][A-Z0-9_]{4,}\b/g) || [];
  if (caps.length) return caps[0];
  const idents = (claim.match(/[A-Za-z_][A-Za-z0-9_]{4,}/g) || []).filter((t) => !/^[A-Z]+$/.test(t));
  return idents[0] ?? null;
}

const OUTBOX = "artifacts/api-server/src/services/integration/outbox.ts";
const PARTNER_AUTH = "artifacts/api-server/src/middleware/requireIntegrationPartnerAuth.ts";
const BOOTSTRAP = "artifacts/api-server/src/lib/bootstrapHopeCareIntegration.ts";
const ADMIN = "artifacts/api-server/src/routes/integration/admin.ts";
const API_INDEX = "artifacts/api-server/src/index.ts";
const PARTNER_SCHEMA = "lib/db/src/schema/integrationPartners.ts";
const GATE = "scripts/check-env-secrets.mjs";
const POSTURE = "scripts/integration-credential-posture.mjs";
const COMPOSE = "docker-compose.yml";
const ENV_TEMPLATE = ".env.example";
const CARE_ENV = "deploy/synology/care.env";
const HOPE_ENV = "deploy/synology/hope.env";

// A citation is a backticked repo-relative path with a line number on the end.
const CITATION = /`([A-Za-z0-9_.\-/]+\.(?:ts|tsx|mjs|cjs|sh|yml|yaml|json|md|env|example)):(\d+)`/g;
// A consumer-map entry additionally names the identifier that must be there.
const MAP_ROW = /`([A-Za-z0-9_.\-/]+?):(\d+)`\s*::\s*`([^`\n]+?)`/g;

// A citation with no line number still has to be a fact about the file it names.
// The runbook uses this form for `ops-preflight.mjs`, which every other open
// infrastructure PR edits: a line number there would rot within the week, and a
// guard that quietly stopped checking the row would be worse than no citation.
const IDENT_CITATION = /`([A-Za-z0-9_.\-/]+\.(?:ts|tsx|mjs|cjs|sh|yml|yaml|json|md|env|example))`\s*::\s*`([^`\n]+?)`/g;
const identCitations = [...DOC.matchAll(IDENT_CITATION)].map((m) => ({ file: m[1], ident: m[2] }));

const citations = [...DOC.matchAll(CITATION)].map((m) => ({ file: m[1], line: Number(m[2]) }));
const mapRows = [...DOC.matchAll(MAP_ROW)].map((m) => ({ file: m[1], line: Number(m[2]), ident: m[3] }));

// ---------------------------------------------------------------------------
describe("the document refuses to authorise its own execution", () => {
  test("the approval bar is inside the first five lines, not buried in scope", () => {
    // An operator who prints this file, or opens it on a phone mid-incident, reads
    // five lines. Anything below them is decoration if the top says nothing, which
    // is why the constraint is asserted positionally rather than by search.
    const head = DOC_LINES.slice(0, 5).join("\n");
    expect(head).toMatch(/DO NOT EXECUTE/i);
    expect(head).toMatch(/OWNER APPROVAL|owner approves/i);
  });

  test("every category the brief says is never authorised is named as forbidden", () => {
    for (const what of ["No rotation", "No restart", "No deploy", "No network change", "No production database write"]) {
      expect(DOC, `"${what}" is listed as out of scope`).toContain(what);
    }
    // The restart warning has to name the container the clinic depends on, or it
    // reads as an infra footnote rather than as "the Bill Desk stops".
    expect(DOC).toMatch(/care-api[\s\S]{0,120}Bill Desk|Bill Desk[\s\S]{0,160}care-api/);
  });

  test("the runbook never carries a value, in any shape, including its own commands", () => {
    // This is the check that keeps a documentation PR from becoming the next leak.
    // The shapes are the ones this repository's own scanner recognises.
    const offenders = [];
    if (/postgres(ql)?:\/\//i.test(DOC)) offenders.push("a postgres connection URL");
    if (/[0-9a-f]{20,}/.test(DOC)) offenders.push("a 20+ hex string (secret or full digest)");
    if (/intgk_[0-9a-f]{16,}/.test(DOC)) offenders.push("an issued partner key");
    if (/sha256=[0-9a-f]{16,}/i.test(DOC)) offenders.push("a replayed HMAC");
    if (/[A-Za-z0-9+/]{20,}={1,2}(?![A-Za-z0-9+/])/u.test(DOC)) offenders.push("a padded base64 blob");
    if (/Bearer\s+[A-Za-z0-9_.\-]{16,}/.test(DOC)) offenders.push("a bearer token");
    if (/^[A-Z][A-Z0-9_]{7,}=(?!\$|\.)[^$\s"'`]{16,}/m.test(DOC)) offenders.push("an env assignment with a long literal value");
    // High-entropy alnum runs, which is what a rotated secret looks like when pasted.
    for (const tok of DOC.split(/[^A-Za-z0-9]+/)) {
      if (tok.length < 24 || !/[a-z]/.test(tok) || !/[A-Z]/.test(tok) || !/[0-9]/.test(tok)) continue;
      const counts = {};
      for (const ch of tok) counts[ch] = (counts[ch] ?? 0) + 1;
      const entropy = Object.values(counts).reduce((a, c) => a - (c / tok.length) * Math.log2(c / tok.length), 0);
      if (entropy > 4.05) offenders.push(`high-entropy token of ${tok.length} chars`);
    }
    expect(offenders, `the runbook must not contain: ${offenders.join(", ")}`).toEqual([]);
  });

  test("the digest prefixes it does print are the repository's own published digests", () => {
    // 12 hex characters are the only credential-shaped thing the document is
    // allowed to print. They must be real prefixes of the digests already in
    // `PUBLISHED_CREDENTIALS`, not invented identifiers that look authoritative.
    const printed = [...DOC.matchAll(/\b([0-9a-f]{12})\b/g)].map((m) => m[1]);
    expect(printed.length, "the runbook cites at least one digest prefix").toBeGreaterThan(0);
    const known = PUBLISHED_CREDENTIALS.map((p) => p.digest.slice(0, 12));
    for (const p of printed) {
      expect(known, `${p} is not a published digest in ${GATE}`).toContain(p);
    }
  });
});

// ---------------------------------------------------------------------------
describe("anti-hallucination: every citation in the runbook resolves", () => {
  test("the document is citable at all — a runbook with no file:line proves nothing", () => {
    expect(citations.length, "citations found in the runbook").toBeGreaterThan(40);
    expect(mapRows.length, "consumer-map rows with an identifier").toBeGreaterThan(40);
  });

  test("each cited file exists and each cited line number is inside it", () => {
    const bad = citations.filter((c) => {
      if (!existsSync(at(c.file))) return true;
      return c.line < 1 || c.line > linesOf(c.file).length;
    });
    expect(bad, `unresolvable citations: ${JSON.stringify(bad)}`).toEqual([]);
  });

  test("no cited line is blank — a pointer at whitespace is a fabricated pointer", () => {
    const blank = citations
      .filter((c) => existsSync(at(c.file)))
      .filter((c) => !String(lineAt(c.file, c.line)).trim())
      .map((c) => `${c.file}:${c.line}`);
    expect(blank, `cited lines holding nothing: ${blank.join(", ")}`).toEqual([]);
  });

  test("the named identifier really appears within +/- 5 lines of the citation", () => {
    // The load-bearing case. Everything an operator does in the window is driven
    // from these rows; a line number that drifted by thirty lines points at an
    // unrelated statement that still compiles and still reads plausibly.
    const misses = [];
    for (const r of mapRows) {
      if (!existsSync(at(r.file))) { misses.push(`${r.file}:${r.line} (no such file)`); continue; }
      if (!windowOf(r.file, r.line).includes(r.ident)) {
        misses.push(`${r.file}:${r.line} :: ${r.ident} (not present in +/-5 lines)`);
      }
    }
    expect(misses, `drifted or invented citations:\n${misses.join("\n")}`).toEqual([]);
  });

  test("every quoted claim names something that is on the line it cites", () => {
    // The gap this closes: a `::` identifier is only on consumer-map rows, so the
    // prose citations — the ones an operator follows during the window, like the
    // startup log line to watch for or the route to prove inbound with — were only
    // bounds-checked. A line number that drifts onto a different statement still
    // compiles, still is non-blank, and still reads plausibly. Each claim is reduced
    // to one token that has to be present: the last path segment of a route, else an
    // environment name, else the longest identifier in the phrase.
    const claims = [...DOC.matchAll(/`([^`\n]{2,80})`\s*\(`([^`\n]+:\d+)`\)/g)].map((m) => ({ claim: m[1], cite: m[2] }));
    expect(claims.length, "quoted claims with a citation").toBeGreaterThanOrEqual(10);
    const misses = [];
    for (const { claim, cite } of claims) {
      const file = cite.slice(0, cite.lastIndexOf(":"));
      const line = Number(cite.slice(cite.lastIndexOf(":") + 1));
      if (!existsSync(at(file))) { misses.push(`${cite} (no such file)`); continue; }
      const token = claimToken(claim);
      if (!token) { misses.push(`${cite} :: "${claim}" yields nothing checkable`); continue; }
      if (!windowOf(file, line, 2).includes(token)) {
        misses.push(`${cite} :: "${claim}" → "${token}" is not in the cited lines`);
      }
    }
    expect(misses, `claims the code does not say where the runbook says it does:\n${misses.join("\n")}`).toEqual([]);
  });

  test("an identifier cited without a line number is in the file it names", () => {
    expect(identCitations.length, "identifier-only citations").toBeGreaterThanOrEqual(6);
    const misses = [];
    for (const r of identCitations) {
      if (!existsSync(at(r.file))) { misses.push(`${r.file} (no such file)`); continue; }
      if (!src(r.file).includes(r.ident)) misses.push(`${r.file} does not contain "${r.ident}"`);
    }
    expect(misses, `citations that name a file which does not say it:\n${misses.join("\n")}`).toEqual([]);
  });

  test("the consumer map covers both credentials on both sides of the edge", () => {
    // Derived from the gate module's own guarded list, so a credential added to
    // the deploy gate without a runbook row fails here rather than going unnoticed.
    const covered = new Set(mapRows.map((r) => r.ident));
    for (const { name } of INTEGRATION_GUARDED) {
      expect(covered.has(name), `${name} has no consumer-map row`).toBe(true);
    }
    for (const p of PAIRS) {
      for (const side of [p.care, p.hope]) {
        expect(covered.has(side), `${side} has no consumer-map row`).toBe(true);
      }
    }
  });

  test("directions are split: one credential is verified, the other signs, and the runbook says so", () => {
    // The distinction the owner asked for. "Reads it to verify incoming" and
    // "reads it to sign outgoing" are different blast radii, and a map that blurs
    // them invites someone to rotate the signing secret through the partner flow.
    const inbound = mapRows.filter((r) => / :: verify-incoming/.test(`${r.file}`) || r.ident === "keyHash");
    expect(inbound.some((r) => r.file.endsWith(PARTNER_AUTH)), "inbound verification site is mapped").toBe(true);
    const signing = mapRows.filter((r) => r.file.endsWith(OUTBOX));
    expect(signing.length, "outbound signing sites are mapped").toBeGreaterThan(3);
    // And the code agrees: the inbound middleware has no environment read at all.
    expect(src(PARTNER_AUTH)).not.toMatch(/process\.env/);
  });
});

describe("the committed-secret census is the scanner's own baseline", () => {
  const baseline = JSON.parse(src("scripts/committed-secrets-baseline.json"));
  const files = Object.keys(baseline);
  const total = files.reduce((a, f) => a + baseline[f], 0);
  const bucket = (f) => {
    if (f === "deploy/synology/care.env") return "care";
    if (f === "deploy/synology/hope.env") return "hope";
    // The Windows offline templates carry the documented first-boot owner PIN. They
    // are baselined rather than exempted, so the census has to say what they are.
    if (f.startsWith("deploy/windows-emergency/")) return "emergency";
    if (f.endsWith(".test.ts")) return "test";
    if (f.includes("FINANCIAL_FORMULA_CHANGE_LOG")) return "ledger";
    if (f === ".replit") return "replit";
    if (f.endsWith(".patch")) return "patch";
    // A file the census has no word for is a count the runbook would silently
    // include in its total and omit from its sentence. Fail at the shape, not the sum.
    throw new Error(`the runbook has no bucket for ${f}`);
  };
  const ORDER = ["care", "hope", "emergency", "test", "ledger", "replit", "patch"];
  const counts = ORDER.map((b) => files.filter((f) => bucket(f) === b).reduce((a, f) => a + baseline[f], 0));

  test("the baseline is the census the runbook describes", () => {
    expect(total).toBe(9);
    expect(files.length).toBe(8);
    // Every baseline file lands in a named bucket: a seventh shape would otherwise be
    // counted in the total and missing from the sentence that explains it.
    expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
  });

  test("the runbook's own arithmetic adds up, digit by digit", () => {
    // The sentence is written with digits precisely so that this is a check and not a
    // reading-comprehension exercise. The first version said "two in test fixtures"
    // while the baseline held three, and its enumeration summed to 15 under a stated
    // total of 16 — which no prose review noticed, because every word sounded right.
    // Only a digit immediately before " sit in" / " in" is a count, so file names that
    // carry digits (`0001-Add-…patch`) cannot join the sum.
    const sentence = DOC.match(/(\d+) sit in[\s\S]{0,900}?\d+ in total/);
    expect(sentence, "the census sentence must state each count and a total").toBeTruthy();
    const parts = [...sentence[0].matchAll(/\b(\d+)\s+(?:sit in|in(?!\s+total))/g)].map((m) => Number(m[1]));
    const stated = Number((sentence[0].match(/(\d+) in total/) || [])[1]);
    expect(parts, `the counts the runbook prints, in order ${ORDER.join("/")}`).toEqual(counts);
    expect(stated, "the total the runbook prints").toBe(total);
  });

  test("the runbook names every file the baseline holds", () => {
    const missing = files.filter((f) => !DOC.includes(f) && !DOC.includes(f.split("/").pop()));
    expect(missing, `baseline files the runbook never mentions: ${missing.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("no invented environment-variable name", () => {
  test("every ENV_NAME in the runbook exists in compose, a template, or the shipped code", () => {
    // Two-or-more underscores keeps prose (a `key_prefix` column, a `sha256`
    // label) out of the sweep while catching anything a reader could conclude is
    // a variable to set. Known sources are the deploy surface plus the modules
    // the runbook itself cites.
    const knownSources = [
      COMPOSE, ENV_TEMPLATE, CARE_ENV, HOPE_ENV, "deploy/synology/README.md",
      "docker/api-entrypoint.sh", "deploy-synology.sh", BOOTSTRAP, OUTBOX, GATE,
      POSTURE, PARTNER_AUTH, ADMIN, "scripts/ops-preflight.mjs", "scripts/deploy-health.mjs",
    ].map((f) => src(f)).join("\n");
    // A candidate is a SCREAMING_SNAKE name standing on its own, not one embedded in a
    // path: `docs/archive/FINANCIAL_FORMULA_CHANGE_LOG.md` is a file the census names,
    // not a variable an operator could set, and treating it as one would let the sweep
    // be satisfied by whatever the document happens to mention.
    const named = [...new Set([...DOC.matchAll(/(?:^|[^/\w.])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+){2,})(?![/\w.])/gm)].map((m) => m[1]))];
    expect(named.length, "the sweep found candidate names").toBeGreaterThan(4);
    const invented = named.filter((n) => !knownSources.includes(n));
    expect(invented, `names the runbook lists that exist nowhere in the shipped config or code: ${invented.join(", ")}`).toEqual([]);
  });

  test("the credential names themselves are declared where a container could receive them", () => {
    for (const { name } of INTEGRATION_GUARDED) {
      const inCompose = src(COMPOSE).includes(name);
      const inTemplate = src(ENV_TEMPLATE).includes(name) || src(CARE_ENV).includes(name);
      expect(inCompose, `${name} is not forwarded by ${COMPOSE}`).toBe(true);
      expect(inTemplate, `${name} is absent from ${ENV_TEMPLATE} and ${CARE_ENV}`).toBe(true);
    }
  });

  test("the inventory's secret rows are exactly the pairs the posture tool knows", () => {
    // Parsed out of the table the operator reads, then compared to PAIRS — the
    // document may not add a third secret or rename a peer-side alias.
    const rows = [...DOC.matchAll(/^\|\s*\d+\s*\|\s*`([A-Z0-9_]+)`\s*\|\s*([^|]*?)\s*\|/gm)]
      .map((m) => ({ care: m[1], alias: m[2] }))
      .filter((r) => !/not a secret/.test(r.alias));
    const asPairs = rows.map((r) => [r.care, r.alias.replace(/`/g, "")]).sort();
    const fromCode = PAIRS.map((p) => [p.care, p.hope]).sort();
    expect(asPairs, "secret rows in the inventory table").toEqual(fromCode);
  });
});

// ---------------------------------------------------------------------------
describe("the precedence claim is the code, not a paraphrase", () => {
  test("outbound signing secret: env is read with no database candidate at all", () => {
    // The brief predicted "env first, so a UI rotation does not stick". For the
    // signing secret the truth is stronger — there is no DB value to lose to.
    expect(lineAt(OUTBOX, 105).trim())
      .toBe("const secret = process.env[`INTEGRATION_${code}_SIGNING_SECRET`] ?? null;");
    expect(lineAt(OUTBOX, 105)).not.toMatch(/\bdb\b/);
  });

  test("callback URL: the quoted precedence expression is verbatim", () => {
    expect(lineAt(OUTBOX, 106).trim()).toBe("return { code, cfg: { url: envUrl ?? dbUrl, secret } };");
    // The runbook quotes `url: envUrl ?? dbUrl`; the quote must be the source text.
    expect(DOC).toContain("url: envUrl ?? dbUrl");
  });

  test("inbound partner key: per-request authority is the database hash, exactly as written", () => {
    expect(src(PARTNER_AUTH))
      .toContain(".where(and(eq(integrationPartnersTable.keyHash, hashApiKey(rawKey)), eq(integrationPartnersTable.isActive, true)))");
    expect(src(PARTNER_AUTH)).not.toMatch(/HOPE_PARTNER_KEY/);
  });

  test("...and every API start re-stamps that database hash from the environment", () => {
    // This is the half that makes the rotate-key button a trap rather than a
    // no-op: it works, then the next boot quietly undoes it.
    expect(lineAt(API_INDEX, 3032).trim()).toBe("bootstrapHopeCareIntegration()");
    const updateBranch = windowOf(BOOTSTRAP, 145, 8);
    expect(updateBranch).toContain(".set({");
    expect(updateBranch).toContain("keyHash,");
    expect(updateBranch).toContain("callbackUrl,");
    expect(updateBranch).toContain("permissions,");
    expect(updateBranch).toMatch(/\.where\(eq\(integrationPartnersTable\.code, "HOPE"\)\)/);
    expect(src(BOOTSTRAP)).toMatch(/const rawKey = \(env\["HOPE_PARTNER_KEY"\] \|\| ""\)\.trim\(\);/);
    // And it runs pre-listen a second time, so there is no way to observe the
    // stale window by only watching the application process.
    expect(lineAt("docker/api-entrypoint.sh", 19)).toContain("bootstrap-hope-care-integration.mjs");
  });

  test("the admin rotate endpoint touches only the database", () => {
    const handler = linesOf(ADMIN).slice(91, 98).join("\n");
    expect(handler).toContain("rotate-key");
    expect(handler).toContain("keyHash: hashApiKey(rawKey)");
    expect(handler).not.toMatch(/process\.env|HOPE_PARTNER_KEY|writeFileSync/);
  });

  test("the trap is documented in the shipped code, so the runbook is not the only copy", () => {
    expect(src(GATE)).toMatch(/the next boot would overwrite it/);
  });
});

// ---------------------------------------------------------------------------
describe("dual-accept, as the code actually stands", () => {
  test("each side holds exactly one credential, so a grace window is impossible", () => {
    // The runbook states plainly that overlap is not supported. If anyone adds an
    // `alt`/`previous` key list, this fails and the document must be re-written —
    // the outage shape it promises would no longer be the outage shape we have.
    expect(src(PARTNER_SCHEMA)).toMatch(/keyHash: text\("key_hash"\)/);
    expect(src(PARTNER_SCHEMA)).not.toMatch(/keyHash.*jsonb|key_hash.*\[\]/);
    const authSrc = src(PARTNER_AUTH);
    expect(authSrc).toMatch(/eq\(integrationPartnersTable\.keyHash, hashApiKey\(rawKey\)\)/);
    expect(authSrc).not.toMatch(/inArray|any\(|altKey|previousKey|oldKey|keyRotation/);
    const outboxSrc = src(OUTBOX);
    expect(outboxSrc).not.toMatch(/SIGNING_SECRET.*split|altSecret|previousSecret/);
  });

  test("the retry budget the runbook quotes is the one in the schema and the backoff", () => {
    expect(lineAt("lib/db/src/schema/integrationOutbox.ts", 34)).toMatch(/maxAttempts.*default\(8\)/);
    expect(windowOf(OUTBOX, 109, 3)).toContain("30_000 * Math.pow(2");
    expect(windowOf(OUTBOX, 109, 3)).toContain("60 * 60 * 1000");
    expect(DOC).toMatch(/max_attempts = 8/);
  });

  test("a missing secret fails closed rather than sending unsigned events", () => {
    // Without this the rotation sequence would be unsafe: half-configured would
    // mean a peer accepting unauthenticated callbacks.
    expect(lineAt(OUTBOX, 354)).toContain("if (!cfg.url || !cfg.secret)");
    expect(windowOf(OUTBOX, 371, 4)).toContain("delivery_not_configured");
    expect(DOC).toContain("delivery_not_configured");
  });
});

// ---------------------------------------------------------------------------
describe("the rotation sequence is complete", () => {
  const stepBlocks = () => {
    const start = DOC.indexOf("### Step 1 ");
    expect(start, "(d) contains numbered steps").toBeGreaterThan(-1);
    const tail = DOC.slice(start);
    const chunks = tail.split(/^### /m).filter((c) => /^Step \d+/.test(c));
    // Everything after the last step belongs to (e); trim at the section rule.
    return chunks.map((c) => c.split("\n---\n")[0]);
  };

  test("steps are numbered contiguously from 1", () => {
    const nums = stepBlocks().map((b) => Number(/^Step (\d+)/.exec(b)[1]));
    expect(nums).toEqual(nums.map((_, i) => i + 1));
    expect(nums.length, "the sequence has enough steps to cover both hosts and both restarts").toBeGreaterThanOrEqual(8);
  });

  test("every step carries all five fields, including a rollback", () => {
    // The brief's hard requirement, checked per step rather than by a global
    // count: a sequence with three rollbacks and ten steps would pass a tally and
    // still leave an operator stranded mid-window.
    const bad = [];
    stepBlocks().forEach((block, i) => {
      for (const field of ["Pre-check", "Action", "Post-check", "Abort criterion", "Rollback"]) {
        if (!new RegExp(`\\*\\*${field}:\\*\\*`).test(block)) bad.push(`step ${i + 1} has no ${field}`);
      }
    });
    expect(bad, bad.join("; ")).toEqual([]);
  });

  test("step count equals rollback count", () => {
    const steps = stepBlocks().length;
    const rollbacks = [...DOC.matchAll(/^- \*\*Rollback:\*\*/gm)].length;
    expect(rollbacks).toBe(steps);
  });

  test("any step whose action restarts something says OWNER-APPROVAL REQUIRED", () => {
    const unlabelled = stepBlocks()
      .map((b, i) => ({ i: i + 1, action: (/^- \*\*Action:\*\*.*$/m.exec(b) ?? [""])[0], block: b }))
      .filter((s) => /\brestart/i.test(s.action) && !/OWNER-APPROVAL REQUIRED/.test(s.block))
      .map((s) => s.i);
    expect(unlabelled, `restart steps without an approval flag: ${unlabelled.join(", ")}`).toEqual([]);
    expect(DOC).toMatch(/OWNER-APPROVAL REQUIRED — interrupts the live Bill Desk/);
  });

  test("the ordering constraint the precedence finding forces is stated, and so is its reason", () => {
    // Both env reads are boot-frozen, so staging both files first is not a
    // preference — it is the only way to avoid an avoidable half-state.
    expect(DOC).toMatch(/editing a `\.env` changes nothing on a running container/);
    expect(DOC).toMatch(/Restart \*\*HOPE first, `care-api` last\*\*/);
  });

  test("the abort criteria are observable facts, not judgement", () => {
    // "Abort if it looks wrong" is unusable in a window. Every abort names a thing
    // the operator can see in an output line.
    const aborts = [...DOC.matchAll(/^- \*\*Abort criterion:\*\* (.+)$/gm)].map((m) => m[1]);
    expect(aborts.length).toBe(stepBlocks().length);
    const vague = aborts.filter((a) => /^(abort|stop|carefully|as needed)/i.test(a.trim()));
    expect(vague).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("the posture the inventory claims is the posture the tree has", () => {
  test("no live Hope credential is committed: every template assignment is empty", () => {
    // Supports (g)2's claim that the 16 committed findings contain none of this
    // pair. If someone pastes a value back into a template, the runbook's
    // "names only, never values" framing becomes a lie about the repository.
    for (const [rel, names] of [
      [ENV_TEMPLATE, ["HOPE_PARTNER_KEY", "INTEGRATION_HOPE_SIGNING_SECRET"]],
      [CARE_ENV, ["HOPE_PARTNER_KEY", "INTEGRATION_HOPE_SIGNING_SECRET"]],
      [HOPE_ENV, ["CARE_PARTNER_KEY", "CARE_CALLBACK_SECRET"]],
    ]) {
      for (const name of names) {
        const m = new RegExp(`^${name}=(.*)$`, "m").exec(src(rel));
        expect(m, `${name} is declared in ${rel}`).toBeTruthy();
        expect(m[1].trim(), `${rel} must keep ${name} empty`).toBe("");
      }
    }
  });

  test("the committed-secret counts quoted in (g) match the baseline file", () => {
    const baseline = JSON.parse(src("scripts/committed-secrets-baseline.json"));
    const files = Object.keys(baseline);
    const total = files.reduce((a, n) => a + baseline[n], 0);
    expect(DOC).toContain(`${total} committed secret findings across ${files.length} tracked files`);
    expect(DOC).toContain(`${total} findings in ${files.length} files`);
    // Was `expect(baseline[CARE_ENV]).toBe(8)` — a pin on the leak existing. The
    // eight values are gone from the tracked template, so the invariant that
    // matters now is that they stay gone.
    expect(baseline[CARE_ENV] ?? 0).toBe(0);
  });

  test("the eight care.env secrets are named in (g)2 and carry no value in the template", () => {
    const named = /(\d+) sit in\s*\n?\s*`deploy\/synology\/care\.env` \(([^)]*)\)/.exec(DOC);
    expect(named, "(g)2 names the care.env findings").toBeTruthy();
    const names = named[2].split(",").map((s) => s.trim().replace(/`/g, "")).filter(Boolean);
    expect(Number(named[1]), "the count the runbook prints for care.env").toBe(0);
    expect(names.length).toBe(8);
    for (const n of names) {
      const m = new RegExp(`^${n}=(.+)$`, "m").exec(src(CARE_ENV));
      expect(m, `${n} is still declared in ${CARE_ENV}`).toBeTruthy();
      // Declared, so compose still forwards it — but no value may ride in the file
      // that the README tells an operator to copy verbatim into `.env`.
      expect(m[1].trim(), `${n} must be a placeholder in the tracked template`)
        .toMatch(/^REPLACE_ME_[a-z0-9_]+$/i);
    }
    // And the runbook never repeats one of them.
    for (const n of names) expect(DOC).not.toMatch(new RegExp(`^${n}=[^$\s]{9,}`, "m"));
  });

  test("minimum length and key shape quoted by (e) are the gate's own numbers", () => {
    expect(lineAt(GATE, 33)).toMatch(/MIN_INTEGRATION_SECRET_LENGTH = 32/);
    expect(windowOf(BOOTSTRAP, 50, 2)).toContain("MIN_PARTNER_KEY_LENGTH = 32");
    expect(windowOf(PARTNER_AUTH, 43, 2)).toContain("intgk_");
    expect(windowOf(PARTNER_AUTH, 43, 2)).toContain("randomBytes(32)");
    // 70 characters is the documented issued length; confirm the arithmetic, not the prose.
    expect(`intgk_${createHash("sha256").update("x").digest("hex")}`.length).toBe(70);
  });

  test("the read-only proof routes the runbook names are read-only in code", () => {
    // A "harmless verification call" that writes a referral would be the worst
    // outcome of following this document, so the route is checked, not assumed.
    expect(lineAt("artifacts/api-server/src/routes/integration/inbound.ts", 258))
      .toContain('integrationInboundRouter.get("/catalogue", requireIntegrationPartnerAuth("diagnostic_referral:read")');
    expect(src("artifacts/api-server/src/routes/integration/inbound.ts").split("integrationInboundRouter.get(\"/catalogue\"")[1].slice(0, 1200))
      .not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });

  test("the gate's presence check does NOT cover these credentials, as (f) warns", () => {
    // (f) tells the operator that an unset Hope key surfaces only through
    // `credentials.safe`. If REQUIRED_ENV ever grows these names, that warning
    // becomes wrong and the check count in (b) changes meaning.
    const requiredEnv = windowOf("scripts/ops-preflight.mjs", 85, 15);
    for (const { name } of INTEGRATION_GUARDED) expect(requiredEnv).not.toContain(`"${name}"`);
    expect(src("scripts/ops-preflight.mjs")).toContain("auditEnvSecrets(merged");
  });
});

// ---------------------------------------------------------------------------
describe("the verification section names tools that exist and answer what it claims", () => {
  const named = [...DOC.matchAll(/`(scripts\/[A-Za-z0-9._/-]+\.(?:mjs|sh|json|ts))`/g)].map((m) => m[1]);

  test("every scripts/ path in the runbook is a real file", () => {
    expect(new Set(named).size).toBeGreaterThan(6);
    const missing = [...new Set(named)].filter((p) => !existsSync(at(p)));
    expect(missing, `nonexistent scripts cited: ${missing.join(", ")}`).toEqual([]);
  });

  test("the posture tool's documented exit codes are its actual return values", () => {
    expect(lineAt(POSTURE, 110).trim()).toBe("return 2;");
    expect(lineAt(POSTURE, 137)).toContain("verdict.rotateRequired || verdict.mismatch ? 1 : 0");
    // And it decides "match" on a digest prefix, which is why no value is printed.
    expect(lineAt(POSTURE, 73)).toContain("care.digestPrefix === hope.digestPrefix");
  });

  test("the posture tool prints lengths and prefixes, never values — proven by its own test", () => {
    expect(lineAt(POSTURE, 89)).toContain("${c.length} chars");
    expect(windowOf("scripts/integration-credential-posture.test.mjs", 119, 6))
      .toContain("prints no credential value on either side");
  });

  test("the published-digest list used by the gate is the one the runbook cites", () => {
    expect(Array.isArray(PUBLISHED_CREDENTIALS)).toBe(true);
    // The two Hope-edge credentials plus the eight care.env credentials measured
    // live on 2026-10-29. The count is pinned because every entry in here has to
    // appear in the runbook by prefix below: a digest added without prose is a
    // deploy blocker nobody told the operator about.
    expect(PUBLISHED_CREDENTIALS.length).toBe(10);
    for (const p of PUBLISHED_CREDENTIALS) {
      expect(p.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(DOC, `${p.label} is not cited in the runbook`).toContain(p.digest.slice(0, 12));
    }
  });
});
