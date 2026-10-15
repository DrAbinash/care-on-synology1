/**
 * Tests for scripts/hope-route-probe.mjs.
 *
 * Two of these cases exist because the FIRST live run of this probe lied. On the
 * production box on 2026-10-15 it printed `reachable — HTTP 319` for a request that
 * took 319 ms, and `reachable — connected` for a request inside `care-api` that had
 * no readable status at all. Both came from accepting any number as a status and a
 * zero exit as success. The labelled contract below (`HTTP 401 12ms`,
 * `ERR ENOTFOUND 5ms`) is what the two probe vantages actually emit, and an answer
 * the probe cannot read is now UNKNOWN rather than a pass — because a probe that
 * reports a hairpin-blocked route as reachable is worse than no probe: the outbox,
 * the preflight and the operator would all inherit that lie.
 */
import { test, expect, describe } from "vitest";
import {
  PASS,
  FAIL_ROUTE,
  UNKNOWN,
  classifyHost,
  originOf,
  candidatesFor,
  interpretAttempt,
  hostAttempt,
  buildRows,
  evaluate,
  render,
  main,
  CONTAINER_SNIPPET,
  parseArgs,
  USAGE,
} from "./hope-route-probe.mjs";

const LAN = "http://192.168.1.137:7080/api/integration/care-callback";
const DNS = { dns: "hope_hospital_app", dnsPort: "5000" };
const DNS_URL = "http://hope_hospital_app:5000/api/integration/care-callback";
// What the two vantages really print, labels included: `HTTP 200 12ms`, or curl's
// exit code with no stdout at all.
const ok = (ms = "12ms") => ({ code: 0, stdout: `HTTP 200 ${ms}` });
const hairpin = () => ({ code: 28, stderr: "Connection timed out" });

describe("classifyHost and originOf — what kind of address this is", () => {
  test("R1 a same-box LAN IP is not the permanent form; a network alias is", () => {
    expect(classifyHost("192.168.1.137")).toEqual({ kind: "lan-ip", permanent: false });
    expect(classifyHost("10.0.3.9").kind).toBe("lan-ip");
    expect(classifyHost("172.16.0.5").kind).toBe("lan-ip");
    expect(classifyHost("172.32.0.5").kind).toBe("public-ip");
    expect(classifyHost("hope_hospital_app")).toEqual({ kind: "container-dns", permanent: true });
    expect(classifyHost("localhost").kind).toBe("loopback");
    expect(classifyHost("::1").kind).toBe("loopback");
    expect(classifyHost("127.0.0.1").kind).toBe("loopback");
    expect(classifyHost("").kind).toBe("empty");
  });

  test("R1b originOf defaults the port by scheme and refuses a non-HTTP one", () => {
    expect(originOf("https://hope.example/cb")).toMatchObject({ host: "hope.example", port: "443", path: "/cb" });
    expect(originOf(LAN)).toMatchObject({ host: "192.168.1.137", port: "7080" });
    expect(originOf("file:///etc/passwd")).toBeNull();
    expect(originOf("not a url")).toBeNull();
    expect(originOf("")).toBeNull();
  });
});

describe("candidatesFor — what gets attempted", () => {
  test("R3 the configured URL is first and keeps its path; a candidate needs name AND port", () => {
    const c = candidatesFor({ url: LAN, ...DNS });
    expect(c.map((x) => x.role)).toEqual(["configured", "candidate"]);
    expect(c[0].url).toBe(LAN);
    expect(c[1].url).toBe(DNS_URL);
    expect(candidatesFor({ url: LAN, dns: "hope_hospital_app" })).toHaveLength(1);
    expect(candidatesFor({ url: LAN, dnsPort: "5000" })).toHaveLength(1);
    expect(candidatesFor({})).toEqual([]);
  });
});

