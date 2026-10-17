import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// docker/nginx.conf blocks POST /api/ledgers/<numeric-id>/reset at the edge.
//
// WHY IT EXISTS. That route is a second implementation of the book reset the
// Super Admin pen drive already provides (POST /api/super-admin/books/<id>/reset).
// Unlike the pen-drive one it is not a transaction: it issues eight separate
// autocommitted DELETEs and no try/catch, so on a book holding one
// form_f_records page it aborts on the LAST statement with everything earlier
// already committed. Measured on a scratch database built by
// scripts/apply-all-migrations.mjs — HTTP 500, patients 2, bills 0, orders 0,
// order_tests 0, bill_audits 0, appointments 0, and no audit_logs row written
// for the attempt or the success. It also leaves accounting vouchers pointing at
// deleted bills (vouchers.bill_id is ON DELETE SET NULL) and does not rewind the
// book's bill-number sequence the portal's UI promises to reset.
//
// The pen-drive route deletes the same data safely, so blocking this one loses
// no capability. It has no caller: the ERP screens only ever GET /api/ledgers,
// the portal calls the books path (__super_admin_quarantine/super-admin-portal/
// src/pages/Books.tsx:138), the built pen-drive bundle contains exactly one reset
// URL (the books one), and cron, the integrations and the test suite never
// address it. The generated client does export `resetLedger`
// (lib/api-client-react/src/generated/api.ts:8400) because the spec still lists
// the operation — but every occurrence of that symbol is inside the generated
// file and nothing imports it. Which is also why the refusal is a legible 410
// with a code rather than a bare 403: the next person to reach for that helper is
// told where the reset actually lives.
//
// THE SIX WAYS THIS RULE CAN BE WRONG THAT ARE WORTH PINNING. Items 1 and 2 were
// both found by running the repo's real router and the real zod schema against the
// config, not by reading either — the rule looked correct and passed every shape a
// person would think of first.
//   1. CASE. Express 5 lowercases req.method before the route lookup and matches
//      paths without regard to case, so `post /api/ledgers/2/reset` and
//      `POST /api/ledgers/2/RESET` both execute the deletes. A `~` (case-sensitive)
//      map key refuses the two spellings it recognises and forwards the others.
//      The key is `~*`, which makes the edge refuse the same set Express would run.
//   2. A DIGITS-ONLY ID. ResetLedgerParams is `zod.coerce.number()`, and measured
//      against that schema "2 " -> 2, "1e1" -> 10, "-1" -> -1, "2.5" -> 2.5. So
//      `/api/ledgers/2%20/reset` — which $uri has already decoded to "2 " — deletes
//      book 2 while a [0-9]+ test calls it "not the reset route". Hence `[^/]+`.
//   3. MATCHING $request_uri INSTEAD OF $uri. $request_uri is still
//      percent-encoded, so nothing there is decoded: the two forms above disagree
//      about what the request is, and the map would be deciding on a string the
//      router never saw. $uri is decoded and normalised.
//   4. BLOCKING EVERY METHOD. The requirement is POST only. A regex
//      `location ~ /reset$` cannot express that without a second proxy_pass,
//      and nginxUpstreamResolution.test.ts pins the proxied locations at exactly
//      five because a sixth is how the upstream-freeze fix silently regresses.
//      So the decision is made in a `map` and the location keeps one `if`+`return`.
//   5. CATCHING THE PEN-DRIVE ROUTE. /api/super-admin/books/<id>/reset must keep
//      working; it is the safe one, and blocking it would leave the clinic with
//      no way to empty a book at all.
//   6. `default_type` IN THE WRONG CONTEXT. It sets the type for responses nginx
//      generates itself, so a copy at server level would also relabel a 502 from a
//      recreated api container as JSON while it is still nginx's HTML. It CANNOT go
//      next to the `return` either: `default_type` is valid in http/server/location
//      only, and inside `if` nginx refuses to start — `[emerg] "default_type"
//      directive is not allowed here`, which crash-looped care-web (39 restarts)
//      until main 0bca78ca moved it to the location. So the pinned placement is
//      location level, first directive in the block, one occurrence file-wide.
//
// NOT PROVABLE HERE: that nginx really answers 410. There is no nginx on this
// machine and CI has none — checked 2026-10-16: no docker CLI, no nginx.exe under
// Program Files/AppData/scoop, and the WSL Ubuntu distro has neither nginx nor
// passwordless sudo to install one. So this file checks the rule's shape and
// replays the map's own regex against request cases. The wire behaviour is proven
// at activation instead, and the PR says which command proves which half: a
// disposable `nginx -t` on this file, `nginx -T` on the running container to show
// the rebuilt image really carries the rule (this config is COPYed into the image,
// so `nginx -s reload` alone would validate the previous one), then the 410 for
// POST /api/ledgers/2/reset against the non-410 for the pen-drive path.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..", "..");
const conf = readFileSync(join(REPO, "docker", "nginx.conf"), "utf8");

