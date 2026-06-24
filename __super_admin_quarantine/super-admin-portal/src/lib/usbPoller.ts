/**
 * USB pen-drive polling for the super-admin portal.
 *
 * Uses the File System Access API (Chromium) to hold a persistent reference
 * to the pen-drive root directory and re-reads `superadmin.key` every few
 * seconds. If the drive is removed or the file disappears, `tryReadKey()`
 * returns null, and the caller (App.tsx) should immediately eject the session.
 *
 * On Firefox / Safari where the FS Access API is unavailable, all functions
 * are no-ops / return null — the fallback is the existing `<input type="file">`
 * flow, which still leaves the server-side USB key check in place but won't
 * auto-lock on physical removal.
 */

const IDB_NAME = "sa_portal_usb_v1";
const IDB_STORE = "handles";
const IDB_HANDLE_KEY = "pen_drive_root";

// ── Minimal structural types so we don't depend on a specific lib.dom version ─

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

// ── Support check ─────────────────────────────────────────────────────────────

export function isFsAccessSupported(): boolean {
  return (
    typeof (window as unknown as ShowDirectoryPickerWindow).showDirectoryPicker === "function" &&
    typeof indexedDB !== "undefined"
  );
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

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

export async function idbDelete(key: string): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** True if a pen-drive directory handle has been saved in this browser profile. */
export async function hasPairedDrive(): Promise<boolean> {
  try { return Boolean(await idbGet(IDB_HANDLE_KEY)); } catch { return false; }
}

/**
 * Show the directory picker and save the drive root handle to IndexedDB.
 * Also validates that `superadmin.key` is present in the chosen directory.
 * Throws if the browser doesn't support FS Access, the user cancels, or the
 * key file is not found.
 *
 * Returns the trimmed key text on success.
 */
export async function pairPenDrive(): Promise<string> {
  const w = window as unknown as ShowDirectoryPickerWindow;
  if (!w.showDirectoryPicker) throw new Error("File System Access API not available");
  const handle = await w.showDirectoryPicker({ mode: "read" });
  // Verify key file exists before committing the pair.
  const fileHandle = await handle.getFileHandle("superadmin.key");
  const file = await fileHandle.getFile();
  const text = (await file.text()).trim();
  if (!text) throw new Error("superadmin.key is empty");
  await idbPut(IDB_HANDLE_KEY, handle);
  return text;
}

/** Forget the paired pen drive. */
export async function unpairPenDrive(): Promise<void> {
  try { await idbDelete(IDB_HANDLE_KEY); } catch { /* ignore */ }
}

/**
 * Silently try to re-read `superadmin.key` from the paired directory.
 * Returns the trimmed key text, or null on ANY failure (no pairing,
 * drive unplugged, file missing, permission revoked).
 *
 * Never prompts the user — if permission has lapsed we return null silently.
 */
export async function tryReadKey(): Promise<string | null> {
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
    const text = (await file.text()).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Silently try to read `superadmin.pin` from the paired directory.
 * Returns the trimmed PIN text, or null if the file is missing / unreadable.
 */
export async function tryReadPin(): Promise<string | null> {
  if (!isFsAccessSupported()) return null;
  let dir: FsDirectoryHandle | undefined;
  try { dir = await idbGet<FsDirectoryHandle>(IDB_HANDLE_KEY); } catch { return null; }
  if (!dir) return null;
  try {
    if (typeof dir.queryPermission === "function") {
      const perm = await dir.queryPermission({ mode: "read" });
      if (perm !== "granted") return null;
    }
    const fileHandle = await dir.getFileHandle("superadmin.pin");
    const file = await fileHandle.getFile();
    const text = (await file.text()).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}
