import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 
  activePluginRouter, 
  pluginSource, 
  loadedPluginPath, 
  lastHeartbeatTime, 
  unloadPlugin, 
  setPluginState,
  checkUsbStatus, 
  initializePluginLoader 
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
});
