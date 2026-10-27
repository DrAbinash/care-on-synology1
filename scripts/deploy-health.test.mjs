/**
 * Tests for the deployment gate itself.
 *
 * The defect this replaces was not a wrong number but a check that could never
 * be true: `deploy-synology.sh` probed localhost:8080, nothing publishes 8080 on
 * the NAS host, the wait loop timed out, fell through, and the script printed
 * DEPLOYMENT COMPLETE. So the majority of these tests are the FAILED deployment
 * scenarios — each one asserts a non-zero exit *and* the reason a human can act
 * on, because "the gate can fail" is the only property that makes a green banner
 * mean anything.
 *
 * No Docker and no clinic machine is involved: the HTTP probes run against a
 * local node server whose responses are the ones app.ts and routes/health.ts
 * actually produce, and container states are fed to the pure evaluator.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_HOST_PORT,
  REQUIRED_CONTAINERS,
  REQUIRED_PROBES,
  classifyPass,
  evaluateContainer,
  evaluateProbe,
  hopeOriginFromEnvText,
  hostPortFromEnvText,
  inspectOne,
  main,
  parseArgs,
  parseInspectLine,
  runDockerInspect,
} from "./deploy-health.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** A stand-in for the ERP: every path answers exactly what the real route answers. */
function startStub(routes) {
  return new Promise((resolvePort) => {
    const server = createServer((req, res) => {
      const handler = routes[req.url];
      if (!handler) { res.writeHead(404).end("not found"); return; }
      const [status, body] = handler;
      res.writeHead(status, { "content-type": "application/json" }).end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolvePort({ server, baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const HEALTHY = {
  "/nginx-health": [200, "ok"],
  "/api/healthz": [200, '{"status":"ok"}'],
  "/api/health/schema": [200, '{"ok":true,"gates":{"db_patch_ok":true}}'],
};

async function runWith(routes, args = []) {
  const stub = await startStub(routes);
  // Collected into a local array on purpose: `mockRestore()` clears the call
  // log, so reading `log.mock.calls` after the finally block prints an empty
  // string and every "it said the right thing" assertion passes vacuously.
  const out = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.map(String).join(" ")); });
  let code = null;
  try {
    code = await main(["--base-url", stub.baseUrl, "--skip-docker", "--no-hope-probe", ...args]);
  } finally {
    log.mockRestore();
    await stub.close();
  }
  return { code, printed: () => out.join("\n") };
}

afterEach(() => vi.restoreAllMocks());

describe("a healthy deployment", () => {
  it("returns 0 and prints no failure list", async () => {
    const { code, printed } = await runWith(HEALTHY);
    expect(code).toBe(0);
    expect(printed()).not.toMatch(/failed/);
    expect(printed()).toMatch(/care-api/);
  });

  it("gates on all three endpoints, so no single green check can carry the whole deploy", async () => {
    const { code } = await runWith(HEALTHY);
    expect(REQUIRED_PROBES.map((p) => p.path)).toEqual([
      "/nginx-health",
      "/api/healthz",
      "/api/health/schema",
    ]);
    expect(code).toBe(0);
  });
});

describe("an unhealthy deployment returns a non-zero exit code", () => {
  it("fails when the schema is not migrated, and repeats the server's own reason", async () => {
    const { code, printed } = await runWith({
      ...HEALTHY,
      "/api/health/schema": [503, '{"ok":false,"error":"db-patch-v2 did not complete — run: docker compose up -d --build"}'],
    });
    expect(code).toBe(1);
    expect(printed()).toMatch(/db-patch-v2 did not complete/);
  });

  it("fails while the API is still starting, instead of calling a bound socket healthy", async () => {
    const { code, printed } = await runWith({
      ...HEALTHY,
      "/api/healthz": [503, '{"status":"starting","since":"2026-10-12T10:00:00.000Z"}'],
    });
    expect(code).toBe(1);
    expect(printed()).toMatch(/startup has not settled/);
  });

  it("fails when the database is unreachable even though HTTP answered", async () => {
    const { code, printed } = await runWith({
      ...HEALTHY,
      "/api/healthz": [503, '{"status":"degraded","db":"unreachable"}'],
    });
    expect(code).toBe(1);
    expect(printed()).toMatch(/database is unreachable/);
  });

  it("fails when nginx is up but the API behind it 404s", async () => {
    const { code } = await runWith({
      "/nginx-health": [200, "ok"],
      "/api/healthz": [404, "not found"],
      "/api/health/schema": [404, "not found"],
    });
    expect(code).toBe(1);
  });

  it("treats a connection refusal as a failure, not as a zero", async () => {
    // A closed port: the request never completes, which is the actual production
    // symptom of the 8080 bug — the loop waited on something that never answered.
    const out = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.map(String).join(" ")); });
    const code = await main(["--base-url", "http://127.0.0.1:1", "--skip-docker", "--no-hope-probe"]);
    log.mockRestore();
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/connection refused|not reachable/);
  });

  it("does not accept a 200 whose body is not the readiness answer it claims", async () => {
    const { code, printed } = await runWith({
      ...HEALTHY,
      "/api/healthz": [200, "<html>index.html fallback</html>"],
    });
    expect(code).toBe(1);
    expect(printed()).toMatch(/not with JSON/);
  });

  it("does not accept ok:false on the schema probe", async () => {
    const { code } = await runWith({ ...HEALTHY, "/api/health/schema": [200, '{"ok":false}'] });
    expect(code).toBe(1);
  });

  it("does not let a page being served stand in for nginx's own health answer", async () => {
    // Measured against the Vite dev server: GET /nginx-health there returns
    // 200 + index.html through the SPA fallback. A 2xx-only check would call
    // that "nginx is serving".
    const { code, printed } = await runWith({
      ...HEALTHY,
      "/nginx-health": [200, "<!DOCTYPE html><html lang=\"en\"><head></head><body><div id=\"root\"></div></body></html>"],
    });
    expect(code).toBe(1);
    expect(printed()).toMatch(/returned HTML, not nginx/);
  });

  it("gives up rather than waiting forever when --wait is asked to", async () => {
    const { code, printed } = await runWith(
      { ...HEALTHY, "/api/healthz": [503, '{"status":"starting"}'] },
      ["--wait", "--timeout-seconds", "1", "--interval-seconds", "1"],
    );
    expect(code).toBe(1);
    expect(printed()).toMatch(/waited 1s/);
  });
});

