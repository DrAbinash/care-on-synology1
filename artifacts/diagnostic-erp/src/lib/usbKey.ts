/**
 * Client-side helpers for the super-admin USB pen-drive gate.
 *
 * Two flows live here:
 *
 *  A) Manual one-shot file picker — kept for browsers that don't expose the
 *     File System Access API (Firefox, Safari) and as a fallback. The user
 *     clicks a button, picks `superadmin.key`, we POST it to /usb/verify and
 *     stash the contents in sessionStorage.
 *
 *  B) Auto-detect via File System Access API (Chromium-based browsers used
 *     for kiosks / billing PCs):
 *       1. ONE-TIME pairing: operator hits a hidden key combo
 *          (Ctrl+Alt+U) → showDirectoryPicker() → they pick the pen-drive
 *          root. The FileSystemDirectoryHandle is persisted in IndexedDB.
 *       2. Boot + every few seconds: tryReadKeyFromPairedDir() silently
 *          re-reads `superadmin.key` from that handle. If the read succeeds
 *          AND the key validates server-side, the in-tab key is set →
 *          Super Admin link appears. If the read fails (drive unplugged,
 *          file removed, permission revoked), the key is cleared.
 *     Nothing about this flow is visible in the sidebar — operators who
 *     don't know the pairing combo can't even tell the feature exists.
 */

const USB_KEY_STORAGE_KEY = "sa_usb_key_v1";
const IDB_NAME = "sa_usb_v1";
const IDB_STORE = "handles";
const IDB_HANDLE_KEY = "pen_drive_root";

// ── In-tab key (sessionStorage) ────────────────────────────────────────────

