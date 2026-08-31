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

/** Orthanc archive search helps when filtering by back date or free-text search. */
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
