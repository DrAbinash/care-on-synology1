/** Build GET /api/radiology/pacs-worklist query string from UI filters. */
export type PacsWorklistQueryOpts = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Merge live Orthanc C-FIND hits (back-date / archive search). */
  orthanc?: boolean;
  modality?: string;
  status?: string;
  overnightDrafts?: boolean;
};

export function buildPacsWorklistUrl(opts: PacsWorklistQueryOpts = {}): string {
  const params = new URLSearchParams();
  const q = opts.search?.trim();
  if (q) params.set("search", q);
  if (opts.dateFrom) params.set("dateFrom", opts.dateFrom);
  if (opts.dateTo) params.set("dateTo", opts.dateTo);
  if (opts.orthanc) params.set("orthanc", "1");
  if (opts.modality && opts.modality !== "all") params.set("modality", opts.modality);
  if (opts.status && opts.status !== "all") params.set("status", opts.status);
  if (opts.overnightDrafts) params.set("overnightDrafts", "1");
  const qs = params.toString();
  return `/api/radiology/pacs-worklist${qs ? `?${qs}` : ""}`;
}

/**
 * Orthanc archive merge is expensive. When the master toggle is on, only
 * attach Orthanc for free-text search or an explicit date window (hub
 * back-date browse). Unfiltered "toggle on" alone does not hit Orthanc.
 *
 * `windowExplicit` (default true) — a date window counts as a back-date
 * browse only when the user actually chose it. The PACS worklist's few-clicks
 * default is the last two IST days; that window is the session's implicit
 * state, not an act of browsing back dates, and attaching the C-FIND to it
 * put a PACS round-trip on every default load and every 30 s poll. Same
 * doctrine as readingQueueShouldSearchOrthanc: Today / Yesterday /
 * Today+Yesterday browse Postgres only.
 */
export function shouldIncludeOrthanc(opts: {
  enabled: boolean;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  windowExplicit?: boolean;
}): boolean {
  if (!opts.enabled) return false;
  if (opts.search?.trim()) return true;
  if (opts.dateFrom || opts.dateTo) return opts.windowExplicit !== false;
  return false;
}

/**
 * Reading Queue policy: Orthanc only when the radiologist searches a
 * patient/accession (archive lookup). Today / Yesterday / Today&Yesterday /
 * All dates browse Postgres only — avoids C-FIND on every 30s poll.
 */
export function readingQueueShouldSearchOrthanc(opts: {
  datePreset: "today" | "yesterday" | "today-yesterday" | "all";
  search?: string;
}): boolean {
  void opts.datePreset;
  return Boolean(opts.search?.trim());
}