describe("interpretAttempt — what one labelled answer means", () => {
  test("R4 ANY HTTP status is a route that exists, including one that refuses the request", () => {
    // The probe sends no signature on purpose; 401 is the peer proving it is reachable.
    expect(interpretAttempt({ code: 0, stdout: "HTTP 200 12ms" })).toEqual({ outcome: PASS, detail: "HTTP 200" });
    expect(interpretAttempt({ code: 0, stdout: "HTTP 401 9ms" })).toEqual({ outcome: PASS, detail: "HTTP 401" });
    expect(interpretAttempt({ code: 0, stdout: "HTTP 404 3ms" }).outcome).toBe(PASS);
  });

  test("R4b REGRESSION: a duration is not a status. The live run printed HTTP 319 for 319 ms.", () => {
    expect(interpretAttempt({ code: 0, stdout: "319ms" }).outcome).not.toBe(PASS);
    expect(interpretAttempt({ code: 0, stdout: "000" }).outcome).not.toBe(PASS);
    expect(interpretAttempt({ code: 0, stdout: "2000ms" }).outcome).not.toBe(PASS);
    expect(interpretAttempt({ code: 0, stdout: "" }).outcome).toBe("not-attempted");
    // and hostAttempt is the only thing allowed to add the label, from a real status
    expect(hostAttempt({ code: 0, stdout: "200" }).stdout).toBe("HTTP 200");
    expect(hostAttempt({ code: 0, stdout: "000" }).stdout).toBe("");
    expect(hostAttempt({ code: 7, stdout: "000" }).stdout).toBe("000");
  });

  test("R4c REGRESSION: exit 0 with no readable status is never reported as success", () => {
    // The first live run printed `reachable — connected` for exactly this row.
    const r = interpretAttempt({ code: 0, stdout: "AbortError 5002ms" });
    expect(r.outcome).toBe("refused");
    expect(r.detail).not.toMatch(/connected/);
    expect(r.detail).toMatch(/AbortError/);
    // An answer with no status and no known word is UNKNOWN, not a blocked route either.
    expect(interpretAttempt({ code: 0, stdout: "who knows 41ms" }).outcome).toBe("not-attempted");
    // a labelled error is still a route failure, and says why
    expect(interpretAttempt({ code: 0, stdout: "ERR AbortError 5003ms" })).toEqual({
      outcome: "refused",
      detail: "AbortError — the request was abandoned at its own deadline — the same shape as a timeout",
    });
  });

  test("R4d each failure names itself in the words an operator can search for", () => {
    // curl reports by exit code: 28 timeout, 6 unresolvable, 7 refused.
    expect(interpretAttempt({ code: 28, stderr: "curl: (28) Connection timed out" }).detail)
      .toMatch(/ETIMEDOUT.*hairpin/);
    expect(interpretAttempt({ code: 6, stderr: "curl: (6) Could not resolve host: hope_hospital_app" }).detail)
      .toMatch(/ENOTFOUND.*does not resolve/);
    expect(interpretAttempt({ code: 7, stderr: "curl: (7) Failed to connect" }).detail)
      .toMatch(/ECONNREFUSED.*nothing is listening/);
    // the container vantage reports Node's own errno names, which must read the same
    expect(interpretAttempt({ code: 0, stdout: "ERR ENOTFOUND 4ms" }).detail).toMatch(/ENOTFOUND.*does not resolve/);
    expect(interpretAttempt({ code: 0, stdout: "ERR EHOSTUNREACH 4ms" }).detail).toMatch(/no path/);
  });

  test("R4e a DOMException's numeric code is named, because 23 is not searchable", () => {
    // What the production box actually printed before the snippet was fixed.
    const r = interpretAttempt({ code: 0, stdout: "ERR 23 5004ms" });
    expect(r.outcome).toBe("refused");
    expect(r.detail).toMatch(/TimeoutError/);
    expect(r.detail).toMatch(/hairpin/);
    expect(interpretAttempt({ code: 0, stdout: "ERR 20 12ms" }).detail).toMatch(/AbortError/);
    // An unknown number is not turned into a confident errno either.
    expect(interpretAttempt({ code: 0, stdout: "ERR 99 12ms" }).outcome).toBe("not-attempted");
    // and the snippet now reads the name, not the legacy number
    expect(CONTAINER_SNIPPET).toMatch(/e\.name/);
    expect(CONTAINER_SNIPPET).toMatch(/typeof\(e&&e\.code\)==="string"/);
  });

  test("R4f a missing tool or an unsupported container is not-attempted, not a blocked route", () => {
    // "curl is not available" must not become a production finding.
    expect(interpretAttempt({ missing: "curl is not available on this host" }).outcome).toBe("not-attempted");
    expect(interpretAttempt({ code: 1, stdout: "fetch is not defined" }).outcome).toBe("not-attempted");
    expect(interpretAttempt({ code: 1, stdout: "ReferenceError: fetch is not defined" }).detail)
      .toMatch(/no global fetch/);
    expect(interpretAttempt(null).outcome).toBe("not-attempted");
  });
});