/** Directives only — the file documents the rule it implements, so absence
 *  assertions must never be able to match the explanation above it. */
const directives = conf
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("#"))
  .join("\n");

/** The map block that decides the block, as authored. */
function legacyResetMap(): { source: string; regex: string } {
  const at = directives.search(/map\s+("[^"]+"|\$\S+)\s+\$legacy_ledger_reset_blocked\s*\{/);
  expect(at, "expected a map producing $legacy_ledger_reset_blocked").toBeGreaterThan(-1);
  const header = directives.slice(at, directives.indexOf("{", at));
  const body = directives.slice(directives.indexOf("{", at));
  const close = body.indexOf("}");
  const block = body.slice(0, close + 1);
  const m = block.match(/"(~[^"]+)"/);
  expect(m, "the map must match on a regex key").not.toBeNull();
  const source = header.match(/map\s+("[^"]+"|\$\S+)/)?.[1] ?? "";
  return { source, regex: m![1] };
}

/** Replay the map: nginx treats "0" and "" as false, any other value true. */
function blocked(method: string, uri: string): boolean {
  const { regex } = legacyResetMap();
  // `~` is a case-sensitive PCRE key, `~*` case-insensitive; the flag belongs to
  // the sigil, and Express 5 matches the route case-insensitively on both the
  // method and the path — so a `~` key here refuses a different set of requests
  // than the handler would have executed. See the ~* paragraph in nginx.conf.
  const ci = regex.startsWith("~*");
  return new RegExp(regex.slice(ci ? 2 : 1), ci ? "i" : "").test(method + uri);
}

function apiLocationBlock(): string {
  const at = directives.indexOf("location /api/ {");
  expect(at, "expected the /api/ location").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = at + "location /api/ {".length; i < directives.length; i += 1) {
    if (directives[i] === "{") depth += 1;
    else if (directives[i] === "}") {
      if (depth === 0) return directives.slice(at, i + 1);
      depth -= 1;
    }
  }
  throw new Error("unterminated /api/ location");
}

/** The text between an `if (…)` at `ifAt` and its own closing brace. */
function ifBodyOf(block: string, ifAt: number): string {
  const open = block.indexOf("{", ifAt);
  expect(open, "the if has no body").toBeGreaterThan(ifAt);
  let depth = 0;
  for (let i = open; i < block.length; i += 1) {
    if (block[i] === "{") depth += 1;
    else if (block[i] === "}") {
      depth -= 1;
      if (depth === 0) return block.slice(open + 1, i);
    }
  }
  throw new Error("unterminated if body");
}

describe("the legacy ledger reset map", () => {
  test("is declared at http level, before server{}", () => {
    // Same rule as the forwarded_proto map above it: a `map` inside server{} is
    // [emerg] and nginx refuses to start, so a misplaced edit takes the site down.
    const serverStart = directives.indexOf("server {");
    expect(directives.indexOf("$legacy_ledger_reset_blocked"), "map must precede server{").toBeLessThan(serverStart);
  });

  test("sources the method AND the normalised uri, never request_uri", () => {
    const { source } = legacyResetMap();
    expect(source).toContain("$request_method");
    expect(source).toContain("$uri");
    expect(source, "$request_uri is still percent-encoded — %32 would evade [0-9]+").not.toContain("$request_uri");
  });

  test("is anchored, any-non-slash-id, case-insensitive, and defaults to not-blocked", () => {
    const { regex } = legacyResetMap();
    // `~*` is nginx's case-insensitive regex key; the anchor has to follow it,
    // and a bare `^` here would be an unanchored match instead.
    expect(regex, "case-insensitive regex key sigil then a start anchor").toMatch(/^~\*\^/);
    expect(regex, "must end-anchor the PCRE or /api/ledgers/2/reset/extra is caught too").toMatch(/\/reset\/\?\$$/);
    expect(regex).toContain("/api/ledgers/[^/]+/reset");
    expect(regex, "a digits-only id leaves the coercions open — see the 2%20 case")
      .not.toContain("[0-9]");
    const blockBody = directives.slice(
      directives.indexOf("$legacy_ledger_reset_blocked"),
      directives.indexOf("$legacy_ledger_reset_blocked") + 400,
    );
    expect(blockBody).toMatch(/default\s+0/);
  });
});

