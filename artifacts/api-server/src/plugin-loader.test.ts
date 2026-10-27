import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { 
  activePluginRouter, 
  pluginSource, 
  loadedPluginPath, 
  lastHeartbeatTime, 
  unloadPlugin, 
  setPluginState,
  checkUsbStatus, 
  initializePluginLoader,
  sweepPluginTempFiles 
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
  // other's code or import a file the other one had already unlinked. os.tmpdir()
  // is pointed at a private directory so the names handed to the filesystem are
  // observable and nothing is written to the real temp folder.

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

  async function withPrivateTmpDir(run: (dir: string) => Promise<void>) {
    const dir = path.resolve("./artifacts/api-server/src/temp-upload-test");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const realTmpdir = os.tmpdir;
    const realWrite = fsPromises.writeFile;
    (os as any).tmpdir = () => dir;
    try {
      await run(dir);
    } finally {
      (os as any).tmpdir = realTmpdir;
      (fsPromises as any).writeFile = realWrite;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test("two simultaneous uploads load their own bundle from separate files", async () => {
    process.env["SUPER_ADMIN_USB_KEY"] = "correct-key";

    await withPrivateTmpDir(async (dir) => {
      const upload = makeMockApp().routes["/api/super-admin-setup/upload-plugin"];
      delete (globalThis as any).__plugA;
      delete (globalThis as any).__plugB;

      const written: string[] = [];
      const realWrite = fsPromises.writeFile;
      let parked = false;
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      (fsPromises as any).writeFile = async (p: string, data: any, opts: any) => {
        written.push(String(p));
        if (!parked) { parked = true; await gate; } // hold the first upload between write and import
        return realWrite(p, data, opts);
      };

      const a = makeRes();
      const first = upload(makeReq("correct-key", "globalThis.__plugA = 1;\nexport default (rq, rs, nx) => nx();"), a.res);
      await new Promise((r) => setTimeout(r, 10));
      const b = makeRes();
      const second = upload(makeReq("correct-key", "globalThis.__plugB = 1;\nexport default (rq, rs, nx) => nx();"), b.res);
      release();
      await Promise.all([first, second]);

      expect(a.rec.body).toEqual({ ok: true });
      expect(b.rec.body).toEqual({ ok: true });
      expect(written.length).toBe(2);
      expect(written[0]).not.toBe(written[1]);
      expect((globalThis as any).__plugA).toBe(1);
      expect((globalThis as any).__plugB).toBe(1);
      expect(fs.readdirSync(dir)).toEqual([]);
      delete (globalThis as any).__plugA;
      delete (globalThis as any).__plugB;
    });
  });

  test("a bundle that fails to import is still removed from disk", async () => {
    process.env["SUPER_ADMIN_USB_KEY"] = "correct-key";

    await withPrivateTmpDir(async (dir) => {
      const upload = makeMockApp().routes["/api/super-admin-setup/upload-plugin"];
      const r = makeRes();
      await upload(makeReq("correct-key", "this is not valid javascript ~~"), r.res);

      expect(r.rec.status).toBe(500);
      expect(fs.readdirSync(dir)).toEqual([]);
    });
  });

  test("sweepPluginTempFiles removes orphaned bundles but never a fresh one", async () => {
    await withPrivateTmpDir(async (dir) => {
      const orphan = path.join(dir, "care-superadmin-plugin-aaaaaaaaaaaaaaaa.mjs");
      const inFlight = path.join(dir, "care-superadmin-plugin-bbbbbbbbbbbbbbbb.mjs");
      const unrelated = path.join(dir, "something-else.txt");
      fs.writeFileSync(orphan, "x", "utf8");
      fs.writeFileSync(inFlight, "y", "utf8");
      fs.writeFileSync(unrelated, "z", "utf8");
      const tenMinAgo = new Date(Date.now() - 10 * 60_000);
      fs.utimesSync(orphan, tenMinAgo, tenMinAgo);

      expect(await sweepPluginTempFiles(Date.now())).toBe(1);
      expect(fs.existsSync(orphan)).toBe(false);
      expect(fs.existsSync(inFlight)).toBe(true);
      expect(fs.existsSync(unrelated)).toBe(true);
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
