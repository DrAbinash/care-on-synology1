// ============================================================================
// CARE DEV LAUNCHER — `pnpm dev:isolated` / scripts/dev-erp-local.mjs.
//
// This suite exists because the launcher silently did nothing on Windows for
// two separate reasons, and neither was visible from the source text:
//   * the repo root was computed as "/C:/Users/…" and then resolved to
//     "C:\C:\Users…", so the root .env was never found;
//   * `spawn("pnpm", …)` fails with ENOENT on Windows, where pnpm is an
//     extensionless shim plus pnpm.CMD/pnpm.ps1 and the real pnpm.exe lives
//     under a version-hashed directory. Node will not exec a .CMD without a
//     shell, and does not apply PATHEXT.
// A grep-based test would have stayed green through both. So most of what is
// below actually runs the launcher and reads what its children observed.
// ============================================================================
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  ROOT,
  childSpecs,
  detectIsolation,
  killChild,
  loadDotenv,
  maskUrl,
  prepareEnv,
  runnerInvocation,
} from "./dev-erp-local.mjs";

const LAUNCHER = fileURLToPath(new URL("./dev-erp-local.mjs", import.meta.url));
const IS_WIN = process.platform === "win32";
const APPROVED_DB = "postgresql://erp:devpass@127.0.0.1:5411/care_dev";

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "care-dev-launcher-"));
  const marker = path.join(dir, "children-observed.txt");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  // A stub package runner that records how it was called and what environment
  // it was called with, then exits 0 so the launcher's race resolves promptly.
  if (IS_WIN) {
    // cmd.exe resolves `pnpm` to pnpm.cmd through PATHEXT — the same lookup the
    // real launcher depends on.
    fs.writeFileSync(
      path.join(bin, "pnpm.cmd"),
      [
        "@echo off",
        `echo ARGS:%* >> "${marker}"`,
        `echo ISO:[%CARE_DEV_ISOLATED%] PORT:[%PORT%] ERP:[%CARE_DEV_ERP_PORT%] DB:[%DATABASE_URL%] >> "${marker}"`,
        "exit /b 0",
        "",
      ].join("\r\n")
    );
  } else {
    const stub = path.join(bin, "pnpm");
    fs.writeFileSync(
      stub,
      `#!/bin/sh\nprintf 'ARGS:%s\\n' "$*" >> '${marker}'\nprintf 'ISO:[%s] PORT:[%s] ERP:[%s] DB:[%s]\\n' "$CARE_DEV_ISOLATED" "$PORT" "$CARE_DEV_ERP_PORT" "$DATABASE_URL" >> '${marker}'\nexit 0\n`
    );
    fs.chmodSync(stub, 0o755);
  }
  return { dir, marker, bin };
}

function runLauncher({ args = [], env = {} } = {}) {
  const ws = workspace();
  const res = spawnSync(process.execPath, [LAUNCHER, ...args], {
    encoding: "utf8",
    timeout: 90_000,
    env: {
      ...process.env,
      PATH: `${ws.bin}${path.delimiter}${process.env.PATH}`,
      DATABASE_URL: APPROVED_DB,
      PORT: "8080",
      ...env,
    },
  });
  const observed = fs.existsSync(ws.marker) ? fs.readFileSync(ws.marker, "utf8") : "";
  fs.rmSync(ws.dir, { recursive: true, force: true });
  return { ...res, observed, markerExisted: observed !== "" };
}

describe("the package runner is resolved per platform", () => {
  test("Windows goes through a shell, because Node cannot exec the pnpm shim", () => {
    expect(runnerInvocation("win32")).toEqual({ command: "pnpm", shell: true });
  });

  test("macOS and Linux keep an argument array and no shell", () => {
    for (const platform of ["darwin", "linux", "freebsd"]) {
      expect(runnerInvocation(platform)).toEqual({ command: "pnpm", shell: false });
    }
  });

  test("the current platform's spec is the one that will actually be spawned", () => {
    expect(runnerInvocation()).toEqual(runnerInvocation(process.platform));
  });

  test("both children are specified, in order, with their real package names", () => {
    const specs = childSpecs({ root: "/tmp/wherever" });
    expect(specs.map((s) => s.pkg)).toEqual(["@workspace/api-server", "@workspace/diagnostic-erp"]);
    for (const s of specs) {
      expect(s.args).toEqual(["--filter", s.pkg, "run", "dev"]);
      expect(s.options.cwd).toBe("/tmp/wherever");
      expect(s.options.stdio).toBe("inherit");
      expect(s.options.shell).toBe(IS_WIN);
    }
  });
});

