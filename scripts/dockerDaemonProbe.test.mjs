// ============================================================================
// docker-daemon-probe.sh executed for real, against a stubbed Docker daemon.
//
// The owner's question on the morning of 2026-11-13 was "did the Docker daemon do
// something bad last night?", and answering it by hand cost four SSH probes, a
// pid-file mtime read and a systemd property. The probe turns that into a file the
// daily page reads every five minutes. An unverified file is how the last such
// script bit: `deploy-synology.sh` read perfectly and probed a port nothing
// publishes on, so it printed DEPLOYMENT COMPLETE over a failed deploy.
//
// So this harness runs the ACTUAL `bash docker-daemon-probe.sh` against stub
// `curl`/`stat`/`mv` (in `dockerDaemonProbeStubs/`) and then feeds whatever the
// script really wrote through the REAL interpretation layer — `parseDaemonState`
// and the `ops.docker_daemon` check, imported from
// artifacts/api-server/src/lib/operationsChecks.ts. That makes it an end-to-end
// contract test: script → file → parser → street light. Format drift between the
// shell and the TS (a renamed key, a `ping=` value the parser rejects, a duration
// the page cannot render) fails HERE, rather than surfacing as a permanently
// UNKNOWN light on the first page the clinic opens.
//
// Every scenario also asserts, from the call log, that the stubs were actually
// reached. That affirmative form is not ceremony: this box has no docker socket,
// but Linux CI has real `curl` and real `stat`, so a PATH that fell through to
// them would describe a host with no daemon at all and could still pass.
//
// Then a mutation battery: each mutant is one deliberate break to one named
// protection, applied byte-for-byte to an in-memory copy (the repo file is never
// written), checked with `bash -n` so it dies on behaviour rather than syntax,
// and must be CAUGHT by the named scenarios. A survivor means that protection's
// assertion is decoration. Two of the mutants here (M7, M8) are bugs this harness
// found in the script while it was being written, so their anchors double as
// regression pins: revert either fix and the named scenario goes red again.
//
// Nothing here touches Docker, the NAS, a socket, or a patient row. Run serially:
//   node node_modules/vitest/vitest.mjs run scripts/dockerDaemonProbe.test.mjs --no-file-parallelism
// (pnpm's own dependency check dies on Windows before vitest starts.) Measured on
// this box 2026-11-13: 59 s for the file — 18 scenarios at ~1.6 s per tick and a
// 13-mutant battery that re-runs those scenarios against each mutant.
// ============================================================================
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CHECK_DEFS, DEFAULT_THRESHOLDS, parseDaemonState,
} from "../artifacts/api-server/src/lib/operationsChecks.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const PROBE = join(REPO, "docker-daemon-probe.sh");
const STUB_SRC = join(HERE, "dockerDaemonProbeStubs");
const STUB_NAMES = ["curl", "stat", "mv"];
// Native Windows paths, like the sibling deploy harness: MSYS bash only reads a
// `;`-separated PATH as a Windows PATH while a backslash is still in it, and the
// drive-letter colon would otherwise split `C:/Users/…` into `C` and `/Users/…`.
const SEP = process.platform === "win32" ? ";" : ":";
const CONTAINERS = "care-db care-redis care-api care-web";

// One tick is 0.2–1.5 s measured on this box. A tick that outlives KILL_MS is
// reported as a harness failure rather than hanging the CI log silent the way
// deploy.sh's readiness gate once did.
const KILL_MS = 20_000;
const TEST_TIMEOUT_MS = 90_000;
const BATTERY_TIMEOUT_MS = 600_000;

let ROOT;
let BIN;
let REAL_MV;
// The script under test. The battery points this at a mutated copy and re-runs
// the named scenarios unchanged, so a scenario cannot tell it is being probed.
let ACTIVE = PROBE;

beforeAll(() => {
  ROOT = mkdtempSync(join(tmpdir(), "care-daemon-probe-"));
  BIN = join(ROOT, "bin");
  mkdirSync(BIN, { recursive: true });
  // Resolved BEFORE the stubs are written, so the stub's own `exec` finds the
  // real binary and not this harness's copy of it.
  REAL_MV = execFileSync("bash", ["-c", "command -v mv"], { encoding: "utf8" }).trim();
  if (!REAL_MV) throw new Error("no real mv found for the stub to delegate to");
  for (const name of STUB_NAMES) {
    // The stubs are bash, so they must be LF on disk even from a CRLF checkout.
    const body = readFileSync(join(STUB_SRC, name), "utf8").replace(/\r\n/g, "\n");
    const file = join(BIN, name);
    writeFileSync(file, body);
    execFileSync("bash", ["-c", `chmod 755 "${file}"`]);
    // chmod is a no-op on Windows; on Linux CI the bit is what puts the stub on
    // PATH at all, so assert it took rather than assuming it did.
    if (process.platform !== "win32") {
      const mode = execFileSync("bash", ["-c", `stat -c %a "${file}"`], { encoding: "utf8" }).trim();
      if (!mode.endsWith("5")) throw new Error(`stub ${name} is not executable (${mode})`);
    }
  }
});

afterAll(() => {
  ACTIVE = PROBE;
  if (ROOT) rmSync(ROOT, { recursive: true, force: true });
});

// ── the fake host ────────────────────────────────────────────────────────────
/**
 * One scenario's filesystem. `t0` is fixed when the sandbox is made so that every
 * tick in the scenario sees the SAME pid-file mtime and the same previous sample:
 * deriving those from each tick's own clock makes a one-second skew look like a
 * dockerd restart, which is the exact event the script is trying to detect.
 */
