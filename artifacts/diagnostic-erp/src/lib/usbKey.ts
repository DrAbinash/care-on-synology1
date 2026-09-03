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

/** In-memory cache so gesture handlers can call requestPermission / know
 *  pairing state without an IndexedDB await that would drop user activation. */
let cachedDirHandle: FsDirectoryHandle | null | undefined = undefined;

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

/** Warm the in-memory directory-handle cache (call once on app mount). */
export async function preloadPairedDirHandle(): Promise<boolean> {
  try {
    cachedDirHandle = (await idbGet<FsDirectoryHandle>(IDB_HANDLE_KEY)) ?? null;
  } catch {
    cachedDirHandle = null;
  }
  return cachedDirHandle != null;
}

/**
 * Synchronous pairing check from the in-memory cache.
 * Returns `null` until {@link preloadPairedDirHandle} (or a pair/unpair) has run.
 */
export function hasPairedPenDriveSync(): boolean | null {
  if (cachedDirHandle === undefined) return null;
  return cachedDirHandle != null;
}

/** Whether a pen-drive directory has been paired in this browser profile. */
export async function hasPairedPenDrive(): Promise<boolean> {
  if (cachedDirHandle !== undefined) return cachedDirHandle != null;
  try {
    cachedDirHandle = (await idbGet<FsDirectoryHandle>(IDB_HANDLE_KEY)) ?? null;
    return cachedDirHandle != null;
  } catch {
    cachedDirHandle = null;
    return false;
  }
}

/**
 * Start the directory picker **synchronously** from a user-gesture handler
 * (keydown / click). Chromium's File System Access API requires transient
 * user activation — any `await` before `showDirectoryPicker()` drops the
 * gesture and the picker never opens (the "first Ctrl+Shift+K does nothing"
 * failure mode).
 *
 * Call this directly inside the event handler, then await the returned
 * promise for validation / IndexedDB persistence.
 */
export function beginPairPenDrive(): Promise<void> {
  const w = window as unknown as ShowDirectoryPickerWindow;
  if (!w.showDirectoryPicker) {
    return Promise.reject(new Error("File System Access API not supported in this browser"));
  }
  // CRITICAL: invoke the picker before any await.
  const picker = w.showDirectoryPicker({ mode: "read" });
  return (async () => {
    const handle = await picker;
    // Sanity-check: superadmin.key must exist in the chosen dir right now.
    await handle.getFileHandle("superadmin.key");
    await idbPut(IDB_HANDLE_KEY, handle);
    cachedDirHandle = handle;
  })();
}

/**
 * Open the directory picker so the operator can pair their pen drive root.
 * Prefer {@link beginPairPenDrive} from click/keydown handlers so the picker
 * is not blocked by a prior await.
 */
export async function pairPenDrive(): Promise<void> {
  await beginPairPenDrive();
}

/** Forget the paired pen drive (e.g. operator wants to re-pair). */
export async function unpairPenDrive(): Promise<void> {
  try { await idbDelete(IDB_HANDLE_KEY); } catch { /* ignore */ }
  cachedDirHandle = null;
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
/**
 * Request read permission on the cached paired directory **from a user
 * gesture**, without an IndexedDB round-trip first. Returns a promise; the
 * permission prompt is started synchronously when a cached handle exists.
 */
export function beginEnsurePairedDirPermission(): Promise<boolean> {
  if (!isFsAccessSupported()) return Promise.resolve(false);
  const dir = cachedDirHandle;
  if (!dir) return Promise.resolve(false);
  try {
    if (typeof dir.requestPermission === "function") {
      return dir.requestPermission({ mode: "read" })
        .then((next) => next === "granted")
        .catch(() => false);
    }
    if (typeof dir.queryPermission === "function") {
      return dir.queryPermission({ mode: "read" })
        .then((cur) => cur === "granted")
        .catch(() => false);
    }
    return Promise.resolve(false);
  } catch {
    return Promise.resolve(false);
  }
}

export async function ensurePairedDirPermission(): Promise<boolean> {
  if (cachedDirHandle === undefined) {
    await preloadPairedDirHandle();
  }
  return beginEnsurePairedDirPermission();
}

/**
 * Older USB `superadmin-ui.js` locks the PIN field after failed auto-login and
 * never posts the typed PIN. Install once per tab so ERP-embedded portal login
 * still allows typing the DB PIN (no pen-drive rebuild required).
 */
export function installSaLoginPinFallbackShim(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { __saPinFallbackInstalled?: boolean };
  if (w.__saPinFallbackInstalled) return;
  w.__saPinFallbackInstalled = true;

  const autoLoginFailedVisible = (): boolean => {
    const nodes = document.querySelectorAll("div, p, span");
    for (const el of nodes) {
      const t = (el.textContent || "").trim();
      if (t.startsWith("Auto-login failed")) return true;
    }
    return false;
  };

  const unlockPinInputs = (): void => {
    if (!autoLoginFailedVisible()) return;
    const inputs = document.querySelectorAll<HTMLInputElement>(
      'input[type="password"], input[autocomplete="current-password"]',
    );
    for (const inp of inputs) {
      if (inp.disabled) inp.disabled = false;
      if (inp.readOnly) inp.readOnly = false;
      if ((inp.placeholder || "").toLowerCase().includes("auto-filled")) {
        inp.placeholder = "Enter Super Admin PIN";
      }
    }
  };

  window.setInterval(unlockPinInputs, 400);

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      if (url.includes("/super-admin/login") && init && typeof init.body === "string") {
        const body = JSON.parse(init.body) as Record<string, string>;
        const pinInput = document.querySelector<HTMLInputElement>(
          'input[type="password"], input[autocomplete="current-password"]',
        );
        const nameInput = document.querySelector<HTMLInputElement>(
          '#name, input[autocomplete="username"]',
        );
        const typed = pinInput?.value?.trim() || "";
        if (!body.name && nameInput?.value) body.name = nameInput.value.trim();
        // Old USB plugins require `pin`; host auth uses `usbPin` for pen-drive
        // auto-login (2321). Send both so either handler accepts the request.
        const secret = typed || body.usbPin || body.pin || "";
        if (secret) {
          body.pin = secret;
          body.usbPin = secret;
          init = { ...init, body: JSON.stringify(body) };
        }
      }
    } catch {
      /* never block login */
    }
    return origFetch(input, init);
  };
}

/**
 * Open the Zero-Trace Super Admin portal as a full document load.
 * MUST NOT use SPA navigate() into the ERP Layout — that hits PermissionGuard
 * (non–super_admin → "/") and can leave the operator on the left sidebar
 * instead of the SA login. Also MUST NOT inject superadmin-ui.js into the ERP
 * #root (USB UI createRoot hijacks the billing SPA).
 *
 * Matches Settings → "Open Super Admin Portal" (href="/super-admin-portal/").
 */
export function openSuperAdminPortal(hash: string = ""): void {
  const fragment = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
  const url = `/super-admin-portal/${fragment}`;
  // Prefer a new tab (commented UX on sidebar modules). Fall back to same-tab
  // full navigation if the popup is blocked.
  const win = typeof window !== "undefined" ? window.open(url, "_blank", "noopener,noreferrer") : null;
  if (!win && typeof window !== "undefined") {
    window.location.assign(url);
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