describe("the blocked requests", () => {
  test("POST to a numeric book id, with and without a trailing slash", () => {
    for (const uri of [
      "/api/ledgers/1/reset",
      "/api/ledgers/2/reset",
      "/api/ledgers/2/reset/",
      "/api/ledgers/987654/reset",
    ]) {
      expect(blocked("POST", uri), `${uri} must be blocked`).toBe(true);
    }
  });

  test("the case variants Express itself would have executed", () => {
    // This is the one that a hand-verified rule misses, and it was found by
    // running the repo's real router rather than by reading it: Express 5
    // lowercases req.method before the route lookup and matches paths ignoring
    // case, so `post` and `/RESET` both reach ledgers.ts:280 and delete the book.
    // A case-sensitive `~` key refused those two while still refusing the normal
    // spelling — the rule looked correct, passed nginx -t, and left the route open.
    for (const [method, uri] of [
      ["post", "/api/ledgers/2/reset"],
      ["PoSt", "/api/ledgers/2/reset"],
      ["POST", "/api/ledgers/2/RESET"],
      ["POST", "/api/ledgers/2/Reset"],
      ["post", "/api/ledgers/2/RESET"],
      ["POST", "/api/LEDGERS/2/reset"],
    ]) {
      expect(blocked(method, uri), `${method} ${uri} must be blocked`).toBe(true);
    }
  });
});

describe("the requests that must keep flowing", () => {
  test("every other method on the same path", () => {
    // Requirement: block POST only. A regex location could not do this without a
    // second proxy_pass, which is why the rule lives in a map.
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      expect(blocked(method, "/api/ledgers/2/reset"), `${method} must not be blocked`).toBe(false);
    }
  });

  test("the pen-drive reset route — the safe one, and the clinic's only way to empty a book", () => {
    for (const uri of [
      "/api/super-admin/books/2/reset",
      "/api/super-admin/books/2/reset/",
      "/api/super-admin/books/2/set-walk-in",
    ]) {
      expect(blocked("POST", uri), `${uri} must NOT be blocked`).toBe(false);
    }
  });

  test("neighbouring ledger and money routes, unchanged", () => {
    for (const uri of [
      "/api/ledgers",
      "/api/ledgers/2",
      "/api/ledgers/2/assign-doctors",
      // A REAL clinical POST whose name contains "reset" and whose traffic goes
      // through this same /api/ location: routes/index.ts:885 mounts it at
      // /api/radiology/presentation-templates/reset-default, and it is the
      // report-presentation template's own "make this the default" action
      // (presentation-templates.ts:221). Anything that widens this rule past
      // /api/ledgers/<id>/reset — a bare `.*reset`, a second map key — takes that
      // away from the reporting workspace, which is not this PR's business.
      "/api/radiology/presentation-templates/reset-default",
      "/api/ledgers/2/reset/extra",
      "/api/ledgers/2/resets",
      "/api/ledgers/2/bills",
      "/api/bills/5",
      "/api/billing/save",
      "/api/accounting/vouchers/9",
      "/api/day-close/my-close",
      "/api/staff/4",
      "/api/users/4",
      "/api/patients/7",
    ]) {
      expect(blocked("POST", uri), `${uri} must not be blocked`).toBe(false);
    }
  });

  test("every id spelling the handler would coerce to a book id", () => {
    // The reason the pattern is `[^/]+` and not `[0-9]+`. ResetLedgerParams is
    // `zod.coerce.number()` (lib/api-zod/src/generated/api.ts:3519), measured
    // against the real schema: "" -> 0, " " -> 0, "2 " -> 2, "-1" -> -1,
    // "2.5" -> 2.5, "1e1" -> 10; only "2abc" and non-ASCII digits are refused.
    // So `POST /api/ledgers/2%20/reset` decodes to "2 ", coerces to 2 and wipes
    // book 2 — a digits-only edge rule reads that as "not the reset route" and
    // forwards it. These are typed as the raw request target and decoded the way
    // nginx $uri does, because that is the value the map sees.
    const rawForms = [
      "/api/ledgers/2/reset",
      "/api/ledgers/2%20/reset",
      "/api/ledgers/%20/reset",
      "/api/ledgers/-1/reset",
      "/api/ledgers/2.5/reset",
      "/api/ledgers/1e1/reset",
      "/api/ledgers/%32/reset",
    ];
    for (const raw of rawForms) {
      expect(blocked("POST", decodeURIComponent(raw)), `${raw} must be blocked`).toBe(true);
    }
    // $uri is normalised as well as decoded, so the request line
    // /api/ledgers/2/../2/reset reaches the map already collapsed to
    // /api/ledgers/2/reset. That normalised form is what is asserted here — a
    // decodeURIComponent() of it would still contain the ".." segment and would
    // test something nginx never forwards.
    expect(blocked("POST", "/api/ledgers/2/reset"), "the dot-dot form, as $uri collapses it").toBe(true);
  });
});

