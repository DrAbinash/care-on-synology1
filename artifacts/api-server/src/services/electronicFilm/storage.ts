// ============================================================================
// Persist electronic film PDFs from DicomToWindows into CARE uploads tree.
// ============================================================================
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const UPLOAD_BASE_DIR = join(process.cwd(), "data", "uploads");
const MODULE = "electronic_film";

export function electronicFilmUploadDir(): string {
  const dir = join(UPLOAD_BASE_DIR, MODULE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function storeElectronicFilmBytes(
  bytes: Buffer,
  opts: { jobKey: string; mimeType: string; version: number },
): { filePath: string; fileName: string; artifactHash: string } {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const ext = opts.mimeType.includes("png") ? "png" : "pdf";
  const safeKey = opts.jobKey.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 80);
  const fileName = `film_${safeKey}_v${opts.version}.${ext}`;
  const relPath = `${MODULE}/${fileName}`;
  const fullPath = join(UPLOAD_BASE_DIR, relPath);
  const dir = join(UPLOAD_BASE_DIR, MODULE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, bytes);
  return { filePath: relPath, fileName, artifactHash: hash };
}

export function resolveElectronicFilmFile(filePath: string): string | null {
  const resolvedBase = join(UPLOAD_BASE_DIR);
  const resolved = join(resolvedBase, filePath);
  if (!resolved.startsWith(resolvedBase + join("", "")) && !resolved.startsWith(resolvedBase + "/")) {
    return null;
  }
  if (!existsSync(resolved)) return null;
  return resolved;
}

export function mintFilmAccessToken(): string {
  return randomUUID().replace(/-/g, "");
}

export function carePublicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || process.env.SITE_URL || "")
    .replace(/\/+$/, "");
}

export function buildFilmPublicUrl(accessToken: string): string | null {
  const base = carePublicBaseUrl();
  if (!base || !accessToken) return null;
  return `${base}/api/electronic-film/public/${encodeURIComponent(accessToken)}`;
}