describe("evaluate — the verdict, from the vantage point that can deliver", () => {
  const cands = () => candidatesFor({ url: LAN, ...DNS });

  test("R2 the production case: reachable from the host, dead from inside the container", () => {
    const attempts = {
      [LAN]: hostAttempt(ok()),
      [`${LAN}|container`]: hairpin(),
      [DNS_URL]: ok(),
      [`${DNS_URL}|container`]: ok(),
    };
    const e = evaluate({ candidates: cands(), attempts, container: "care-api" });
    expect(e.verdict).toBe(FAIL_ROUTE);
    expect(e.code).toBe(1);
    // A host-only probe would have said "reachable" here. That is the defect this script exists to catch.
    const host = e.rows.find((r) => r.role === "configured" && r.from === "this host");
    expect(host.outcome).toBe(PASS);
    const inside = e.rows.find((r) => r.from === "inside care-api");
    expect(inside.outcome).toBe("refused");
  });

  test("R5 configured answers inside the container is a pass even if the host is quiet", () => {
    const attempts = {
      [LAN]: hostAttempt(hairpin()),
      [`${LAN}|container`]: hostAttempt({ code: 0, stdout: "HTTP 401 9ms" }),
    };
    const e = evaluate({ candidates: candidatesFor({ url: LAN }), attempts, container: "care-api" });
    expect(e.verdict).toBe(PASS);
    expect(e.code).toBe(0);
  });

  test("R6 a blocked route names the candidate that answers, and the shared network when nothing does", () => {
    const attempts = {
      [LAN]: hostAttempt(ok()),
      [`${LAN}|container`]: hairpin(),
      [DNS_URL]: ok(),
      [`${DNS_URL}|container`]: hostAttempt({ code: 0, stdout: "HTTP 404 3ms" }),
    };
    const e = evaluate({ candidates: cands(), attempts, container: "care-api" });
    expect(e.better.url).toBe(DNS_URL);
    expect(e.remedy).toMatch(/hope_hospital_app:5000/);

    const nothing = {
      [LAN]: hostAttempt(ok()),
      [`${LAN}|container`]: hairpin(),
      [DNS_URL]: { code: 6, stderr: "Could not resolve host" },
      [`${DNS_URL}|container`]: hostAttempt({ code: 0, stdout: "ERR ENOTFOUND 4ms" }),
    };
    const e2 = evaluate({ candidates: cands(), attempts: nothing, container: "care-api" });
    expect(e2.remedy).toMatch(/share no network/);
    expect(e2.remedy).toMatch(/care-hope-network\.override\.yml/);
  });

  test("R7 nothing attempted is UNKNOWN with exit 2 — a probe that could not run proves nothing", () => {
    const e = evaluate({ candidates: candidatesFor({ url: LAN }), attempts: { [LAN]: { missing: "curl is not available on this host" } } });
    expect(e.verdict).toBe(UNKNOWN);
    expect(e.code).toBe(2);
  });

  test("R7b an unreadable answer from the only vantage that matters is UNKNOWN, not a pass", () => {
    const attempts = { [LAN]: hostAttempt(hairpin()), [`${LAN}|container`]: { code: 0, stdout: "who knows 41ms" } };
    const e = evaluate({ candidates: candidatesFor({ url: LAN }), attempts, container: "care-api" });
    expect(e.verdict).toBe(UNKNOWN);
    expect(e.code).toBe(2);
  });

  test("R7c no configured URL is UNKNOWN, not a pass and not a failure", () => {
    const e = evaluate({ candidates: [], attempts: {} });
    expect(e.verdict).toBe(UNKNOWN);
    expect(e.code).toBe(2);
    expect(e.why).toMatch(/no INTEGRATION_HOPE_CALLBACK_URL/);
  });

  test("R8 buildRows adds the container vantage only when one was asked for", () => {
    const rows = buildRows({ candidates: candidatesFor({ url: LAN }), attempts: { [LAN]: hostAttempt(ok()) } });
    expect(rows).toHaveLength(1);
    expect(rows[0].from).toBe("this host");
    const both = buildRows({
      candidates: candidatesFor({ url: LAN }),
      attempts: { [LAN]: hostAttempt(ok()), [`${LAN}|container`]: hostAttempt(ok()) },
      container: "care-api",
    });
    expect(both.map((r) => r.from)).toEqual(["this host", "inside care-api"]);
  });
});

