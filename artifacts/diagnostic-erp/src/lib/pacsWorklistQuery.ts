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
 */
export function shouldIncludeOrthanc(opts: {
  enabled: boolean;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}): boolean {
  if (!opts.enabled) return false;
  if (opts.search?.trim()) return true;
  if (opts.dateFrom || opts.dateTo) return true;
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