describe("container states a deploy requires", () => {
  const oneShot = REQUIRED_CONTAINERS.find((c) => c.name === "care-db-patch-v2");
  const service = REQUIRED_CONTAINERS.find((c) => c.name === "care-api");

  it("accepts a one-shot only when it has exited 0", () => {
    expect(evaluateContainer(oneShot.name, oneShot.kind, { status: "exited", ExitCode: 0 }).ok).toBe(true);
  });

  it("fails a one-shot that exited non-zero", () => {
    const r = evaluateContainer(oneShot.name, oneShot.kind, { status: "exited", ExitCode: 1 });
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/exited 1/);
  });

  it("fails a one-shot that is still running instead of calling it healthy", () => {
    expect(evaluateContainer(oneShot.name, oneShot.kind, { status: "running", ExitCode: 0 }).ok).toBe(false);
  });

  it("names a missing container as a deploy that never ran", () => {
    // `docker inspect` on an absent name prints to stderr and the loop that
    // paired output by index silently saw "nothing" — this is that case.
    const r = evaluateContainer(oneShot.name, oneShot.kind, undefined);
    expect(r.ok).toBe(false);
    expect(r.actual).toBe("not found");
    expect(r.why).toMatch(/never created/);
  });

  it("requires a running service to be healthy, not merely up", () => {
    expect(evaluateContainer(service.name, service.kind, { status: "running", ExitCode: 0, Health: "healthy" }).ok).toBe(true);
    expect(evaluateContainer(service.name, service.kind, { status: "running", ExitCode: 0, Health: "starting" }).ok).toBe(false);
    expect(evaluateContainer(service.name, service.kind, { status: "running", ExitCode: 0, Health: "unhealthy" }).ok).toBe(false);
    expect(evaluateContainer(service.name, service.kind, { status: "exited", ExitCode: 137 }).ok).toBe(false);
  });

  it("aggregates every failure into the verdict, so the banner sees all of them", () => {
    const containers = REQUIRED_CONTAINERS.map((c) => evaluateContainer(c.name, c.kind, { status: "exited", ExitCode: 3 }));
    const probes = REQUIRED_PROBES.map((p) => evaluateProbe(p.name, p.path, p.expect, { status: 502, body: "" }));
    const verdict = classifyPass(containers, probes);
    expect(verdict.ok).toBe(false);
    expect(verdict.failed.length).toBe(REQUIRED_CONTAINERS.length + REQUIRED_PROBES.length);
  });

  it("reads docker's own inspect line", () => {
    expect(parseInspectLine("running 0 healthy\n")).toEqual({ status: "running", ExitCode: 0, Health: "healthy" });
    expect(parseInspectLine("exited 0 none")).toEqual({ status: "exited", ExitCode: 0, Health: "" });
    expect(parseInspectLine("running 0 starting")).toEqual({ status: "running", ExitCode: 0, Health: "starting" });
    // "none" means the image declares no healthcheck — it must never be read as
    // "healthy", which is what would let an unhealthy care-api pass.
    expect(parseInspectLine("exited 1 none").Health).toBe("");
    expect(parseInspectLine("")).toBeNull();
    expect(parseInspectLine("garbage")).toBeNull();
    expect(parseInspectLine("running not-a-number healthy").ExitCode).toBe(-1);
  });

  it("inspects each container on its own, so a missing one cannot borrow its neighbour's state", () => {
    const seen = [];
    const fakeSpawn = (args) => {
      const name = args[args.length - 1];
      seen.push(name);
      // A real Docker: the migrator does not exist, the rest do. Batched
      // inspect returns four lines for five names — pairing by position then
      // reports care-schema-verify's exited(0) as the migrator's.
      if (name === "care-db-patch-v2") return { status: 1, stdout: "", stderr: `Error: No such object: ${name}` };
      return { status: 0, stdout: name === "care-db" ? "running 0 healthy\n" : "exited 0 none\n", stderr: "" };
    };
    const out = runDockerInspect([], ["care-db", "care-db-patch-v2", "care-schema-verify"], fakeSpawn);
    expect(seen).toEqual(["care-db", "care-db-patch-v2", "care-schema-verify"]);
    expect(out.byName.get("care-db")).toEqual({ status: "running", ExitCode: 0, Health: "healthy" });
    expect(out.byName.has("care-db-patch-v2")).toBe(false);
    expect(out.notes.join(" ")).toMatch(/care-db-patch-v2: no such container/);
    const verdict = REQUIRED_CONTAINERS.find((c) => c.name === "care-db-patch-v2");
    expect(evaluateContainer(verdict.name, verdict.kind, out.byName.get(verdict.name)).ok).toBe(false);
  });

  it("says so when docker itself is not on this host, instead of passing", () => {
    const { state, reason } = inspectOne("care-api", {
      spawnImpl: () => ({ error: new Error("spawnSync docker ENOENT"), status: null, stdout: "" }),
    });
    expect(state).toBeNull();
    expect(reason).toMatch(/docker is not available/);
  });
});