describe("render and main — what an operator reads", () => {
  test("R9 the report shows the vantage, the kind and the verdict, and carries no credential", () => {
    const SECRET = "synthetic-hope-secret-never-real-9f2c1d";
    const e = evaluate({
      candidates: candidatesFor({ url: LAN }),
      attempts: { [LAN]: hostAttempt(ok()), [`${LAN}|container`]: hairpin() },
      container: "care-api",
    });
    const text = render(e, { container: "care-api" });
    expect(text).toMatch(/CONFIGURED \[inside care-api\]/);
    expect(text).toMatch(/kind=lan-ip/);
    expect(text).toMatch(/verdict: blocked/);
    expect(text).toMatch(/Docker network alias, not an IP/);
    expect(text).not.toContain(SECRET);
    expect(e.code).toBe(1);
  });

  test("R9b UNKNOWN says it is not a pass", () => {
    const e = evaluate({ candidates: candidatesFor({ url: LAN }), attempts: { [LAN]: { missing: "no curl" } } });
    expect(render(e)).toMatch(/UNKNOWN is not a pass/);
  });

  test("R10 main reads the URL from the environment it is given and returns the verdict's code", () => {
    const seen = [];
    const code = main(["--container", "care-api"], {
      env: { INTEGRATION_HOPE_CALLBACK_URL: LAN },
      run: (cmd) => {
        seen.push(cmd);
        return cmd === "curl" ? { code: 0, stdout: "200" } : { code: 28, stderr: "Connection timed out" };
      },
      stdout: (s) => seen.push(["out", s]),
    });
    expect(code).toBe(1);
    expect(seen[0]).toBe("curl");
    expect(seen[1]).toBe("docker");
    expect(seen.find((s) => s[0] === "out")[1]).toMatch(/verdict: blocked/);
  });

  test("R10b --json prints the evaluation, and a pass returns 0", () => {
    let payload = "";
    const code = main(["--json"], {
      env: { INTEGRATION_HOPE_CALLBACK_URL: LAN },
      run: () => ({ code: 0, stdout: "200" }),
      stdout: (s) => { payload = s; },
    });
    expect(code).toBe(0);
    expect(JSON.parse(payload).verdict).toBe(PASS);
  });

  test("R10c no URL at all is exit 2, and --help states the read-only contract", () => {
    let out = "";
    expect(main([], { env: { INTEGRATION_HOPE_CALLBACK_URL: "" }, run: () => ({ code: 0, stdout: "200" }), stdout: (s) => { out = s; } })).toBe(2);
    expect(out).toMatch(/UNKNOWN is not a pass/);
    let help = "";
    expect(main(["--help"], { stdout: (s) => { help = s; } })).toBe(0);
    expect(help).toMatch(/no credential, no write, no restart/);
    expect(USAGE).toMatch(/Exit 0 answers/);
  });

  test("R11 parseArgs keeps every flag optional", () => {
    expect(parseArgs([])).toMatchObject({ url: null, container: null, dns: null, dnsPort: null, json: false });
    expect(parseArgs(["--url", "u", "--dns", "d", "--dns-port", "5000", "--json"]))
      .toMatchObject({ url: "u", dns: "d", dnsPort: "5000", json: true });
  });
});

describe("the request the probe sends carries no credential", () => {
  test("R12 no signature, no Authorization, no key name — a route test must not be a delivery", () => {
    expect(CONTAINER_SNIPPET).not.toMatch(/signature|Authorization|PARTNER_KEY|SIGNING_SECRET|api[_-]?key/i);
    expect(CONTAINER_SNIPPET).toMatch(/method:"GET"/);
    expect(CONTAINER_SNIPPET).toMatch(/AbortSignal\.timeout\(5000\)/);
    expect(CONTAINER_SNIPPET).not.toMatch(/body:/);
    // and it labels its own answer, which is what makes R4b/R4c possible
    expect(CONTAINER_SNIPPET).toMatch(/"HTTP "/);
    expect(CONTAINER_SNIPPET).toMatch(/"ERR "/);
  });

  test("R13 the host-side attempt is one GET with a deadline and nothing stored", () => {
    const calls = [];
    main(["--url", LAN], {
      env: {},
      run: (cmd, args) => { calls.push(args); return { code: 0, stdout: "200" }; },
      stdout: () => {},
    });
    expect(calls[0]).toEqual(["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", LAN]);
  });
});
