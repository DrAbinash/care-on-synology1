/**
 * routeCollisions.test.ts — no two routers mounted at the same prefix may claim
 * the same method + path.
 *
 * WHY THIS EXISTS
 *   routes/index.ts mounts several routers at one prefix. Express tries them in
 *   mount order and the FIRST match wins, so a later router's handler for the
 *   same method + path is never reached — no error, no warning, nothing in the
 *   logs. Three handlers in radiology.ts were dead this way:
 *
 *     GET  /api/radiology/critical-findings   → pacsEnterprise.ts won (different table)
 *     POST /api/radiology/critical-findings   → pacsEnterprise.ts won (different table)
 *     GET  /api/radiology/radiologists        → radiology-worklist-assignments.ts won
 *                                                 (different response shape)
 *
 *   The first two read and wrote radiology_critical_findings while the winner
 *   read and wrote critical_findings_alerts, so the path name promised one store
 *   and delivered another. A frontend comment repeated that promise as fact.
 *
 * WHAT THIS IS NOT
 *   It parses source text, because importing routes/index.ts evaluates
 *   @workspace/db, which throws without DATABASE_URL — so no DB-less test can
 *   introspect the live router stack. The consequence is a hard limit: only
 *   literal string paths are visible. A route registered from a variable or a
 *   template literal is invisible here, which is why the positive controls below
 *   matter — they fail loudly if the parser ever stops seeing the routes it is
 *   supposed to be comparing.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = resolve(HERE, "..");
/** core.autocrlf=true on the dev box means CRLF in the working tree and LF in
 *  CI; normalise so multi-line patterns match in both. */
const read = (abs: string) => readFileSync(abs, "utf8").replace(/\r\n/g, "\n");

const INDEX = read(resolve(HERE, "index.ts"));

type Route = { method: string; path: string; line: number; routerVar: string };
type Mount = { prefix: string; identifier: string; file: string; line: number; routes: Route[] };

/** Every identifier bound by an import clause, mapped to its resolved file.
 *  Handles default, named, aliased and mixed (`def, { a as b }`) forms — the
 *  mixed form is what ./abdm and ./electronic-film use. */
function importBindings(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /import\s+([\s\S]*?)\s+from\s+"([^"]+)";/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(INDEX))) {
    const clause = m[1].trim();
    const spec = m[2];
    if (!spec.startsWith(".") || clause.startsWith("type ")) continue;

    const abs = resolve(HERE, spec).replace(/\.js$/, "");
    const file = [abs + ".ts", abs + "/index.ts"].find((c) => existsSync(c));
    if (!file) continue;

    const braceAt = clause.indexOf("{");
    const defaultPart = (braceAt === -1 ? clause : clause.slice(0, braceAt)).replace(/,\s*$/, "").trim();
    if (defaultPart && !defaultPart.includes("*") && /^\w+$/.test(defaultPart)) out.set(defaultPart, file);

    if (braceAt !== -1) {
      const named = clause.slice(braceAt + 1, clause.lastIndexOf("}"));
      for (const part of named.split(",")) {
        const bits = part.trim().split(/\s+as\s+/);
        const local = (bits[1] ?? bits[0]).trim();
        if (local && /^\w+$/.test(local) && local !== "type") out.set(local, file);
      }
    }
  }
  return out;
}

/** The `Router()` instances declared in a file — routes are collected per
 *  variable so a file declaring two routers is still attributed correctly. */
function routerVars(src: string): string[] {
  const vars: string[] = [];
  const re = /(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(?:express\.)?Router\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) vars.push(m[1]);
  return vars;
}