export function getStoredUsbKey(): string | null {
  try {
    const v = sessionStorage.getItem(USB_KEY_STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function storeUsbKey(key: string): void {
  try { sessionStorage.setItem(USB_KEY_STORAGE_KEY, key); } catch { /* ignore */ }
  notifyChange();
}

export function clearUsbKey(): void {
  try { sessionStorage.removeItem(USB_KEY_STORAGE_KEY); } catch { /* ignore */ }
  notifyChange();
}

export async function verifyUsbKey(key: string): Promise<boolean> {
  try {
    const res = await fetch("/api/super-admin/usb/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchUsbGateEnforced(): Promise<boolean> {
  try {
    const res = await fetch("/api/super-admin/usb/status");
    if (!res.ok) return false;
    const body = await res.json() as { enforced?: boolean };
    return Boolean(body.enforced);
  } catch {
    return false;
  }
}

// Tiny event bus so the sidebar can re-render when the key state changes
// (storage events don't fire in the same tab).
type Listener = () => void;
const listeners = new Set<Listener>();
function notifyChange(): void { listeners.forEach((l) => { try { l(); } catch { /* ignore */ } }); }
export function onUsbKeyChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Reads a File (from <input type=file>) and returns its trimmed text body. */
export async function readKeyFile(file: File): Promise<string> {
  const text = await file.text();
  return text.replace(/\s+$/g, "").replace(/^\s+/g, "");
}

// ── IndexedDB-persisted directory handle (auto-detect flow) ────────────────

// Minimal structural typing for the File System Access API so we don't depend
// on `lib.dom`'s flavor of those types (which varies by TS lib version).
type FsPermissionMode = "read" | "readwrite";
interface FsHandle {
  queryPermission?: (opts: { mode: FsPermissionMode }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: FsPermissionMode }) => Promise<PermissionState>;
}
interface FsFileHandle extends FsHandle {
  getFile: () => Promise<File>;
}
interface FsDirectoryHandle extends FsHandle {
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FsFileHandle>;
}
interface ShowDirectoryPickerWindow {
  showDirectoryPicker?: (opts?: { mode?: FsPermissionMode }) => Promise<FsDirectoryHandle>;
}

export function isFsAccessSupported(): boolean {
  return typeof (window as unknown as ShowDirectoryPickerWindow).showDirectoryPicker === "function"
    && typeof indexedDB !== "undefined";
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut<T>(key: string, value: T): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Whether a pen-drive directory has been paired in this browser profile. */
export async function hasPairedPenDrive(): Promise<boolean> {
  try { return Boolean(await idbGet(IDB_HANDLE_KEY)); } catch { return false; }
}

/**
 * Open the directory picker so the operator can pair their pen drive root.
 * Throws if the browser doesn't support FS Access or the user cancels.
 */
export async function pairPenDrive(): Promise<void> {
  const w = window as unknown as ShowDirectoryPickerWindow;
  if (!w.showDirectoryPicker) throw new Error("File System Access API not supported in this browser");
  const handle = await w.showDirectoryPicker({ mode: "read" });
  // Sanity-check: superadmin.key must exist in the chosen dir right now.
  await handle.getFileHandle("superadmin.key");
  await idbPut(IDB_HANDLE_KEY, handle);
}

/** Forget the paired pen drive (e.g. operator wants to re-pair). */
export async function unpairPenDrive(): Promise<void> {
  try { await idbDelete(IDB_HANDLE_KEY); } catch { /* ignore */ }
  clearUsbKey();
}

/**
 * Try once to silently read superadmin.key from the paired directory.
 * Returns the trimmed key text on success, or null on any failure
 * (no pairing, drive unplugged, file missing, permission revoked).
 *
 * This intentionally never prompts the user — `requestPermission()` would
 * require a user-gesture and would expose the feature. If the saved
 * permission has lapsed we just return null and the link stays hidden.
 */
export async function tryReadKeyFromPairedDir(): Promise<string | null> {
  if (!isFsAccessSupported()) return null;
  let dir: FsDirectoryHandle | undefined;
  try { dir = await idbGet<FsDirectoryHandle>(IDB_HANDLE_KEY); } catch { return null; }
  if (!dir) return null;
  try {
    if (typeof dir.queryPermission === "function") {
      const perm = await dir.queryPermission({ mode: "read" });
      if (perm !== "granted") return null;
    }
    const fileHandle = await dir.getFileHandle("superadmin.key");
    const file = await fileHandle.getFile();
    const text = await file.text();
    const trimmed = text.replace(/\s+$/g, "").replace(/^\s+/g, "");
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Request read permission on the paired directory in response to a user
 * gesture (e.g. the hidden pairing combo handler may call this after a fresh
 * page load if Chrome dropped the persisted grant). Returns true if granted.
 */
export async function ensurePairedDirPermission(): Promise<boolean> {
  if (!isFsAccessSupported()) return false;
  let dir: FsDirectoryHandle | undefined;
  try { dir = await idbGet<FsDirectoryHandle>(IDB_HANDLE_KEY); } catch { return false; }
  if (!dir) return false;
  try {
    const cur = (await dir.queryPermission?.({ mode: "read" })) ?? "prompt";
    if (cur === "granted") return true;
    const next = (await dir.requestPermission?.({ mode: "read" })) ?? "prompt";
    return next === "granted";
  } catch {
    return false;
  }
}

export async function tryReadUiFromPairedDir(): Promise<string | null> {
  if (!isFsAccessSupported()) return null;
  let dir: FsDirectoryHandle | undefined;
  try { dir = await idbGet<FsDirectoryHandle>(IDB_HANDLE_KEY); } catch { return null; }
  if (!dir) return null;
  try {
    if (typeof dir.queryPermission === "function") {
      const perm = await dir.queryPermission({ mode: "read" });
      if (perm !== "granted") return null;
    }
    const fileHandle = await dir.getFileHandle("superadmin-ui.js");
    const file = await fileHandle.getFile();
    const text = await file.text();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export async function tryReadApiFromPairedDir(): Promise<string | null> {
  if (!isFsAccessSupported()) return null;
  let dir: FsDirectoryHandle | undefined;
  try { dir = await idbGet<FsDirectoryHandle>(IDB_HANDLE_KEY); } catch { return null; }
  if (!dir) return null;
  try {
    if (typeof dir.queryPermission === "function") {
      const perm = await dir.queryPermission({ mode: "read" });
      if (perm !== "granted") return null;
    }
    const fileHandle = await dir.getFileHandle("superadmin-api.js");
    const file = await fileHandle.getFile();
    const text = await file.text();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