describe("the repo root is computed the way Windows needs", () => {
  test("ROOT is the real monorepo root — package.json and both artifacts live under it", () => {
    expect(fs.existsSync(path.join(ROOT, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "artifacts", "api-server", "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "artifacts", "diagnostic-erp", "vite.config.ts"))).toBe(true);
    expect(path.basename(ROOT)).not.toBe("scripts");
  });

  test("the discarded pathname form is proven wrong, so nobody reverts to it", () => {
    // This is the exact expression that shipped before: on a Windows file URL it
    // yields "/C:/…", and a Windows path resolve turns that into a root that
    // cannot exist — the launcher then never finds the .env it needs.
    const pathname = new URL("file:///C:/care-development/scripts/dev-erp-local.mjs").pathname;
    expect(pathname).toBe("/C:/care-development/scripts/dev-erp-local.mjs");
    expect(path.win32.resolve(path.win32.dirname(pathname), "..")).toBe("C:\\C:\\care-development");
    // path.win32 is used above so this proves itself on any runner, CI included.
    expect(path.win32.basename("C:\\care-development\\.env")).toBe(".env");
  });
});

describe("isolated mode shapes the children's environment", () => {
  test("--isolated sets the flag, drops PORT and defaults the ERP port", () => {
    const { isolated, env } = prepareEnv(["--isolated"], { DATABASE_URL: APPROVED_DB, PORT: "8080" });
    expect(isolated).toBe(true);
    expect(env.CARE_DEV_ISOLATED).toBe("1");
    expect("PORT" in env).toBe(false);
    expect(env.CARE_DEV_ERP_PORT).toBe("5173");
  });

  test("without the flag nothing is touched — production behaviour is preserved", () => {
    const { isolated, env } = prepareEnv([], { DATABASE_URL: "postgresql://x", PORT: "8080" });
    expect(isolated).toBe(false);
    expect(env.PORT).toBe("8080");
    expect(env.CARE_DEV_ISOLATED).toBeUndefined();
    expect(env.CARE_DEV_ERP_PORT).toBeUndefined();
  });

  test("an explicit CARE_DEV_ERP_PORT survives the default", () => {
    const { env } = prepareEnv([], { CARE_DEV_ISOLATED: "1", CARE_DEV_ERP_PORT: "5199" });
    expect(env.CARE_DEV_ERP_PORT).toBe("5199");
  });

  test("the flag is read from the same spellings the API accepts", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on"]) {
      expect(detectIsolation([], { CARE_DEV_ISOLATED: value })).toBe(true);
    }
    for (const value of ["", "0", "false", "no", "off", undefined]) {
      expect(detectIsolation([], { CARE_DEV_ISOLATED: value })).toBe(false);
    }
    expect(detectIsolation(["--isolated"], {})).toBe(true);
  });

  test("a .env value does not override what the operator exported", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "care-dev-dotenv-"));
    const file = path.join(dir, ".env");
    try {
      fs.writeFileSync(file, 'DATABASE_URL="postgresql://from-dotenv"\n# comment\n\nNOEQUALS\nBARE=\n');
      const env = loadDotenv(file, { DATABASE_URL: "postgresql://from-shell" });
      expect(env.DATABASE_URL).toBe("postgresql://from-shell");
      const empty = loadDotenv(file, {});
      expect(empty.DATABASE_URL).toBe("postgresql://from-dotenv");
      expect(env.NOEQUALS).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a missing .env is not an error", () => {
    expect(() => loadDotenv(path.join(os.tmpdir(), "definitely-not-here-42", ".env"), { A: "1" })).not.toThrow();
    expect(loadDotenv(path.join(os.tmpdir(), "definitely-not-here-42", ".env"), { A: "1" })).toEqual({ A: "1" });
  });
});

