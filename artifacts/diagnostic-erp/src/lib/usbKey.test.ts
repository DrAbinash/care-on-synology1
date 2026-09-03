import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Gesture-sensitive pairing helpers — ensure showDirectoryPicker / requestPermission
 * are invoked before any IndexedDB await so Chromium user-activation is preserved.
 */

function installIdb(store: Map<string, unknown>, onTx?: (mode: string) => void) {
  const fakeDb = {
    objectStoreNames: { contains: () => true },
    transaction: (_store: string, mode: string) => {
      onTx?.(mode);
      const tx: {
        objectStore: () => {
          get: (key: string) => { onsuccess: null | (() => void); onerror: null | (() => void); result?: unknown };
          put: (value: unknown, key: string) => Record<string, never>;
          delete: (key: string) => Record<string, never>;
        };
        oncomplete: null | (() => void);
        onerror: null | (() => void);
        error?: unknown;
      } = {
        objectStore: () => ({
          get: (key: string) => {
            const req: {
              onsuccess: null | (() => void);
              onerror: null | (() => void);
              result?: unknown;
            } = { onsuccess: null, onerror: null };
            queueMicrotask(() => {
              req.result = store.get(key);
              req.onsuccess?.();
            });
            return req;
          },
          put: (value: unknown, key: string) => {
            store.set(key, value);
            return {};
          },
          delete: (key: string) => {
            store.delete(key);
            return {};
          },
        }),
        oncomplete: null,
        onerror: null,
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  };
  vi.stubGlobal("indexedDB", {
    open: () => {
      const req: {
        result: typeof fakeDb;
        onupgradeneeded: null | (() => void);
        onsuccess: null | (() => void);
        onerror: null | (() => void);
        error?: unknown;
      } = {
        result: fakeDb,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  });
}

describe("usbKey pen-drive pairing gestures", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("beginPairPenDrive calls showDirectoryPicker before any await", async () => {
    const callOrder: string[] = [];
    const fileHandle = {
      getFile: async () => ({ text: async () => "test-key" }),
    };
    const dirHandle = {
      getFileHandle: async (name: string) => {
        callOrder.push(`getFileHandle:${name}`);
        if (name !== "superadmin.key") throw new Error("missing");
        return fileHandle;
      },
      queryPermission: async () => "granted" as PermissionState,
      requestPermission: async () => "granted" as PermissionState,
    };

    const showDirectoryPicker = vi.fn(() => {
      callOrder.push("showDirectoryPicker");
      return Promise.resolve(dirHandle);
    });

    const idbStore = new Map<string, unknown>();
    installIdb(idbStore, (mode) => callOrder.push(`idb:${mode}`));
    vi.stubGlobal("showDirectoryPicker", showDirectoryPicker);
    // usbKey reads `window.showDirectoryPicker`
    vi.stubGlobal("window", { showDirectoryPicker });

    const { beginPairPenDrive } = await import("./usbKey");
    const pairPromise = beginPairPenDrive();
    expect(callOrder[0]).toBe("showDirectoryPicker");
    await pairPromise;
    expect(showDirectoryPicker).toHaveBeenCalledOnce();
    expect(callOrder).toContain("getFileHandle:superadmin.key");
    expect(callOrder.some((c) => c.startsWith("idb:"))).toBe(true);
  });

  it("beginEnsurePairedDirPermission uses cached handle without opening IDB first", async () => {
    const requestPermission = vi.fn(async () => "granted" as PermissionState);
    const dirHandle = {
      getFileHandle: async () => ({ getFile: async () => ({ text: async () => "k" }) }),
      queryPermission: async () => "prompt" as PermissionState,
      requestPermission,
    };

    const idbStore = new Map<string, unknown>([["pen_drive_root", dirHandle]]);
    let idbOpens = 0;
    installIdb(idbStore, () => {
      idbOpens += 1;
    });
    vi.stubGlobal("window", { showDirectoryPicker: vi.fn() });

    const mod = await import("./usbKey");
    await mod.preloadPairedDirHandle();
    expect(mod.hasPairedPenDriveSync()).toBe(true);
    const opensAfterPreload = idbOpens;

    const granted = await mod.beginEnsurePairedDirPermission();
    expect(granted).toBe(true);
    expect(requestPermission).toHaveBeenCalledOnce();
    // Permission path must not touch IndexedDB again (gesture safety).
    expect(idbOpens).toBe(opensAfterPreload);
  });
});

describe("openSuperAdminPortal Zero-Trace navigation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens /super-admin-portal/ in a new tab (never SPA path without slash)", async () => {
    const open = vi.fn(() => ({ focus: () => undefined }));
    vi.stubGlobal("window", {
      open,
      location: { assign: vi.fn(), hash: "" },
    });
    const mod = await import("./usbKey");
    mod.openSuperAdminPortal("books");
    expect(open).toHaveBeenCalledWith("/super-admin-portal/#books", "_blank", "noopener,noreferrer");
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("falls back to same-tab assign when popup is blocked", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      open: vi.fn(() => null),
      location: { assign, hash: "" },
    });
    const mod = await import("./usbKey");
    mod.openSuperAdminPortal();
    expect(assign).toHaveBeenCalledWith("/super-admin-portal/");
  });
});

describe("superadmin pendrive crash regression contracts", () => {
  it("Layout must not SPA-navigate into /super-admin-portal under PermissionGuard", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const layout = readFileSync(join(__dirname, "../components/Layout.tsx"), "utf8");
    const app = readFileSync(join(__dirname, "../App.tsx"), "utf8");
    expect(layout).toMatch(/openSuperAdminPortal/);
    expect(layout).not.toMatch(/navigate\(`\/super-admin-portal/);
    // Must not inject USB UI createRoot into ERP document
    expect(layout).not.toMatch(/tryReadUiFromPairedDir/);
    expect(layout).toMatch(/Do NOT inject superadmin-ui\.js/);
    // Guard must hard-redirect to full-page bootstrap, not bounce to "/"
    expect(app).toMatch(/window\.location\.replace\(`\/super-admin-portal\//);
    expect(app).not.toMatch(/normalizedRole !== "super_admin"[\s\S]{0,80}navigate\("\/"/);
    // Embedded SuperAdminPortal route under Layout must be gone
    expect(app).not.toMatch(/SuperAdminPortal/);
  });
});
