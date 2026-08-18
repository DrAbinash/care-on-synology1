/**
 * Official CARE Diagnostics letter-pad mark for server-rendered print/preview.
 * Inlined as a data URL so srcDoc iframes and print popups (about:blank) still
 * show the same header as the client jsPDF letter-pad export.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CANDIDATES = [
  join(dirname(fileURLToPath(import.meta.url)), "../../../diagnostic-erp/public/care-diagnostics-letterhead-logo.png"),
  join(process.cwd(), "artifacts/diagnostic-erp/public/care-diagnostics-letterhead-logo.png"),
  join(process.cwd(), "public/care-diagnostics-letterhead-logo.png"),
];

let cached: string | null = null;

export function careLetterheadLogoDataUrl(): string {
  if (cached) return cached;
  for (const p of CANDIDATES) {
    try {
      if (!existsSync(p)) continue;
      cached = `data:image/png;base64,${readFileSync(p).toString("base64")}`;
      return cached;
    } catch {
      /* try next path */
    }
  }
  return "/care-diagnostics-letterhead-logo.png";
}