describe("the published port is read from the deployment, not assumed", () => {
  it("takes HOST_PORT from .env", () => {
    expect(hostPortFromEnvText("DB_USER=erp\nHOST_PORT=9090\n")).toBe(9090);
  });

  it("ignores comments, blanks and non-numeric values", () => {
    expect(hostPortFromEnvText("#HOST_PORT=1234\nHOST_PORT=\n")).toBeNull();
    expect(hostPortFromEnvText('HOST_PORT="8888"')).toBe(8888);
    expect(hostPortFromEnvText("HOST_PORT=abc")).toBeNull();
  });

  it("falls back to the compose default when .env is absent", () => {
    expect(hostPortFromEnvText(undefined)).toBeNull();
    expect(DEFAULT_HOST_PORT).toBe(8888);
    expect(parseArgs([]).baseUrl).toBe(`http://localhost:${DEFAULT_HOST_PORT}`);
  });
});

describe("CARE→HOPE is reported, never gated", () => {
  it("reads the callback origin from the env file", () => {
    expect(hopeOriginFromEnvText("INTEGRATION_HOPE_CALLBACK_URL=http://172.16.1.139:7080/api/integration/care-callback\n"))
      .toBe("http://172.16.1.139:7080");
    expect(hopeOriginFromEnvText("INTEGRATION_HOPE_CALLBACK_URL=not a url")).toBeNull();
    expect(hopeOriginFromEnvText("")).toBeNull();
  });
});

describe("argument handling cannot be quietly wrong", () => {
  it("rejects an unknown flag instead of ignoring a typo", () => {
    expect(() => parseArgs(["--skip-docker"])).not.toThrow();
    expect(() => parseArgs(["--skip-dockerr"])).toThrow(/unknown argument/);
  });

  it("clamps a nonsense timeout rather than waiting zero seconds", () => {
    expect(parseArgs(["--timeout-seconds", "0"]).timeoutSeconds).toBe(180);
    expect(parseArgs(["--timeout-seconds", "abc"]).timeoutSeconds).toBe(180);
  });

  it("does not skip Docker by default, so the gate cannot be half-run by accident", () => {
    const o = parseArgs([]);
    expect(o.skipDocker).toBe(false);
    expect(o.skipHttp).toBe(false);
  });
});

