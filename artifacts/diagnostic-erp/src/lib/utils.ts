import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Generate a UUID (v4-style) safely in ANY context.
 *
 * `crypto.randomUUID()` only exists in "secure contexts" (HTTPS or
 * localhost). Care ERP is often accessed over plain HTTP on the LAN
 * (e.g. http://192.168.1.137:8888), which is NOT a secure context in
 * Chrome/Edge/Firefox — so `crypto.randomUUID` is `undefined` there and
 * calling it throws "crypto.randomUUID is not a function".
 *
 * This helper uses the native API when available and falls back to a
 * `crypto.getRandomValues`-based (or Math.random-based, as a last
 * resort) generator otherwise, so it always works — LAN HTTP included.
 */
export function genUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last-resort fallback (not cryptographically strong, but fine for a
  // client-generated idempotency key that only needs to be unique).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