function routesIn(file: string): Route[] {
  const src = read(file);
  const vars = routerVars(src);
  if (vars.length === 0) return [];
  const names = vars.map((v) => v.replace(/\$/g, "$$")).join("|");
  const re = new RegExp(String.raw`\b(` + names + String.raw`)\.(get|post|put|patch|delete|all)\(\s*"([^"]+)"`, "g");
  const out: Route[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push({ routerVar: m[1], method: m[2].toUpperCase(), path: m[3], line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** Which `Router()` instance a mounted identifier actually names.
 *
 *  A file may declare more than one router and export each under its own name —
 *  webauthn.ts does exactly that (publicRouter for the key-login endpoints,
 *  protectedRouter for credential enrolment). Attributing every route in the
 *  file to every mount of it makes two mounts of the SAME file at the same
 *  prefix look like they shadow each other, when Express in fact falls through
 *  from the first router to the second. Returns null when the link cannot be
 *  resolved, and the caller then keeps the whole file's route table: that
 *  over-claims, so it can produce a loud false positive but never a silent
 *  miss. */
function routerVarFor(file: string, identifier: string): string | null {
  const src = read(file);
  const vars = routerVars(src);
  if (vars.length === 0) return null;
  if (vars.length === 1) return vars[0];
  // `export const x = Router();` — the export IS the declaration, so the router
  // variable is the identifier itself. Without this arm a file that declares two
  // routers inline (routes/totp.ts) resolves to nothing, the mount falls back to
  // "every route in the file", and the dual mount reports 5 phantom shadowings.
  for (const m of src.matchAll(/export\s+(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(?:express\.)?Router\s*\(/g)) {
    if (m[1] === identifier && vars.includes(identifier)) return identifier;
  }
  for (const m of src.matchAll(/export\s+(?:const|let)\s+(\w+)\s*=\s*(\w+)\s*(?::[^=]+)?;/g)) {
    if (m[1] === identifier && vars.includes(m[2])) return m[2];
  }
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(",")) {
      const bits = part.trim().split(/\s+as\s+/);
      const local = (bits[1] ?? bits[0]).trim();
      const orig = bits[0].trim();
      if (local === identifier && vars.includes(orig)) return orig;
    }
  }
  return null;
}

function mounts(): { resolved: Mount[]; unresolved: { prefix: string; line: number }[] } {
  const bindings = importBindings();
  const resolved: Mount[] = [];
  const unresolved: { prefix: string; line: number }[] = [];
  const re = /router\.use\(\s*"([^"]+)"\s*,([\s\S]*?)\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(INDEX))) {
    const prefix = m[1];
    const line = INDEX.slice(0, m.index).split("\n").length;
    // The router is the LAST identifier in the argument list; everything before
    // it is middleware.
    const ids = [...m[2].matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map((x) => x[1]).reverse();
    const id = ids.find((i) => bindings.has(i));
    if (!id) { unresolved.push({ prefix, line }); continue; }
    const file = bindings.get(id)!;
    const varName = routerVarFor(file, id);
    const all = routesIn(file);
    resolved.push({
      prefix,
      identifier: id,
      file,
      line,
      routes: varName ? all.filter((r) => r.routerVar === varName) : all,
    });
  }
  return { resolved, unresolved };
}

const { resolved: MOUNTS, unresolved: UNRESOLVED } = mounts();

/** Mounts sharing a prefix, in index.ts order — i.e. Express's precedence. */
function sharedPrefixes(): Map<string, Mount[]> {
  const byPrefix = new Map<string, Mount[]>();
  for (const mo of MOUNTS) {
    if (!byPrefix.has(mo.prefix)) byPrefix.set(mo.prefix, []);
    byPrefix.get(mo.prefix)!.push(mo);
  }
  return new Map([...byPrefix].filter(([, list]) => list.length > 1));
}

const SHARED = sharedPrefixes();
/** posix-relative path, so the lookups below read the same on the Windows dev
 *  box (backslashes) and the Linux CI runner. */
const where = (file: string, line: number) => `${relative(API_SRC, file).split(sep).join("/")}:${line}`;
const routerNamed = (suffix: string): Mount => {
  const found = MOUNTS.filter((mo) => relative(API_SRC, mo.file).split(sep).join("/").endsWith(suffix));
  if (found.length !== 1) throw new Error(`expected exactly one mounted router ending "${suffix}", found ${found.length}`);
  return found[0];
};

describe("route table — the parser is actually reading the routers", () => {
  it("resolved every mount in routes/index.ts to a source file", () => {
    // If this fails the resolver has drifted (a new import form) and the
    // collision checks below are comparing an incomplete table.
    expect(UNRESOLVED.map((u) => `${u.prefix} (index.ts:${u.line})`)).toEqual([]);
    expect(MOUNTS.length).toBeGreaterThan(150);
  });

  it("sees a meaningful number of routes, and both sides of the historic collision", () => {
    const total = MOUNTS.reduce((n, mo) => n + mo.routes.length, 0);
    expect(total).toBeGreaterThan(1000);

    const pacs = routerNamed("pacsEnterprise.ts");
    const rad = routerNamed("routes/radiology.ts");
    expect(pacs.routes.some((r) => r.method === "GET" && r.path === "/critical-findings")).toBe(true);
    expect(rad.routes.some((r) => r.method === "POST" && r.path === "/studies/:id/prelim")).toBe(true);
  });

  it("finds the prefixes that are mounted more than once", () => {
    // Positive control on the grouping: /radiology has always carried several
    // routers, so if this list empties the grouping broke, not the routes.
    expect(SHARED.has("/radiology")).toBe(true);
    expect(SHARED.size).toBeGreaterThanOrEqual(5);
  });

  it("splits one file's routes between its own routers, so a dual mount is not read as shadowing", () => {
    // routes/webauthn.ts is mounted twice at /auth/webauthn: the login endpoints
    // anonymously, the enrolment + management endpoints behind staff auth. If the
    // attribution ever collapses, one of these two lists empties and the
    // collision check for that prefix would pass for the wrong reason.
    const byId = new Map(MOUNTS.map((mo) => [mo.identifier, mo]));
    const pub = byId.get("webauthnPublicRouter");
    const prot = byId.get("webauthnRouter");
    expect(pub, "webauthnPublicRouter is not mounted").toBeTruthy();
    expect(prot, "webauthnRouter is not mounted").toBeTruthy();
    expect(pub!.routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      "POST /authenticate/begin",
      "POST /authenticate/complete",
    ]);
    expect(prot!.routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      "DELETE /credentials/:id",
      "GET /credentials",
      "POST /register/begin",
      "POST /register/complete",
    ]);
  });

  it("keeps exactly one TOTP route outside the staff gate", () => {
    // routes/totp.ts is the second dual-mounted file, and the split is the whole
    // point of it: /verify-login CREATES the session, so mounting it behind
    // requireStaffAuth made every admin with TOTP unable to log in. This list is
    // the ratchet — a second route joining the public router needs a deliberate
    // decision, not a passing test.
    const byId = new Map(MOUNTS.map((mo) => [mo.identifier, mo]));
    const pub = byId.get("totpPublicRouter");
    const gated = byId.get("totpRouter");
    expect(pub, "totpPublicRouter is not mounted").toBeTruthy();
    expect(gated, "totpRouter is not mounted").toBeTruthy();
    expect(pub!.routes.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /verify-login"]);
    expect(gated!.routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      "GET /status",
      "POST /disable",
      "POST /setup",
      "POST /verify",
    ]);
  });
});

describe("route table — no router may shadow another on a shared prefix", () => {
  for (const [prefix, list] of SHARED) {
    it(`${prefix} (${list.map((l) => l.identifier).join(", ")})`, () => {
      const claims = new Map<string, { mount: Mount; route: Route }>();
      const collisions: string[] = [];

      for (const mount of list) {
        for (const route of mount.routes) {
          const key = `${route.method} ${route.path}`;
          const first = claims.get(key);
          if (first) {
            collisions.push(
              `${prefix}${route.path} [${route.method}]\n` +
              `      served by  ${where(first.mount.file, first.route.line)} (${first.mount.identifier})\n` +
              `      UNREACHABLE ${where(mount.file, route.line)} (${mount.identifier}) — mounted later, never called`,
            );
          } else {
            claims.set(key, { mount, route });
          }
        }
      }

      expect(collisions, `${collisions.length} shadowed handler(s):\n  ` + collisions.join("\n  ")).toEqual([]);
    });
  }
});

describe("route table — the critical-findings surfaces stay separated", () => {
  it("radiology.ts no longer serves /critical-findings on any method", () => {
    const rad = routerNamed("routes/radiology.ts");
    expect(rad.routes.filter((r) => r.path.startsWith("/critical-findings"))).toEqual([]);
  });

  it("radiology.ts no longer serves /radiologists", () => {
    const rad = routerNamed("routes/radiology.ts");
    expect(rad.routes.filter((r) => r.path === "/radiologists")).toEqual([]);
    // the per-id subspecialty routes are a different path and must survive
    expect(rad.routes.some((r) => r.path === "/radiologists/:id/subspecialties")).toBe(true);
  });

  it("the prelim-report auto-detect that writes radiology_critical_findings survives", () => {
    // Deleting the dead HTTP surface must not delete the live writer. This is
    // the one path in radiology.ts that still flags a critical finding.
    const src = read(resolve(HERE, "radiology.ts"));
    expect(src).toContain("scanForCriticalFindings(body.reportText)");
    expect(src).toContain("await flagCriticalFinding(f);");
  });

  it("each remaining surface keeps its own acknowledge route", () => {
    const workflow = MOUNTS.find((mo) => mo.file.endsWith("radiologyWorkflow.ts"))!;
    const pacs = MOUNTS.find((mo) => mo.file.endsWith("pacsEnterprise.ts"))!;
    expect(workflow.routes.some((r) => r.method === "PATCH" && r.path === "/critical-alerts/:id/acknowledge")).toBe(true);
    expect(pacs.routes.some((r) => r.method === "POST" && r.path === "/critical-findings/:id/acknowledge")).toBe(true);
  });

  it("no route file in this directory was left unreadable by the parser", () => {
    // Guards against a wholesale parser failure masquerading as "no collisions".
    const files = readdirSync(HERE).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const withRoutes = files.filter((f) => routesIn(resolve(HERE, f)).length > 0);
    expect(withRoutes.length).toBeGreaterThan(files.length * 0.5);
  });
});