describe("deploy-synology.sh cannot regress to the check that could never pass", () => {
  const script = readFileSync(`${REPO_ROOT}deploy-synology.sh`, "utf8").replace(/\r\n/g, "\n");
  // Comments are allowed to name the old bug — that is how the next person
  // learns why the gate exists. Executable lines are not.
  const code = script.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

  it("no live line probes a port nothing publishes", () => {
    expect(code).not.toMatch(/:8080/);
    // The port the clinic uses is read from the deployment instead of being
    // hard-coded — the hard-coded number was the bug.
    expect(code).toMatch(/--host-port "\$HOST_PORT"/);
    expect(code).toMatch(/^HOST_PORT=8888$/m);
    expect(code).toMatch(/HOST_PORT="\$PARSED"/);
  });

  it("runs the gate and turns its failure into a non-zero exit", () => {
    const at = code.indexOf("scripts/deploy-health.mjs");
    expect(at).toBeGreaterThan(-1);
    expect(code.slice(at - 60, at)).toMatch(/if ! /);
    // `set -e` does not fire for a command inside `if !`, so the failure branch
    // has to call `fail` itself or the script would walk on into the banner.
    expect(code.slice(at, at + 1200)).toMatch(/fail "Deployment NOT verified/);
  });

  it("prints the success banner only after the gate has passed", () => {
    const banner = code.indexOf("DEPLOYMENT COMPLETE");
    expect(code.indexOf("scripts/deploy-health.mjs")).toBeLessThan(banner);
    // And the failing branch cannot reach it: `fail` exits before the banner.
    expect(code.slice(code.indexOf("if ! sudo"), banner)).toMatch(/fail "Deployment NOT verified/);
  });

  it("keeps the migration loop honest: running out of budget is a failure", () => {
    const loop = code.slice(code.indexOf("Waiting for database migrations"));
    expect(loop).toMatch(/Migration failed/);
    // Before, exhausting the 120 s fell straight through to the next step.
    // Asserting the `fail` text alone is hollow — the sentence can sit in a
    // branch that no longer runs. So the guard must govern it: the loop starts
    // from `migrated=false`, only the exited(0) branch may set it true, and the
    // failure is reachable precisely when it is still false.
    expect(loop).toMatch(/^migrated=false$/m);
    expect(loop).toMatch(/migrated=true\s*\n\s*break/m);
    expect(loop).toMatch(/if \[ "\$migrated" != "true" \]; then[\s\S]{0,700}?fail "Migrations did not complete within/m);
  });

  it("refuses to claim success when node itself is missing", () => {
    expect(code).toMatch(/fail "node is required to verify the deployment/);
  });

  it("asks the running API which commit it is, and fails the deploy when it is another one", () => {
    const at = code.indexOf("scripts/verify-deployed-identity.mjs");
    expect(at, "the deploy must verify build identity, not only liveness").toBeGreaterThan(-1);
    // After the health gate (nothing to ask while it is down) and before the banner.
    expect(code.indexOf("scripts/deploy-health.mjs")).toBeLessThan(at);
    expect(at).toBeLessThan(code.indexOf("DEPLOYMENT COMPLETE"));
    expect(code.slice(at, at + 400)).toMatch(/--expected "\$GIT_COMMIT" --base-url "http:\/\/localhost:\$\{HOST_PORT\}"/);
    expect(code.slice(at, at + 1400)).toMatch(/fail "Deployment NOT verified: the containers are running a different commit/);
  });

  it("never folds an unverified identity into the success banner", () => {
    // Exit 2 is UNKNOWN, and UNKNOWN must not read as a pass in the operator's
    // one-line summary: the flag stays false and the banner says NOT VERIFIED.
    const init = code.indexOf("IDENTITY_VERIFIED=false");
    const set = code.indexOf("IDENTITY_VERIFIED=true");
    expect(init).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(init);
    const banner = code.indexOf("DEPLOYMENT COMPLETE");
    expect(code.slice(banner)).toMatch(/if \[ "\$IDENTITY_VERIFIED" = "true" \]; then/);
    expect(code.slice(banner)).toMatch(/Running commit: NOT VERIFIED/);
  });

  it("records the rollback target before anything is replaced", () => {
    const at = code.indexOf("--record-rollback --auto");
    expect(at, "the image IDs a rollback needs are gone after `compose down`").toBeGreaterThan(-1);
    expect(at).toBeLessThan(code.indexOf("docker compose down"));
    // A box with no containers running (first install) must not lose its deploy,
    // but it must not be told nothing either.
    expect(code.slice(at, at + 900)).toMatch(/warn "No pre-deploy rollback record was written/);
  });
});
