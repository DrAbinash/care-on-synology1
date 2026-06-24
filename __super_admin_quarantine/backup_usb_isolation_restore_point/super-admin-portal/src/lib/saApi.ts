/**
 * Thin wrapper that wires up the SA token AND the USB pen-drive key for the
 * generated api-client-react hooks. When the operator unlocks with their
 * pen drive (and later logs in with PIN) we register a custom-headers getter
 * so every generated hook automatically sends:
 *   - X-SA-USB-Key (the contents of `superadmin.key` from the pen drive)
 *   - X-SA-Token   (the PIN-login session token, once obtained)
 *
 * The saAuthHeaders() helper is kept for binary-download use-cases (CSV
 * export, etc.) that cannot use the generated client.
 */

import { setCustomHeadersGetter } from "@workspace/api-client-react";

let SA_TOKEN: string | null = null;
let SA_USB_KEY: string | null = null;

const USB_KEY_STORAGE_KEY = "sa_usb_key_v1";

function refreshHeadersGetter(): void {
  if (SA_USB_KEY === null && SA_TOKEN === null) {
    setCustomHeadersGetter(null);
    return;
  }
  setCustomHeadersGetter(() => {
    const h: Record<string, string> = {};
    if (SA_USB_KEY !== null) h["X-SA-USB-Key"] = SA_USB_KEY;
    if (SA_TOKEN !== null) h["X-SA-Token"] = SA_TOKEN;
    return h;
  });
}

export function setSaToken(token: string | null): void {
  SA_TOKEN = token;
  refreshHeadersGetter();
}

export function setSaUsbKey(key: string | null): void {
  SA_USB_KEY = key;
  try {
    if (key === null) sessionStorage.removeItem(USB_KEY_STORAGE_KEY);
    else sessionStorage.setItem(USB_KEY_STORAGE_KEY, key);
  } catch { /* ignore storage errors */ }
  refreshHeadersGetter();
}

export function loadSaUsbKeyFromSession(): string | null {
  try {
    const v = sessionStorage.getItem(USB_KEY_STORAGE_KEY);
    if (v && v.length > 0) {
      SA_USB_KEY = v;
      refreshHeadersGetter();
      return v;
    }
  } catch { /* ignore storage errors */ }
  return null;
}

/**
 * Returns headers needed for binary downloads (CSV / PDF) that must be
 * fetched with a plain fetch() call instead of the generated client.
 *
 * Also called by SA-protected useQuery hooks. Always attempts to restore the
 * USB key from sessionStorage when the in-memory variable is null — this
 * guards against Vite HMR reloading the module and resetting the variable
 * while the React component tree stays mounted.
 */
export function saAuthHeaders(): Record<string, string> {
  if (!SA_USB_KEY) loadSaUsbKeyFromSession();
  const h: Record<string, string> = {};
  if (SA_USB_KEY) h["X-SA-USB-Key"] = SA_USB_KEY;
  if (SA_TOKEN) h["X-SA-Token"] = SA_TOKEN;
  return h;
}

/**
 * Plain-fetch headers including USB key only — used during unlock/login.
 * Falls back to sessionStorage if the in-memory variable was cleared by HMR.
 */
export function saUsbHeader(): Record<string, string> {
  if (!SA_USB_KEY) loadSaUsbKeyFromSession();
  return SA_USB_KEY ? { "X-SA-USB-Key": SA_USB_KEY } : {};
}