function sandbox() {
  const root = mkdtempSync(join(ROOT, "s-"));
  const world = join(root, "world");
  const guard = join(root, "guard");
  const tmp = join(root, "tmp");
  mkdirSync(world);
  mkdirSync(guard);
  mkdirSync(tmp);
  return {
    root, world, guard, tmp,
    t0: Math.floor(Date.now() / 1000),
    calls: join(root, "calls.log"),
    state: join(guard, "docker-daemon-state"),
    events: join(guard, "docker-daemon-events"),
    uptime: join(root, "uptime"),
    pid: join(world, "docker.pid"),
  };
}

const ago = (s, secs) => s.t0 - secs;

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function fields(text) {
  const out = {};
  for (const line of (text || "").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

// The healthy daemon's /info and container stamps, as measured on the box.
const INFO_ON = '{"LiveRestoreEnabled":true,"ServerVersion":"24.0.2"}';
const INFO_OFF = '{"LiveRestoreEnabled":false,"ServerVersion":"24.0.2"}';
const STAMP = {
  "care-db": "2026-11-11T02:11:03.123456789Z",
  "care-redis": "2026-11-11T02:11:04.123456789Z",
  "care-api": "2026-11-11T02:11:09.123456789Z",
  "care-web": "2026-11-11T02:11:11.123456789Z",
};
/** What the probe writes for a stamp: docker's nanoseconds, trimmed to seconds. */
const stampOf = (c, map = STAMP) => `${map[c].slice(0, 19)}Z`;
const stampString = (map = STAMP) =>
  CONTAINERS.split(" ").map((c) => `${c}:${stampOf(c, map)}`).join(" ");
const stampWorld = (map = STAMP) =>
  Object.fromEntries(CONTAINERS.split(" ").map((c) => [`stamp.${c}`, map[c]]));

/**
 * Stamps as they looked BEFORE a restart that took the api and the web down.
 * They differ in WHOLE SECONDS, because that is the only resolution the probe
 * keeps (docker writes nanoseconds and the script trims to 19 characters): two
 * stamps a millisecond apart are the same stamp as far as this file is concerned.
 */
const RECREATED = {
  ...STAMP,
  "care-api": "2026-10-08T01:02:03.000000000Z",
  "care-web": "2026-10-08T01:02:04.000000000Z",
};

/**
 * The daemon's behaviour for one tick. Defaults are a healthy dockerd that has
 * been up six hours with live-restore on; a scenario overrides only the fields
 * its own sentence is about, so reading a scenario says exactly what changed.
 */
function healthyWorld(s, over = {}) {
  return {
    "ping.rc": 0,
    "ping.code": 200,
    "ping.body": "OK",
    "info.body": INFO_ON,
    "pid.mtime": ago(s, 6 * 3600),
    ...stampWorld(),
    ...over,
  };
}

/** The sample a healthy tick six hours ago would have left behind. */
function healthyPrev(s, over = {}) {
  return {
    at: ago(s, 300),
    ping: "ok",
    ping_rc: 0,
    ping_http: 200,
    ping_ms: 4,
    daemon_start: ago(s, 6 * 3600),
    host_boot: ago(s, 5 * 86400),
    down_since: 0,
    live_restore: "on",
    live_restore_src: "daemon",
    server_version: "24.0.2",
    containers_seen: 4,
    containers_running: 4,
    stamps: stampString(),
    ev_at: 0,
    ev_kind: "none",
    ev_open: 0,
    ev_dark_s: "unknown",
    ev_stamps: "unknown",
    ev_live_restore: "unknown",
    ev_server_version: "unknown",
    ...over,
  };
}

/** The sample the probe writes, rendered back to `key=value` text. */
const asText = (kv) => Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";

/**
 * Run one tick. `bootedAt` is the kernel's own start instant (absolute epoch) and
 * becomes /proc/uptime for the script, because HOST_BOOT is NOW minus that file —
 * which is the only way a scenario can put a daemon start and a boot inside the
 * same 120-second window without faking the script's clock.
 */
function tick(s, { prev = null, world = {}, bootedAt = null, env = {}, guardDir = null } = {}) {
  const now = Math.floor(Date.now() / 1000);
  if (prev) writeFileSync(s.state, asText(prev));
  for (const [k, v] of Object.entries(world)) {
    writeFileSync(join(s.world, k), String(v));
  }
  writeFileSync(s.uptime, `${now - (bootedAt === null ? ago(s, 5 * 86400) : bootedAt)}.4242\n`);
  const res = spawnSync("bash", [ACTIVE], {
    encoding: "utf8",
    timeout: KILL_MS,
    env: {
      ...process.env,
      PATH: `${BIN}${SEP}${process.env.PATH}`,
      GUARD_DIR: guardDir || s.guard,
      WORLD: s.world,
      CALLS: s.calls,
      TMPDIR: s.tmp,
      REAL_MV,
      DOCKER_PID_FILE: s.pid,
      UPTIME_FILE: s.uptime,
      PROBE_CONTAINERS: CONTAINERS,
      PROBE_CURL_TIMEOUT: "2",
      PROBE_INFO_TIMEOUT: "2",
      ...env,
    },
  });
  const state = readText(s.state);
  return {
    rc: res.status ?? -1,
    hung: res.status === null || res.error !== undefined,
    out: `${res.stdout || ""}${res.stderr || ""}`,
    state,
    f: fields(state),
    events: readText(s.events),
    calls: readText(s.calls) || "",
    now,
  };
}

// ── assertions that collect problems instead of throwing, so the battery can
//    reuse a scenario and ask it to FAIL ──────────────────────────────────────
const eq = (p, what, got, want) => {
  if (got !== want) p.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const match = (p, what, got, re) => {
  if (!re.test(got || "")) p.push(`${what}: ${JSON.stringify(got)} does not match ${re}`);
};
const nomatch = (p, what, got, re) => {
  if (re.test(got || "")) p.push(`${what}: ${JSON.stringify(got)} must not match ${re}`);
};
const near = (p, what, got, want, tol) => {
  const n = Number(got);
  if (!Number.isFinite(n) || Math.abs(n - want) > tol) p.push(`${what}: got ${got}, want ${want}±${tol}`);
};
const lines = (text) => (text ? text.split(/\r?\n/).filter(Boolean) : []);

/**
 * The invariant that gives every other assertion here its meaning: the stubs were
 * reached, and the sample got to its final name through a rename and nothing else.
 */
function stubRan(p, r) {
  if (!/curl [^\n]*--unix-socket[^\n]*localhost\/_ping/.test(r.calls)) {
    p.push("stub curl was never called for /_ping — PATH fell through to the real binary");
  }
  if (!/stat -c %Y [^\n]*docker\.pid/.test(r.calls)) {
    p.push("stub stat was never called for the pid file");
  }
  const renames = r.calls.split(/\r?\n/).filter((l) => l.startsWith("mv -f "));
  const ok = renames.some((l) => /^mv -f \S+\.tmp\.\d+ \S+[\\/]docker-daemon-state$/.test(l));
  if (!ok) {
    p.push(`sample was not renamed into place from a temp file (got: ${renames.join(" | ") || "no mv"})`);
  }
}

/** The light's own verdict over the file the script actually wrote. */
async function verdict(stateText, atSeconds) {
  const st = parseDaemonState(stateText);
  if (!st) return { status: "UNPARSABLE", message: "" };
  const def = CHECK_DEFS.find((d) => d.id === "ops.docker_daemon");
  return await def.run({
    now: new Date(atSeconds * 1000),
    daemonState: () => st,
    thresholds: DEFAULT_THRESHOLDS,
  });
}

/** Asserts the file parses at all, then checks the verdict. Every light test runs it. */
async function lightIs(p, r, status, re, atSeconds = null) {
  if (parseDaemonState(r.state || "") === null) {
    p.push(`the light cannot read the file the probe wrote: ${JSON.stringify(r.state)}`);
    return null;
  }
  const v = await verdict(r.state, atSeconds ?? r.now);
  eq(p, "light status", v.status, status);
  if (re) match(p, "light message", v.message, re);
  return v;
}

// ── scenarios ────────────────────────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "S1",
    name: "a first healthy tick leaves a sample the light reads as PASS",
    async fn() {
      const p = [];
      const s = sandbox();
      const r = tick(s, { world: healthyWorld(s) });
      eq(p, "exit", r.rc, 0);
      stubRan(p, r);
      eq(p, "ping", r.f.ping, "ok");
      eq(p, "ping_rc", r.f.ping_rc, "0");
      eq(p, "ping_http", r.f.ping_http, "200");
      // The -w string is what carries the latency, so this pins the stub's
      // %{time_total} plumbing as much as the script's arithmetic.
      eq(p, "ping_ms", r.f.ping_ms, "4");
      near(p, "at", r.f.at, r.now, 5);
      eq(p, "daemon_start", r.f.daemon_start, String(ago(s, 6 * 3600)));
      near(p, "host_boot", r.f.host_boot, ago(s, 5 * 86400), 5);
      eq(p, "live_restore", r.f.live_restore, "on");
      eq(p, "live_restore_src", r.f.live_restore_src, "daemon");
      eq(p, "server_version", r.f.server_version, "24.0.2");
      eq(p, "containers", `${r.f.containers_running}/${r.f.containers_seen}`, "4/4");
      eq(p, "stamps", r.f.stamps, stampString());
      eq(p, "down_since", r.f.down_since, "0");
      eq(p, "ev_at", r.f.ev_at, "0");
      eq(p, "ev_kind", r.f.ev_kind, "none");
      eq(p, "ev_open", r.f.ev_open, "0");
      eq(p, "ev_stamps", r.f.ev_stamps, "unknown");
      if (r.events !== null) p.push(`a healthy tick created an incident ledger: ${r.events}`);
      match(p, "log line", r.out, /ping=ok rc=0 4ms/);
      // Containment: the ping body is deleted and the rename leaves nothing behind.
      const stray = readdirSync(s.tmp);
      if (stray.length) p.push(`left files behind in TMPDIR: ${stray.join(", ")}`);
      const inGuard = readdirSync(s.guard);
      if (inGuard.length !== 1 || inGuard[0] !== "docker-daemon-state") {
        p.push(`wrote more than the sample into the log dir: ${inGuard.join(", ")}`);
      }
      await lightIs(p, r, "PASS", /live-restore on, 4\/4 ERP containers running, no daemon incident recorded yet/);
      return p;
    },
  },
  {
    id: "S2",
    name: "a second healthy tick refreshes the sample and records nothing",
    fn() {
      const p = [];
      const s = sandbox();
      const r = tick(s, { prev: healthyPrev(s), world: healthyWorld(s) });
      eq(p, "exit", r.rc, 0);
      stubRan(p, r);
      near(p, "at advanced", r.f.at, r.now, 5);
      eq(p, "ping", r.f.ping, "ok");
      eq(p, "ev_at stays 0", r.f.ev_at, "0");
      eq(p, "stamps unchanged", r.f.stamps, stampString());
      if (r.events !== null) p.push(`a quiet tick wrote an incident line: ${r.events}`);
      match(p, "log line", r.out, /answering, no daemon change since the last tick/);
      return p;
    },
  },
  {
    id: "S3",
    name: "a restart nobody watched is caught by the pid file, and its dark length is admitted as unknown",
    async fn() {
      const p = [];
      const s = sandbox();
      const r = tick(s, {
        prev: healthyPrev(s, { stamps: stampString(RECREATED) }),
        world: healthyWorld(s, { "pid.mtime": ago(s, 3600) }),
      });
      eq(p, "exit", r.rc, 0);
      eq(p, "daemon_start", r.f.daemon_start, String(ago(s, 3600)));
      eq(p, "ev_at is the new daemon's start", r.f.ev_at, String(ago(s, 3600)));
      eq(p, "ev_kind", r.f.ev_kind, "daemon");
      eq(p, "ev_open", r.f.ev_open, "0");
      // The honest limit, asserted rather than hoped for: nothing saw the daemon
      // refuse, so the probe must NOT invent an outage that lasted zero seconds.
      eq(p, "ev_dark_s", r.f.ev_dark_s, "unknown");
      eq(p, "ev_stamps", r.f.ev_stamps, "2/4");
      eq(p, "down_since", r.f.down_since, "0");
      eq(p, "ledger lines", lines(r.events).length, 1);
      match(p, "ledger line", lines(r.events)[0], /kind=daemon open=0 dark_s=unknown .* stamps=2\/4/);
      const v = await lightIs(p, r, "WARNING", /dockerd restarted/);
      if (v) {
        match(p, "unobserved duration", v.message, /the probe never saw it refuse, so how long it was dark is unknown/);
        match(p, "stamp clause", v.message, /2\/4 ERP containers have a different start stamp across it/);
        nomatch(p, "no invented duration", v.message, /did not answer for/);
      }
      return p;
    },
  },
  {
    id: "S4",
    name: "a NAS boot is called a boot; a daemon that started hours after the boot is not",
    fn() {
      const p = [];
      const booted = sandbox();
      const rb = tick(booted, {
        prev: healthyPrev(booted),
        world: healthyWorld(booted, { "pid.mtime": ago(booted, 600) }),
        bootedAt: ago(booted, 605),
      });
      eq(p, "exit", rb.rc, 0);
      eq(p, "boot: daemon_start", rb.f.daemon_start, String(ago(booted, 600)));
      eq(p, "boot: ev_kind", rb.f.ev_kind, "boot");
      eq(p, "boot: ev_at", rb.f.ev_at, String(ago(booted, 600)));
      match(p, "boot: ledger line", lines(rb.events)[0] || "", /kind=boot /);
      nomatch(p, "boot: light does not claim an outage", rb.out, /STILL does not answer/);

      const daemonOnly = sandbox();
      const rd = tick(daemonOnly, {
        prev: healthyPrev(daemonOnly),
        world: healthyWorld(daemonOnly, { "pid.mtime": ago(daemonOnly, 600) }),
        bootedAt: ago(daemonOnly, 86400),
      });
      eq(p, "daemon-only: ev_kind", rd.f.ev_kind, "daemon");
      return p;
    },
  },
  {
    id: "S5",
    name: "a proved refusal (connection refused AND a timeout) is an outage, not a probe that cannot tell",
    async fn() {
      const p = [];
      for (const rc of [7, 28]) {
        const s = sandbox();
        const r = tick(s, {
          prev: healthyPrev(s),
          world: healthyWorld(s, { "ping.rc": rc, "ping.code": "000" }),
        });
        // cron mails a non-zero exit. A dead daemon is not this script's failure.
        eq(p, `rc=${rc} exit`, r.rc, 0);
        eq(p, `rc=${rc} ping`, r.f.ping, "down");
        eq(p, `rc=${rc} ping_rc`, r.f.ping_rc, String(rc));
        // An unreadable tick must not claim every container is down.
        eq(p, `rc=${rc} containers_running`, r.f.containers_running, "unknown");
        eq(p, `rc=${rc} containers_seen`, r.f.containers_seen, "unknown");
        eq(p, `rc=${rc} live_restore`, r.f.live_restore, "unknown");
        // …and must not erase the fingerprints the next comparison needs…
        eq(p, `rc=${rc} stamps carried forward`, r.f.stamps, stampString());
        // …nor lose the one fact that is readable WITHOUT the daemon: the pid
        // file's mtime outlives it, which is when the start instant matters most.
        eq(p, `rc=${rc} daemon_start from the pid file`, r.f.daemon_start, String(ago(s, 6 * 3600)));
        near(p, `rc=${rc} down_since`, r.f.down_since, r.now, 5);
        eq(p, `rc=${rc} ev_kind`, r.f.ev_kind, "stall");
        eq(p, `rc=${rc} ev_open`, r.f.ev_open, "1");
        eq(p, `rc=${rc} ev_dark_s`, r.f.ev_dark_s, "unknown");
        // A dark tick comparing the carried stamps with themselves would print
        // "0/4 changed": a confident claim that nothing restarted, from a sample
        // that could not look.
        eq(p, `rc=${rc} ev_stamps`, r.f.ev_stamps, "unknown");
        eq(p, `rc=${rc} ledger lines`, lines(r.events).length, 1);
        match(p, `rc=${rc} log line`, r.out, new RegExp(`ping=down rc=${rc}`));
        match(p, `rc=${rc} note`, r.out, /stopped answering .* same daemon process so far/);
        await lightIs(p, r, "FAIL", new RegExp(
          `dockerd is not answering \\(no reply for \\d+ s\\) — curl rc=${rc}`));
      }
      return p;
    },
  },
  {
    id: "S6",
    name: "the next dark tick extends the window instead of reopening it, and does not duplicate the ledger",
    fn() {
      const p = [];
      const s = sandbox();
      const world = healthyWorld(s, { "ping.rc": 7, "ping.code": "000" });
      // The first dark tick IS the transition, so it earns the ledger line.
      const first = tick(s, { prev: healthyPrev(s), world });
      const r = tick(s, { prev: fields(first.state), world });
      eq(p, "exit", r.rc, 0);
      eq(p, "ping", r.f.ping, "down");
      eq(p, "first tick logged the transition", lines(first.events).length, 1);
      // The window still dates from the tick that first saw it, not from now.
      near(p, "down_since set by the first tick", first.f.down_since, first.now, 5);
      eq(p, "down_since unchanged on the second", r.f.down_since, first.f.down_since);
      eq(p, "ev_at unchanged", r.f.ev_at, first.f.ev_at);
      eq(p, "ev_open", r.f.ev_open, "1");
      eq(p, "ledger lines (transitions only)", lines(r.events).length, 1);
      match(p, "log line", r.out, /still not answering \(open since /);
      nomatch(p, "no second incident claimed", r.out, /stopped answering .* same daemon process/);
      return p;
    },
  },
  {
    id: "S7",
    name: "the tick that sees it answering again closes the window with the measured duration",
    async fn() {
      const p = [];
      const s = sandbox();
      const r = tick(s, {
        prev: healthyPrev(s, {
          ping: "down", ping_rc: 7, down_since: ago(s, 420), ev_at: ago(s, 420),
          ev_kind: "stall", ev_open: 1,
        }),
        world: healthyWorld(s),
      });
      eq(p, "exit", r.rc, 0);
      eq(p, "ping", r.f.ping, "ok");
      near(p, "ev_dark_s is the measured window", r.f.ev_dark_s, 420, 12);
      eq(p, "ev_open", r.f.ev_open, "0");
      eq(p, "ev_kind", r.f.ev_kind, "stall");
      eq(p, "down_since reset", r.f.down_since, "0");
      // Both sides are readable here, so a real count is owed — and it is 0/4,
      // which is a fact now rather than the dark tick's silence.
      eq(p, "ev_stamps", r.f.ev_stamps, "0/4");
      eq(p, "ledger lines", lines(r.events).length, 1);
      match(p, "ledger line", lines(r.events)[0], /kind=stall open=0 dark_s=\d{3} .* stamps=0\/4/);
      match(p, "log line", r.out, /answering again after a window opened/);
      const v = await lightIs(p, r, "WARNING", /dockerd stopped answering and recovered/);
      if (v) match(p, "duration is told", v.message, /did not answer for 7 m \d+ s/);
      return p;
    },
  },
  {
    id: "S8",
    name: "a restart caught mid-outage opens the clock at this tick and keeps the daemon's start as the incident",
    async fn() {
      const p = [];
      const s = sandbox();
      const r = tick(s, {
        prev: healthyPrev(s),
        world: healthyWorld(s, { "pid.mtime": ago(s, 60), "ping.rc": 7, "ping.code": "000" }),
      });
      eq(p, "exit", r.rc, 0);
      eq(p, "ping", r.f.ping, "down");
      eq(p, "ev_at is the new daemon's start", r.f.ev_at, String(ago(s, 60)));
      eq(p, "ev_kind", r.f.ev_kind, "daemon");
      eq(p, "ev_open", r.f.ev_open, "1");
      eq(p, "ev_dark_s", r.f.ev_dark_s, "unknown");
      eq(p, "ev_stamps", r.f.ev_stamps, "unknown");
      // The defect this line pins: `down_since=0` on a sample whose own ping says
      // down reads as "no window open", so the outage arrived with no clock and
      // the next tick dated it five minutes late.
      near(p, "down_since opened now", r.f.down_since, r.now, 5);
      eq(p, "ledger lines", lines(r.events).length, 1);
      match(p, "log line", r.out, /dockerd started .* and STILL does not answer/);
      const v = await lightIs(p, r, "FAIL", /dockerd is not answering \(no reply for \d+ s\) — curl rc=7/);
      if (v) eq(p, "the alert carries a live clock", v.metadata.darkSeconds !== null, true);
      return p;
    },
  },
  {
    id: "S9",
    name: "a probe that cannot interpret the daemon says unknown and changes no incident state",
    async fn() {
      const p = [];
      const s = sandbox();
      const r = tick(s, {
        prev: healthyPrev(s, {
          ev_at: ago(s, 7200), ev_kind: "daemon", ev_open: 0, ev_dark_s: 60, ev_stamps: "1/4",
        }),
        // rc 127 = no curl in cron's PATH, which the stub answers the way the
        // shell does: nothing at all on stdout, no body file, exit 127.
        world: healthyWorld(s, { "ping.rc": 127, "ping.code": "000" }),
      });
      eq(p, "exit", r.rc, 0);
      eq(p, "ping", r.f.ping, "unknown");
      eq(p, "ping_rc", r.f.ping_rc, "127");
      // Neither the http code nor the latency was ever reported, and the script
      // must not render the absence as a number.
      eq(p, "ping_http", r.f.ping_http, "unknown");
      eq(p, "ping_ms", r.f.ping_ms, "unknown");
      eq(p, "live_restore", r.f.live_restore, "unknown");
      eq(p, "containers_running", r.f.containers_running, "unknown");
      eq(p, "stamps kept", r.f.stamps, stampString());
      eq(p, "daemon_start kept", r.f.daemon_start, String(ago(s, 6 * 3600)));
      eq(p, "previous incident kept", r.f.ev_at, String(ago(s, 7200)));
      eq(p, "previous kind kept", r.f.ev_kind, "daemon");
      eq(p, "previous dark kept", r.f.ev_dark_s, "60");
      eq(p, "previous stamps kept", r.f.ev_stamps, "1/4");
      eq(p, "down_since", r.f.down_since, "0");
      if (r.events !== null) p.push(`an uninterpretable tick wrote an incident line: ${r.events}`);
      match(p, "log line", r.out, /probe could not interpret the daemon \(curl rc=127\); previous state kept/);
      const v = await lightIs(p, r, "UNKNOWN", /that is not an outage and it is not health either/);
      if (v) eq(p, "the light does not claim an incident", v.metadata.eventKind, "daemon");
      return p;
    },
  },
  {
    id: "S10",
    name: "a rename that fails leaves last night's sample byte-for-byte and exits non-zero",
    fn() {
      const p = [];
      const s = sandbox();
      const sentinel = asText(healthyPrev(s, { ping: "down", down_since: ago(s, 900) }));
      writeFileSync(s.state, sentinel);
      const r = tick(s, { world: healthyWorld(s, { "mv.rc": 1 }) });
      eq(p, "exit", r.rc, 1);
      eq(p, "previous sample preserved", readText(s.state), sentinel);
      match(p, "log line", r.out, /REFUSED — cannot write /);
      const stray = readdirSync(s.guard).filter((n) => n.includes(".tmp."));
      if (stray.length) p.push(`left a temp file behind: ${stray.join(", ")}`);
      // The evidence the page serves came from the failed tick's predecessor.
      eq(p, "still says down", fields(readText(s.state)).ping, "down");
      return p;
    },
  },
  {
    id: "S11",
    name: "a log directory that cannot be created is a loud refusal, not a silent tick",
    fn() {
      const p = [];
      const s = sandbox();
      writeFileSync(join(s.root, "blocker"), "not a directory");
      const r = tick(s, { world: healthyWorld(s), guardDir: join(s.root, "blocker", "sub") });
      eq(p, "exit", r.rc, 1);
      match(p, "log line", r.out, /REFUSED — cannot create /);
      return p;
    },
  },
  {
    id: "S12",
    name: "live-restore off is taken from the daemon's own answer, not a config file",
    async fn() {
      const p = [];
      const s = sandbox();
      const r = tick(s, { prev: healthyPrev(s), world: healthyWorld(s, { "info.body": INFO_OFF }) });
      eq(p, "exit", r.rc, 0);
      eq(p, "live_restore", r.f.live_restore, "off");
      eq(p, "live_restore_src", r.f.live_restore_src, "daemon");
      const v = await lightIs(p, r, "FAIL", /live-restore is OFF in the running daemon/);
      if (v) {
        match(p, "names the incident it prevents", v.message, /2026-11-10/);
        nomatch(p, "no event, so no claim one happened", v.message, /And it happened/);
      }
      return p;
    },
  },
  {
    id: "S13",
    name: "one container the daemon does not know is counted, not read as a dead daemon",
    async fn() {
      const p = [];
      const s = sandbox();
      const r = tick(s, {
        prev: healthyPrev(s),
        world: healthyWorld(s, { "missing.care-web": "1" }),
      });
      eq(p, "exit", r.rc, 0);
      eq(p, "ping", r.f.ping, "ok");
      eq(p, "containers_running", r.f.containers_running, "3");
      eq(p, "containers_seen", r.f.containers_seen, "4");
      const v = await lightIs(p, r, "PASS", /3\/4 ERP containers running/);
      if (v) eq(p, "live-restore still reported", v.metadata.liveRestore, "on");
      return p;
    },
  },
  {
    id: "S14",
    name: "the same file read half an hour later says the probe stopped, not that the daemon is down",
    async fn() {
      const p = [];
      const s = sandbox();
      const r = tick(s, { world: healthyWorld(s) });
      eq(p, "exit", r.rc, 0);
      // No second tick: this is what cron looks like when the crontab line is
      // gone — the file simply stops changing, and still says ping=ok inside it.
      const v = await lightIs(p, r, "FAIL", /has not written a sample in 30 min/, r.now + 1800);
      if (v) {
        eq(p, "the check says so", v.metadata.stale, true);
        nomatch(p, "no stale state claimed as live", v.message, /is not answering|live-restore is OFF/);
        match(p, "names the fix", v.message, /crontab entry is gone/);
      }
      return p;
    },
  },
  {
    id: "S15",
    name: "a quiet tick carries yesterday's incident forward instead of clearing it",
    async fn() {
      const p = [];
      const s = sandbox();
      const r = tick(s, {
        prev: healthyPrev(s, {
          ev_at: ago(s, 30 * 3600), ev_kind: "daemon", ev_open: 0, ev_dark_s: 900, ev_stamps: "4/4",
        }),
        world: healthyWorld(s),
      });
      eq(p, "exit", r.rc, 0);
      eq(p, "ev_at carried", r.f.ev_at, String(ago(s, 30 * 3600)));
      eq(p, "ev_kind carried", r.f.ev_kind, "daemon");
      eq(p, "ev_dark_s carried", r.f.ev_dark_s, "900");
      eq(p, "ev_stamps carried", r.f.ev_stamps, "4/4");
      eq(p, "down_since", r.f.down_since, "0");
      if (r.events !== null) p.push(`a quiet tick wrote an incident line: ${r.events}`);
      const v = await lightIs(p, r, "PASS", /last daemon incident 30h ago, outside the 24 h notice window/);
      if (v) eq(p, "no alert would fire", v.status, "PASS");
      return p;
    },
  },
  {
    id: "S16",
    name: "a daemon that answers /_ping but not /info says live-restore is unreadable, never assumes it is on",
    async fn() {
      const p = [];
      const s = sandbox();
      // Mid-reload dockerd behaves like this: the socket accepts, /info times out.
      const r = tick(s, {
        prev: healthyPrev(s),
        world: healthyWorld(s, { "info.rc": 28 }),
      });
      eq(p, "exit", r.rc, 0);
      eq(p, "ping", r.f.ping, "ok");
      eq(p, "live_restore", r.f.live_restore, "unknown");
      eq(p, "live_restore_src", r.f.live_restore_src, "none");
      eq(p, "server_version", r.f.server_version, "unknown");
      // The containers are a separate read: losing /info must not lose them too.
      eq(p, "containers", `${r.f.containers_running}/${r.f.containers_seen}`, "4/4");
      const v = await lightIs(p, r, "PASS", /live-restore unreadable \(not assumed to be on\)/);
      if (v) {
        nomatch(p, "the word 'unknown' never reaches the sentence as a version", v.message, /engine unknown/);
        nomatch(p, "no false live-restore alarm", v.message, /live-restore is OFF/);
        eq(p, "and no red either", v.metadata.liveRestore, "unknown");
      }
      return p;
    },
  },
  {
    id: "S17",
    name: "a daemon that answers but cannot name a single container says unreadable, never 0/0 running",
    async fn() {
      const p = [];
      const s = sandbox();
      const world = healthyWorld(s);
      for (const c of CONTAINERS.split(" ")) world[`rc.${c}`] = 7;
      const r = tick(s, { prev: healthyPrev(s), world });
      eq(p, "exit", r.rc, 0);
      eq(p, "ping", r.f.ping, "ok");
      eq(p, "containers_running", r.f.containers_running, "0");
      eq(p, "containers_seen", r.f.containers_seen, "0");
      match(p, "stamps mark the failures", r.f.stamps, /^care-db:err .* care-web:err$/);
      await lightIs(p, r, "PASS", /ERP containers unreadable on that tick/);
      return p;
    },
  },
  {
    id: "S18",
    name: "the incident ledger stays bounded and keeps the newest line last",
    fn() {
      const p = [];
      const s = sandbox();
      const old = Array.from({ length: 10 }, (_, i) =>
        `2026-11-1${i % 2} 0${i % 6}:0${i % 6}:0${i % 6} kind=old open=0 dark_s=60 live_restore=on engine=24.0.2 stamps=0/4 ping_rc=0`);
      writeFileSync(s.events, old.join("\n") + "\n");
      const r = tick(s, {
        prev: healthyPrev(s),
        world: healthyWorld(s, { "pid.mtime": ago(s, 600) }),
        env: { EVENTS_KEEP: "3" },
      });
      eq(p, "exit", r.rc, 0);
      const kept = lines(r.events);
      eq(p, "ledger length", kept.length, 3);
      match(p, "newest line is last", kept[2] || "", /kind=daemon /);
      match(p, "the two older survivors are the newest of the old", kept[0] || "", /kind=old /);
      eq(p, "no temp file left beside the ledger",
        readdirSync(s.guard).filter((n) => n.includes(".tmp.")).length, 0);
      return p;
    },
  },
];

// ── mutation battery ─────────────────────────────────────────────────────────
// Each entry breaks ONE named protection of the script. `caughtBy` names the
// scenarios that must go red because of it, and the battery runs those scenarios
// against the mutated copy — so a mutant that survives means the assertion
// written for that protection is decoration.
const MUTANTS = [
  {
    id: "M1", protection: "a curl timeout (28) is as much an outage as a refusal (7)",
    from: `elif [ "$PING_RC" -eq 7 ] || [ "$PING_RC" -eq 28 ]; then`,
    to: `elif [ "$PING_RC" -eq 7 ]; then`,
    caughtBy: ["S5"],
  },
  {
    id: "M2", protection: "a dark tick keeps the fingerprints the next comparison needs",
    from: `  STAMPS="$P_STAMPS"`,
    to: `  STAMPS=""`,
    caughtBy: ["S5", "S9"],
  },
  {
    id: "M3", protection: "an unobserved outage is 'unknown', never a zero-length one",
    from: `      EV_DARK=unknown
    fi
    EVENT_NOTE="dockerd restarted`,
    to: `      EV_DARK=0
    fi
    EVENT_NOTE="dockerd restarted`,
    caughtBy: ["S3"],
  },
  {
    id: "M4", protection: "one outage is one ledger line",
    from: `if [ "$PING" = down ] && [ "$P_PING" != "down" ]; then NEW_EVENT=1; fi`,
    to: `if [ "$PING" = down ]; then NEW_EVENT=1; fi`,
    caughtBy: ["S6"],
  },
  {
    id: "M5", protection: "a NAS reboot is told apart from a daemon-only restart",
    from: `    EV_KIND=boot`,
    to: `    EV_KIND=daemon`,
    caughtBy: ["S4"],
  },
  {
    id: "M6", protection: "a daemon outage is not this script's failure, so cron stays quiet",
    from: `# itself could not run, which is the only thing cron should shout about.
exit 0`,
    to: `# itself could not run, which is the only thing cron should shout about.
exit 1`,
    caughtBy: ["S1", "S5"],
  },
  {
    id: "M7", protection: "a restart seen mid-outage opens the outage clock at once",
    from: `      DOWN_SINCE="$NOW"
    fi
    EVENT_NOTE="dockerd started`,
    // `:` keeps the else-branch a statement: deleting the assignment outright
    // leaves an empty `else` that will not even parse, and a mutant that fails to
    // start is caught by every scenario for the wrong reason.
    to: `      :
    fi
    EVENT_NOTE="dockerd started`,
    caughtBy: ["S8"],
  },
  {
    id: "M8", protection: "a dark tick never claims 0/N containers restarted",
    from: `  if [ "$STAMPS_READ" -ne 1 ]; then printf 'unknown\\n'; return; fi`,
    to: `  if [ "$STAMPS_READ" -lt 0 ]; then printf 'unknown\\n'; return; fi`,
    caughtBy: ["S5", "S8"],
  },
  {
    id: "M9", protection: "the sample is renamed into place, so the API never reads half a file",
    from: `if [ -s "$TMP_STATE" ] && mv -f "$TMP_STATE" "$STATE" 2>/dev/null; then`,
    to: `if [ -s "$TMP_STATE" ] && cat "$TMP_STATE" > "$STATE" 2>/dev/null; then`,
    caughtBy: ["S1", "S10"],
  },
  {
    id: "M10", protection: "'cannot tell' is UNKNOWN, never an outage",
    from: `  PING=unknown
fi`,
    to: `  PING=down
fi`,
    caughtBy: ["S9"],
  },
  {
    id: "M11", protection: "the incident ledger is bounded",
    from: `  tail -n "$EVENTS_KEEP" "$EVENTS" > "\${EVENTS}.tmp.$$" 2>/dev/null \\`,
    to: `  cat "$EVENTS" > "\${EVENTS}.tmp.$$" 2>/dev/null \\`,
    caughtBy: ["S18"],
  },
  {
    id: "M12", protection: "the ping latency the page prints is milliseconds, not whole seconds",
    from: `awk '{printf "%d", ($1 * 1000) + 0.5}'`,
    to: `awk '{printf "%d", $1}'`,
    caughtBy: ["S1"],
  },
  {
    id: "M13", protection: "an unwritable log dir is a refusal, not a tick that appeared to work",
    from: `  log "REFUSED — cannot create $GUARD_DIR"
  exit 1`,
    to: `  log "WARN — cannot create $GUARD_DIR"`,
    caughtBy: ["S11"],
  },
];

const byId = new Map(SCENARIOS.map((sc) => [sc.id, sc]));

describe("docker-daemon-probe.sh, run for real against a stub daemon", { timeout: TEST_TIMEOUT_MS }, () => {
  for (const sc of SCENARIOS) {
    it(`${sc.id} — ${sc.name}`, async () => {
      const problems = await sc.fn();
      expect(problems, `${sc.id} failed`).toEqual([]);
    }, TEST_TIMEOUT_MS);
  }
});

describe("mutation battery: every named protection can actually fail", { timeout: BATTERY_TIMEOUT_MS }, () => {
  it("covers every scenario, and each mutant is caught by the scenarios it names", async () => {
    const original = readFileSync(PROBE, "utf8");
    if (original.includes("\r")) throw new Error("docker-daemon-probe.sh has CRLF on disk; the mutants would inherit it");
    const mutantDir = join(ROOT, "mutants");
    mkdirSync(mutantDir, { recursive: true });

    const survivors = [];
    const unprovable = [];
    for (const m of MUTANTS) {
      const hits = original.split(m.from).length - 1;
      // An anchor that matches twice, or not at all, means the battery is testing
      // its own string rather than the script — which is how a mutation harness
      // reports 100% kills while mutating nothing.
      if (hits !== 1) {
        unprovable.push(`${m.id}: anchor found ${hits} times, want exactly 1`);
        continue;
      }
      const mutated = original.replace(m.from, m.to);
      if (mutated === original) {
        unprovable.push(`${m.id}: replacement changed nothing`);
        continue;
      }
      const file = join(mutantDir, `${m.id}.sh`);
      writeFileSync(file, mutated);
      // Read it back: a write that mangles bytes (CRLF, encoding) would otherwise
      // leave the battery mutating a file the script is not.
      if (readFileSync(file, "utf8") !== mutated) {
        unprovable.push(`${m.id}: the mutant file on disk is not the bytes intended`);
        continue;
      }
      // Syntax must survive, or the mutant dies for the wrong reason and every
      // scenario "catches" it.
      try {
        execFileSync("bash", ["-n", file], { stdio: ["ignore", "pipe", "pipe"] });
      } catch {
        unprovable.push(`${m.id}: the mutant does not even parse — it tests nothing`);
        continue;
      }
      ACTIVE = file;
      const caught = [];
      for (const id of m.caughtBy) {
        const sc = byId.get(id);
        if (!sc) {
          unprovable.push(`${m.id}: caughtBy names an unknown scenario ${id}`);
          continue;
        }
        const problems = await sc.fn();
        if (problems.length > 0) caught.push(id);
      }
      ACTIVE = PROBE;
      if (caught.length === 0) survivors.push(`${m.id} (${m.protection})`);
    }
    ACTIVE = PROBE;

    expect(unprovable, "mutants this battery could not prove it applied").toEqual([]);
    expect(survivors, "mutants no scenario caught").toEqual([]);
    expect(MUTANTS.length).toBeGreaterThanOrEqual(13);
  }, BATTERY_TIMEOUT_MS);
});