describe("the /api/ location stays a single proxied block", () => {
  test("the rule is one if/return and nothing else", () => {
    const block = apiLocationBlock();
    const ifs = [...block.matchAll(/^\s*if\s*\(([^)]*)\)\s*\{/gm)];
    expect(ifs.length, "exactly one if in the /api/ location").toBe(1);
    expect(ifs[0][1]).toContain("$legacy_ledger_reset_blocked");
    expect(block, "410 Gone — the resource is retired, not forbidden forever").toMatch(/return\s+410\b/);
    expect(block.match(/return\s+4\d\d/g)?.length).toBe(1);
  });

  test("default_type is at location level, outside the if, and once in the file", () => {
    const block = apiLocationBlock();
    const at = block.indexOf("default_type");
    expect(at, "the refusal has no content type — a 410 would be announced as text").toBeGreaterThan(-1);

    // `default_type` is valid in http, server and location context. It is NOT valid
    // inside `if`, and that is not a style preference: with the directive inside the
    // if, care-web crash-looped on `nginx: [emerg] "default_type" directive is not
    // allowed here` (39 restarts; fixed on main by 0bca78ca, which moved it here).
    // So this test pins the legal placement AND, directly, the condition that took
    // the clinic's web container down.
    const ifAt = block.search(/^\s*if\s*\(\$legacy_ledger_reset_blocked\)/m);
    expect(ifAt, "the refusal lost its if").toBeGreaterThan(-1);
    expect(at, "default_type must precede the if, not sit inside it").toBeLessThan(ifAt);
    expect(ifBodyOf(block, ifAt), "default_type inside the if is an nginx config error").not.toContain("default_type");

    // One occurrence, file-wide. A second copy hoisted to server{} would apply to
    // every response nginx generates in that scope — a 502 from a recreated api
    // container announced as JSON while still being nginx's HTML.
    expect(
      [...directives.matchAll(/^\s*default_type\s/gm)].length,
      "default_type must appear only in the /api/ location, nowhere else in the file",
    ).toBe(1);

    // The consequence of the legal placement, stated rather than wished away: the
    // type now covers the whole location, so any error nginx itself generates for an
    // /api/ request carries application/json. A proxied upstream response is
    // untouched — `default_type` applies only where no other source set the type.
    expect(block.slice(at, ifAt), "the directive must be the location's own, not the map's").toMatch(
      /^\s*default_type\s+application\/json\s*;/,
    );
  });

  test("the refusal explains itself to an operator, in the shape the ERP reads", () => {
    const body = apiLocationBlock().match(/return\s+410\s+'([^']*)'/)?.[1] ?? "";
    expect(body).toContain("legacy_ledger_reset_retired");
    expect(body.toLowerCase()).toContain("pen drive");
  });

  test("no location was added for this path, and the five proxied blocks are intact", () => {
    const added = [...directives.matchAll(/^\s*location\s+[^\n]*reset[^\n]*\{/gm)];
    expect(added.length, "a regex location for /reset would own every method").toBe(0);
    const targets = [...directives.matchAll(/^\s*proxy_pass\s+(\S+?);/gm)].map((m) => m[1]);
    expect(targets.length, "still exactly five proxied locations").toBe(5);
    for (const t of targets) expect(t).toContain("$api_upstream");
    const forwarded = [...directives.matchAll(/proxy_set_header\s+X-Forwarded-Proto\s+\$forwarded_proto;/g)];
    expect(forwarded.length).toBe(5);
  });

  test("an insertion here is a line-number citation hazard, so re-check the one that exists", () => {
    // Anything added above the health location shifts `scripts/deploy-health.mjs`,
    // which cites a docker/nginx.conf line number in a comment. It said 203 before
    // this rule; the rule and its why-comments moved the block to 296, and this
    // assertion caught that shift on the very next edit — which is the whole point.
    // No gate asserted the comment before, so a stale pointer would have pointed a
    // future operator at the wrong directive. If this fails, the config moved: fix
    // the citation in deploy-health.mjs. Do not pin a number here instead.
    const living = conf.split("\n").findIndex((l) => l.includes("location = /nginx-health")) + 1;
    const cited = readFileSync(join(REPO, "scripts", "deploy-health.mjs"), "utf8").match(
      /docker\/nginx\.conf:(\d+)/,
    )?.[1];
    expect(cited ?? String(living), "deploy-health.mjs cites a stale docker/nginx.conf line").toBe(String(living));
  });
});
