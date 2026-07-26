import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// nginx caches a literal proxy_pass hostname for the worker's lifetime.
//
// `proxy_pass http://api:8080` resolves the name ONCE, at config load. When
// docker recreates the api container it can come back on a different IP and
// nginx keeps proxying the dead one — every /api, /uploads,
// /super-admin-portal and /health request 502s until the WEB container is
// restarted. Nothing reports it: /nginx-health is answered by nginx itself
// with `return 200`, so `docker ps` shows care-web healthy for the whole
// outage.
//
// This was measured against real nginx 1.24 with a stub DNS server:
//   - literal form:  still pinned to the dead address at t+60s, recovered
//                    only on SIGHUP
//   - variable form: followed the address change at t+7s with valid=5s
//
// Three things about the fix are easy to get wrong, and each one is silent:
//
//   1. A PARTIAL conversion is a no-op. If any proxy_pass keeps the literal
//      host:port, nginx registers an implicit upstream group under that name;
//      the variable form then matches that frozen group by name and never
//      queries the resolver. Measured: 3 of 4 converted -> all three stayed
//      pinned, zero DNS queries. `nginx -t` passes and traffic flows, so the
//      only symptom is that the bug is still there.
//
//   2. `$request_uri` is the WRONG variable form here. It ignores `rewrite`:
//      with `rewrite ^/api/old/(.*)$ /api/new/$1 break`, the $request_uri form
//      proxies /api/old/thing while the plain form correctly proxies
//      /api/new/thing. The plain form is also byte-identical to the literal
//      form on every request shape tested, because the literal form does NOT
//      normalize — it already forwards the raw client target verbatim.
//
//   3. An explicit URI part after a variable DROPS the query string.
//      `proxy_pass http://$api_upstream/health` turns /health?probe=1 into
//      /health. Removing the URI part is safe here precisely because the
//      location is an exact (`=`) match.
//
// And two ways to take the whole site down:
//   - `set` in http context is [emerg] — nginx refuses to start. It must be
//     inside server{}.
//   - Without resolver_timeout, an unreachable resolver makes every proxied
//     request hang for the 30s default (measured 30.005s) instead of failing
//     fast.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..", "..");
const conf = readFileSync(join(REPO, "docker", "nginx.conf"), "utf8");

/**
 * The config documents the bug it fixes, so absence assertions must run
 * against directives only — otherwise they match the explanation.
 */
const directives = conf
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("#"))
  .join("\n");

/** Every proxy_pass target in the file, in order. */
function proxyPassTargets(): string[] {
  return [...directives.matchAll(/^\s*proxy_pass\s+(\S+?);/gm)].map((m) => m[1]);
}

describe("the api upstream is resolved at request time, not frozen at boot", () => {
  test("a resolver is configured", () => {
    // 127.0.0.11 is docker's embedded DNS, present on the compose project
    // network. Without a resolver the variable form cannot resolve at all.
    expect(directives).toMatch(/^\s*resolver\s+127\.0\.0\.11\b/m);
  });

  test("re-resolution is bounded by valid=, and AAAA lookups are skipped", () => {
    const line = directives.match(/^\s*resolver\s+[^\n;]*;/m)?.[0] ?? "";
    expect(line, "valid= must cap how long a stale address is reused").toMatch(/valid=\d+s/);
    expect(line, "the api container is IPv4-only").toContain("ipv6=off");
  });

  test("resolver_timeout is set — without it a DNS outage hangs every request", () => {
    // Measured: unreachable resolver + no timeout = 30.005s per request before
    // failing. With a timeout it is a prompt 502 instead of stalled workers.
    expect(directives).toMatch(/^\s*resolver_timeout\s+\d+s;/m);
  });

  test("the upstream address lives in a variable set at server level", () => {
    expect(directives).toMatch(/^\s*set\s+\$api_upstream\s+"api:8080";/m);
  });

  test("`set` is inside server{}, not http context (http context is [emerg])", () => {
    // This file is included into http{} — that is why the `map` at the top
    // works. A `set` at the same level would stop nginx from starting at all.
    const serverStart = directives.indexOf("server {");
    const setPos = directives.search(/^\s*set\s+\$api_upstream/m);
    expect(serverStart, "server block must exist").toBeGreaterThan(-1);
    expect(setPos, "set must appear after `server {`").toBeGreaterThan(serverStart);
  });
});

describe("the conversion is complete — a partial one is a silent no-op", () => {
  test("no proxy_pass keeps the literal host:port form", () => {
    // One survivor re-freezes the shared upstream group by name and the
    // resolver is never consulted, with no error anywhere.
    for (const target of proxyPassTargets()) {
      expect(target, `proxy_pass ${target} must use the variable`).not.toMatch(/^https?:\/\/api:\d+/);
    }
  });

  test("every proxy_pass in the file goes through $api_upstream", () => {
    const targets = proxyPassTargets();
    expect(targets.length, "expected the four proxied locations").toBe(4);
    for (const target of targets) {
      expect(target).toContain("$api_upstream");
    }
  });

  test("the plain grep gate an operator would run really does return zero", () => {
    // The pre-flight check is `grep -c 'http://api:8080' docker/nginx.conf`.
    // It is run against the WHOLE file, comments included, so the comments
    // must not spell out the old literal or the gate can never pass.
    expect(conf).not.toContain("http://api:8080");
  });
});

describe("request-forwarding behaviour is unchanged", () => {
  test("no proxy_pass appends $request_uri — it would ignore rewrites", () => {
    for (const target of proxyPassTargets()) {
      expect(target, "$request_uri silently proxies the pre-rewrite URI").not.toContain("$request_uri");
    }
  });

  test("no proxy_pass carries a URI part — it would drop the query string", () => {
    // With a variable, an explicit URI part is passed as-is and $args is not
    // appended: /health?probe=1 would reach the API as /health.
    for (const target of proxyPassTargets()) {
      expect(target, `proxy_pass ${target} must be bare`).toMatch(/^http:\/\/\$api_upstream$/);
    }
  });

  test("the four proxied locations are still the expected ones", () => {
    // Guards against the change accidentally adding or removing a proxied
    // route while the assertions above still pass.
    for (const loc of ["location /api/", "location ^~ /uploads/", "location ^~ /super-admin-portal/", "location = /health"]) {
      expect(directives).toContain(loc);
    }
  });

  test("/nginx-health is still answered by nginx itself, never proxied", () => {
    // The web container's HEALTHCHECK hits this. It must stay independent of
    // the api container — and note it stays 200 during an upstream outage,
    // which is why this bug was invisible to `docker ps`.
    const idx = directives.indexOf("location = /nginx-health");
    expect(idx).toBeGreaterThan(-1);
    // Bound the slice at the NEXT location, or a fixed window would spill into
    // the `location = /health` block that follows and read its proxy_pass.
    const next = directives.indexOf("location ", idx + 1);
    const block = directives.slice(idx, next === -1 ? undefined : next);
    expect(block).toContain("return 200");
    expect(block).not.toContain("proxy_pass");
  });

  test("the X-Forwarded-Proto map and per-location headers are untouched", () => {
    // rpFromReq() builds WebAuthn's expectedOrigin from this header; the map
    // exists so a fronting TLS terminator's "https" is not overwritten.
    expect(directives).toMatch(/map \$http_x_forwarded_proto \$forwarded_proto/);
    const forwarded = [...directives.matchAll(/proxy_set_header\s+X-Forwarded-Proto\s+\$forwarded_proto;/g)];
    expect(forwarded.length, "all four proxied locations must forward the mapped scheme").toBe(4);
  });
});
