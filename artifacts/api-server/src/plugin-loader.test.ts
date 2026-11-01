import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { 
  activePluginRouter, 
  pluginSource, 
  loadedPluginPath, 
  lastHeartbeatTime, 
  unloadPlugin, 
  setPluginState,
  checkUsbStatus, 
  initializePluginLoader,
  sweepPluginTempFiles,
  pluginBundleDir
} from "./plugin-loader";

describe("Plugin Loader & USB Gate", () => {
  let tempUsbDir: string;
  let originalEnv: Record<string, string | undefined>;

  beforeAll(() => {
    // Keep temporary dir inside the workspace so ESM resolution finds node_modules
    tempUsbDir = path.resolve("./artifacts/api-server/src/temp-usb-test");
    if (!fs.existsSync(tempUsbDir)) {
      fs.mkdirSync(tempUsbDir, { recursive: true });
    }
    originalEnv = { ...process.env };
  });

  afterAll(() => {
    try {
      fs.rmSync(tempUsbDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    unloadPlugin();
  });

  afterEach(() => {
    // Correctly restore process.env
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    unloadPlugin();
  });

  test("does not load plugin when USB path is empty or files are missing", async () => {
    process.env["SUPER_ADMIN_USB_PATH"] = tempUsbDir;
    process.env["SUPER_ADMIN_USB_KEY"] = "correct-key";
    
    // Ensure clean directory
    try {
      fs.unlinkSync(path.join(tempUsbDir, "superadmin.key"));
    } catch {}
    try {
      fs.unlinkSync(path.join(tempUsbDir, "superadmin-api.js"));
    } catch {}

    await checkUsbStatus();
    expect(activePluginRouter).toBeNull();
  });

  test("loads plugin when valid USB path and matching key are detected", async () => {
    const keyPath = path.join(tempUsbDir, "superadmin.key");
    const pluginPath = path.join(tempUsbDir, "superadmin-api.js");

    fs.writeFileSync(keyPath, "correct-key", "utf8");
    
    // Plain middleware function to avoid importing express
    fs.writeFileSync(pluginPath, `
      export default (req, res, next) => next();
    `, "utf8");

    process.env["SUPER_ADMIN_USB_PATH"] = tempUsbDir;
    process.env["SUPER_ADMIN_USB_KEY"] = "correct-key";

    await checkUsbStatus();

    expect(activePluginRouter).not.toBeNull();
    expect(pluginSource).toBe("local");
    expect(loadedPluginPath).toBe(pluginPath);
  });

  test("unloads plugin when USB key mismatches", async () => {
    const keyPath = path.join(tempUsbDir, "superadmin.key");
    const pluginPath = path.join(tempUsbDir, "superadmin-api.js");

    fs.writeFileSync(keyPath, "wrong-key", "utf8");
    fs.writeFileSync(pluginPath, `
      export default (req, res, next) => next();
    `, "utf8");

    process.env["SUPER_ADMIN_USB_PATH"] = tempUsbDir;
    process.env["SUPER_ADMIN_USB_KEY"] = "correct-key";

    // Set mock loaded state
    setPluginState((req: any, res: any, next: any) => next(), "local", pluginPath, Date.now());

    await checkUsbStatus();

    expect(activePluginRouter).toBeNull();
    expect(pluginSource).toBeNull();
  });

  test("handles uploaded plugin via API and supports heartbeat expiration", async () => {
    process.env["SUPER_ADMIN_USB_KEY"] = "correct-key";

    const mockApp: any = {
      routes: {} as Record<string, Function>,
      post(path: string, handler: Function) {
        this.routes[path] = handler;
      }
    };

    initializePluginLoader(mockApp);

    const uploadHandler = mockApp.routes["/api/super-admin-setup/upload-plugin"];
    const heartbeatHandler = mockApp.routes["/api/super-admin-setup/heartbeat"];

    expect(uploadHandler).toBeDefined();
    expect(heartbeatHandler).toBeDefined();

    // 1. Upload plugin with missing/invalid header key
    let responseStatus = 200;
    let responseData: any = {};
    const mockRes: any = {
      status(code: number) {
        responseStatus = code;
        return this;
      },
      json(data: any) {
        responseData = data;
        return this;
      }
    };

    const mockReqInvalidHeader: any = {
      header(name: string) {
        if (name === "x-sa-usb-key") return "wrong-key";
        return "";
      },
      body: { code: "export default (req, res, next) => next();" }
    };

    await uploadHandler(mockReqInvalidHeader, mockRes);
    expect(responseStatus).toBe(401);
    expect(activePluginRouter).toBeNull();

    // 2. Upload valid plugin
    responseStatus = 200; // Reset status
    const mockReqValid: any = {
      header(name: string) {
        if (name === "x-sa-usb-key") return "correct-key";
        return "";
      },
      body: { 
        code: `
          export default (req, res, next) => next();
        ` 
      }
    };

    await uploadHandler(mockReqValid, mockRes);
    expect(responseStatus).toBe(200);
    expect(responseData.ok).toBe(true);
    expect(activePluginRouter).not.toBeNull();
    expect(pluginSource).toBe("uploaded");

    // 3. Heartbeat check
    responseStatus = 200; // Reset status
    const mockReqHeartbeat: any = {
      header(name: string) {
        if (name === "x-sa-usb-key") return "correct-key";
        return "";
      }
    };

    await heartbeatHandler(mockReqHeartbeat, mockRes);
    expect(responseStatus).toBe(200);
    expect(responseData.active).toBe(true);

    // 4. Test heartbeat expiration via checkUsbStatus
    setPluginState(activePluginRouter, "uploaded", loadedPluginPath, Date.now() - 40000);

    await checkUsbStatus();

    expect(activePluginRouter).toBeNull();
    expect(pluginSource).toBeNull();
  });

  // ── uploaded bundle temp file ─────────────────────────────────────────────
  // The bundle is written to disk only so Node can import() it. It used to go to
  // one fixed path, so two operators uploading at the same moment could load each
  // other's code or import a file the other one had already unlinked. Where it
  // goes is a second, separate contract: superadmin-api.js imports host packages
  // by bare name, and Node resolves those by walking up from the file being
  // imported, so a directory with no node_modules above it cannot mount the
  // portal at all (see the "resolves the packages it imports by name" test).

  function makeMockApp() {
    const mockApp: any = {
      routes: {} as Record<string, Function>,
      post(p: string, h: Function) { this.routes[p] = h; },
    };
    initializePluginLoader(mockApp);
    return mockApp;
  }

  function makeReq(key: string, code: string): any {
    return { header: (n: string) => (n === "x-sa-usb-key" ? key : ""), body: { code } };
  }

  function makeRes() {
    const rec: { status: number; body: any } = { status: 200, body: null };
    const res: any = {
      status(code: number) { rec.status = code; return this; },
      json(data: any) { rec.body = data; return this; },
    };
    return { res, rec };
  }

  /** Capture the paths the upload handler hands to writeFile, whatever they are. */
  function spyOnWrites(into: string[]) {
    const real = fsPromises.writeFile;
    (fsPromises as any).writeFile = async (p: string, data: any, opts: any) => {
      into.push(String(p));
      return (real as any)(p, data, opts);
    };
    return () => { (fsPromises as any).writeFile = real; };
  }

  async function withPrivateTmpDir(run: (dir: string) => Promise<void>) {
    const dir = path.resolve("./artifacts/api-server/src/temp-upload-test");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const realTmpdir = os.tmpdir;
    try {
      (os as any).tmpdir = () => dir;
      await run(dir);
    } finally {
      (os as any).tmpdir = realTmpdir;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test("the bundle directory is the tree Node resolves host packages from", () => {
    const dir = pluginBundleDir();
    // The rule the handler depends on: this directory owns a node_modules, so a
    // bare specifier in the bundle walks up and finds it.
    expect(fs.existsSync(path.join(dir, "node_modules"))).toBe(true);
    // And it is not the temp folder - that is the regression this replaces.
    expect(dir).not.toBe(os.tmpdir());
  });

  test("the uploaded bundle resolves the host packages it imports by name", async () => {
    process.env["SUPER_ADMIN_USB_KEY"] = "correct-key";
    const written: string[] = [];
    const stop = spyOnWrites(written);
    try {
      const upload = makeMockApp().routes["/api/super-admin-setup/upload-plugin"];
      const r = makeRes();
      // zod is external in the pen-drive bundle, exactly as the portal ships it.
      await upload(makeReq("correct-key", `
        import { z } from "zod";
        export default (rq, rs, nx) => rs.json({ ok: typeof z });
      `), r.res);

      expect(written.length, "bundle was never written to disk").toBe(1);
      expect(r.rec.status, `${written[0]} -> ${JSON.stringify(r.rec.body)}`).toBe(200);
      expect(activePluginRouter).not.toBeNull();
    } finally {
      stop();
    }
  });

  test("a bundle written where host packages cannot resolve is reported as a mount failure", async () => {
    // Control for the test above: the same code imported from a directory with no
    // node_modules above it fails with the message the clinic saw on screen. If
    // this passes with a 200, the other test proves nothing.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "care-no-node-modules-"));
    try {
      const file = path.join(outside, "bundle.mjs");
      fs.writeFileSync(file, `import { z } from "zod";\nexport default { ok: typeof z };\n`, "utf8");
      await expect(import(url.pathToFileURL(file).href)).rejects.toThrow(/Cannot find package 'zod'/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test("two simultaneous uploads load their own bundle from separate files", async () => {
    process.env["SUPER_ADMIN_USB_KEY"] = "correct-key";

    const written: string[] = [];
    const upload = makeMockApp().routes["/api/super-admin-setup/upload-plugin"];
    delete (globalThis as any).__plugA;
    delete (globalThis as any).__plugB;

    const real = fsPromises.writeFile;
    const a = makeRes();
    const b = makeRes();
    let parked = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    (fsPromises as any).writeFile = async (p: string, data: any, opts: any) => {
      written.push(String(p));
      if (!parked) { parked = true; await gate; } // hold the first upload between write and import
      return (real as any)(p, data, opts);
    };

    try {
      const first = upload(makeReq("correct-key", "globalThis.__plugA = 1;\nexport default (rq, rs, nx) => nx();"), a.res);
      await new Promise((r) => setTimeout(r, 10));
      const second = upload(makeReq("correct-key", "globalThis.__plugB = 1;\nexport default (rq, rs, nx) => nx();"), b.res);
      release();
      await Promise.all([first, second]);
    } finally {
      (fsPromises as any).writeFile = real;
    }

    expect(a.rec.body).toEqual({ ok: true });
    expect(b.rec.body).toEqual({ ok: true });
    expect(written.length).toBe(2);
    expect(written[0]).not.toBe(written[1]);
    for (const p of written) {
      expect(path.dirname(p)).toBe(pluginBundleDir());
      expect(fs.existsSync(p), `${p} left on disk`).toBe(false);
    }
    expect((globalThis as any).__plugA).toBe(1);
    expect((globalThis as any).__plugB).toBe(1);
    delete (globalThis as any).__plugA;
    delete (globalThis as any).__plugB;
  });

  test("a bundle that fails to import is still removed from disk", async () => {
    process.env["SUPER_ADMIN_USB_KEY"] = "correct-key";

    const written: string[] = [];
    const stop = spyOnWrites(written);
    try {
      const upload = makeMockApp().routes["/api/super-admin-setup/upload-plugin"];
      const r = makeRes();
      await upload(makeReq("correct-key", "this is not valid javascript ~~"), r.res);

      expect(r.rec.status).toBe(500);
      expect(written.length).toBe(1);
      expect(fs.existsSync(written[0]!), `${written[0]} left on disk`).toBe(false);
    } finally {
      stop();
    }
  });

  test("sweepPluginTempFiles removes orphaned bundles but never a fresh one", async () => {
    await withPrivateTmpDir(async (dir) => {
      // Orphans live in both places: the app tree the handler writes to now, and
      // the temp folder the previous build wrote to.
      const bundleDir = pluginBundleDir();
      const staleInTmp = path.join(dir, "care-superadmin-plugin-aaaaaaaaaaaaaaaa.mjs");
      const staleInTree = path.join(bundleDir, "care-superadmin-plugin-cccccccccccccccc.mjs");
      const inFlight = path.join(dir, "care-superadmin-plugin-bbbbbbbbbbbbbbbb.mjs");
      const unrelated = path.join(dir, "something-else.txt");
      fs.writeFileSync(staleInTmp, "x", "utf8");
      fs.writeFileSync(staleInTree, "x", "utf8");
      fs.writeFileSync(inFlight, "y", "utf8");
      fs.writeFileSync(unrelated, "z", "utf8");
      const tenMinAgo = new Date(Date.now() - 10 * 60_000);
      fs.utimesSync(staleInTmp, tenMinAgo, tenMinAgo);
      fs.utimesSync(staleInTree, tenMinAgo, tenMinAgo);

      try {
        expect(await sweepPluginTempFiles(Date.now())).toBe(2);
        expect(fs.existsSync(staleInTmp)).toBe(false);
        expect(fs.existsSync(staleInTree)).toBe(false);
        expect(fs.existsSync(inFlight)).toBe(true);
        expect(fs.existsSync(unrelated)).toBe(true);
      } finally {
        for (const f of [inFlight, unrelated]) { try { fs.unlinkSync(f); } catch {} }
        try { fs.unlinkSync(staleInTree); } catch {}
      }
    });
  });

  test("a lost heartbeat leaves the routes down and says so to the client", async () => {
    process.env["SUPER_ADMIN_USB_KEY"] = "correct-key";
    const app = makeMockApp();
    const heartbeat = app.routes["/api/super-admin-setup/heartbeat"];

    setPluginState(((_rq: any, _rs: any, nx: any) => nx()) as any, "uploaded", "temp-superadmin-api.mjs", Date.now() - 40_000);
    await checkUsbStatus();
    expect(activePluginRouter).toBeNull();

    const r = makeRes();
    await heartbeat(makeReq("correct-key", ""), r.res);

    // active:false is what the ERP now acts on by uploading the bundle again.
    // The server cannot restore it alone: the file it was loaded from is gone.
    expect(r.rec.status).toBe(200);
    expect(r.rec.body).toEqual({ ok: true, active: false });
    expect(pluginSource).toBeNull();
  });
});
