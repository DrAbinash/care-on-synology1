/**
 * The single path into the authoritative reporting surface. A screen that
 * needs a report edited or signed navigates here; it does not implement its
 * own editor. `/radiology/report/:studyId` is `RadiologyReportingWorkspace`
 * (App.tsx), and the id is the worklist row id, as `RadiologyWorklist` and the
 * workspace's own `studyId` prop both use it.
 */
export function reportingWorkspacePath(
  studyId: number | string,
  opts: { focus?: boolean; ai?: boolean } = {},
): string {
  const params = new URLSearchParams();
  if (opts.focus) params.set("focus", "1");
  if (opts.ai) params.set("ai", "1");
  const qs = params.toString();
  const base = `/radiology/report/${studyId}`;
  return qs ? `${base}?${qs}` : base;
}
