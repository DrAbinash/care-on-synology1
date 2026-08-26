/**
 * Client API for server-backed whole-report formats.
 * Server is authoritative after migrate/hydrate; localStorage is cache only.
 */

import { api } from "@/lib/fetchApi";
import type { ReportFormat } from "./types";
import {
  DEFAULT_REPORT_FORMATS,
  cacheFormatsLocally,
  hydrateFormat,
  isServerFormatsAuthoritative,
  markServerFormatsAuthoritative,
  overlayLocalFormatFlags,
  payloadForApi,
  readLocalFormatsCache,
} from "./report-formats-library";
import { formatsMissingOnServer } from "./reportFormatSync";

type ListResponse = { items: ReportFormat[]; total: number };
type MigrateResponse = {
  imported: number;
  skipped: number;
  items: ReportFormat[];
  authoritative: boolean;
};

function asFormats(items: unknown): ReportFormat[] {
  if (!Array.isArray(items)) return [];
  return overlayLocalFormatFlags(
    items
      .filter((x): x is Partial<ReportFormat> & { name: string } => Boolean(x && typeof x === "object" && (x as ReportFormat).name))
      .map((x) => hydrateFormat(x)),
    readLocalFormatsCache(),
  );
}

/** Fetch server library; cache locally. Does not migrate. */
export async function fetchReportFormatsFromServer(): Promise<ReportFormat[]> {
  const res = await api.get<ListResponse>("/api/radiology/report-formats");
  const items = asFormats(res?.items);
  cacheFormatsLocally(items);
  if (items.length > 0) markServerFormatsAuthoritative();
  return items;
}

export async function createReportFormatOnServer(
  input: Omit<ReportFormat, "id" | "createdAt" | "updatedAt">,
): Promise<ReportFormat> {
  const row = await api.post<ReportFormat>("/api/radiology/report-formats", payloadForApi(input));
  const format = hydrateFormat(row);
  const next = [...readLocalFormatsCache().filter((f) => f.id !== format.id), format];
  cacheFormatsLocally(next);
  markServerFormatsAuthoritative();
  return format;
}

export async function deleteReportFormatOnServer(id: string): Promise<void> {
  await api.delete(`/api/radiology/report-formats/${id}`);
  cacheFormatsLocally(readLocalFormatsCache().filter((f) => f.id !== id));
}

export async function bumpReportFormatUsage(id: string): Promise<void> {
  try {
    await api.post(`/api/radiology/report-formats/${id}/use`, {});
  } catch {
    /* non-fatal ranking */
  }
}

/**
 * One-time import of browser library (and seed defaults if nothing local).
 * Preserves localStorage until server confirms; then marks server authoritative
 * and refreshes cache from server items (no divergent permanent dual-write).
 */
export async function migrateLocalReportFormatsToServer(): Promise<{
  formats: ReportFormat[];
  imported: number;
  skipped: number;
}> {
  const local = readLocalFormatsCache();
  const seedSource = local.length > 0 ? local : DEFAULT_REPORT_FORMATS;
  let serverItems: ReportFormat[] = [];
  try {
    serverItems = await fetchReportFormatsFromServer();
  } catch {
    // Offline — keep local/defaults; do not claim authoritative.
    return { formats: seedSource, imported: 0, skipped: 0 };
  }

  const missing = formatsMissingOnServer(seedSource, serverItems);
  if (missing.length === 0) {
    markServerFormatsAuthoritative();
    cacheFormatsLocally(serverItems.length > 0 ? serverItems : seedSource);
    return { formats: serverItems.length > 0 ? serverItems : seedSource, imported: 0, skipped: seedSource.length };
  }

  const res = await api.post<MigrateResponse>("/api/radiology/report-formats/migrate", {
    formats: missing.map(payloadForApi),
  });
  const items = asFormats(res?.items);
  markServerFormatsAuthoritative();
  cacheFormatsLocally(items);
  // Keep original browser key intact as historical backup (still readable).
  return { formats: items, imported: res?.imported ?? 0, skipped: res?.skipped ?? 0 };
}

/**
 * Bootstrap for workspace: migrate once if needed, else hydrate from server.
 * Offline → cached/local only (never invents a second permanent source).
 */
export async function hydrateReportFormatsLibrary(): Promise<ReportFormat[]> {
  if (isServerFormatsAuthoritative()) {
    try {
      return await fetchReportFormatsFromServer();
    } catch {
      const cached = readLocalFormatsCache();
      return cached.length > 0 ? cached : DEFAULT_REPORT_FORMATS;
    }
  }
  try {
    const { formats } = await migrateLocalReportFormatsToServer();
    return formats;
  } catch {
    return loadOfflineFormats();
  }
}

function loadOfflineFormats(): ReportFormat[] {
  const cached = readLocalFormatsCache();
  return cached.length > 0 ? cached : DEFAULT_REPORT_FORMATS;
}