describe("stopping the children", () => {
  test("a child that already exited is not killed again", () => {
    const dead = { killed: false, exitCode: 0, signalCode: null, pid: 999_999, kill: () => expect.unreachable("killed an exited child") };
    expect(() => killChild(dead, "linux")).not.toThrow();
  });

  test("a missing pid is refused rather than handed to taskkill", () => {
    const noPid = { killed: false, exitCode: null, signalCode: null, pid: undefined, kill: () => {} };
    expect(() => killChild(noPid, "win32")).not.toThrow();
  });

  test("POSIX uses the signal path, not taskkill", () => {
    let signalled = null;
    const child = { killed: false, exitCode: null, signalCode: null, pid: 4242, kill: (s) => (signalled = s) };
    killChild(child, "darwin", "SIGINT");
    expect(signalled).toBe("SIGINT");
  });
});

describe("the database URL never reaches a terminal in full", () => {
  test("password and username are masked", () => {
    const masked = maskUrl("postgresql://erp:s3cr3t@127.0.0.1:5411/care_dev");
    expect(masked).not.toContain("s3cr3t");
    expect(masked).toContain("127.0.0.1:5411/care_dev");
  });

  test("an unparseable value is described, not thrown", () => {
    expect(maskUrl("not a url")).toBe("(unparseable URL)");
  });
});

// ----------------------------------------------------------------------------
// The proofs that matter: run the launcher for real and read what its children
// saw. This is what would have caught the Windows ENOENT.
// ----------------------------------------------------------------------------
describe("the launcher actually starts both children", () => {
  test(
    "isolated run spawns api and ERP with the flag set and PORT gone",
    () => {
      const r = runLauncher({ args: ["--isolated"] });
      expect(r.status, `launcher stderr: ${r.stderr}`).toBe(0);
      expect(r.stdout).toContain("CARE_DEV_ISOLATED");
      expect(r.stderr).not.toContain("could not start");
      expect(r.markerExisted, "no child ever ran — the spawn failed, which is the bug this guards").toBe(true);
      expect(r.observed).toContain("--filter @workspace/api-server run dev");
      expect(r.observed).toContain("--filter @workspace/diagnostic-erp run dev");
      expect(r.observed).toContain("ISO:[1]");
      expect(r.observed).toContain("PORT:[]");
      expect(r.observed).toContain("ERP:[5173]");
      // The banner is meant to be pasted into a ticket, so it may name the host
      // and database but must never echo the password the stub received.
      expect(r.stdout).toContain("127.0.0.1:5411/care_dev");
      expect(r.stdout).not.toContain("devpass");
    },
    120_000
  );

  test(
    "without --isolated the flag is absent and PORT is passed through untouched",
    () => {
      const r = runLauncher({ args: [] });
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("isolated development mode");
      expect(r.markerExisted).toBe(true);
      expect(r.observed).toContain("ISO:[]");
      expect(r.observed).toContain("PORT:[8080]");
    },
    120_000
  );

  test(
    "the flag alone in the environment is enough — no --isolated argument needed",
    () => {
      const r = runLauncher({ env: { CARE_DEV_ISOLATED: "1" } });
      expect(r.stdout).toContain("CARE_DEV_ISOLATED");
      expect(r.observed).toContain("ISO:[1]");
    },
    120_000
  );

  test(
    "a missing DATABASE_URL stops before any child is spawned",
    () => {
      const r = runLauncher({ args: ["--isolated"], env: { DATABASE_URL: "" } });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("DATABASE_URL is missing");
      expect(r.markerExisted, "the launcher must not spawn a child it cannot configure").toBe(false);
    },
    120_000
  );

  test("--help explains both modes and starts nothing", () => {
    const r = runLauncher({ args: ["--help"] });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--isolated");
    expect(r.stdout).toContain("127.0.0.1:5411/care_dev");
    expect(r.markerExisted).toBe(false);
  });
});
