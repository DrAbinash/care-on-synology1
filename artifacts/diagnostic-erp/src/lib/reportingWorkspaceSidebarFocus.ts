/**
 * App-sidebar focus session for Radiology Reporting Workspace.
 *
 * The workspace collapses the Layout sidebar via `care:viewer-focus` and
 * `care:workspace-focus`. Both can fire on entry (default split layout). The
 * pre-collapse snapshot must be captured only once for the whole session —
 * otherwise the second event records "already collapsed" and leaving the
 * workspace restores that polluted value on Settings / other pages.
 */

/** Paths that mount RadiologyReportingWorkspace (or legacy) and emit focus events. */
export function isReportingWorkspaceLocation(location: string): boolean {
  const path = (location.split("?")[0] ?? location).replace(/\/+$/, "") || "/";
  return (
    /^\/radiology\/report\/[^/]+$/.test(path) ||
    /^\/radiology\/reporting-workspace(?:\/[^/]+)?$/.test(path) ||
    /^\/radiology\/unified-report\/[^/]+$/.test(path) ||
    /^\/radiology\/legacy-workspace(?:\/[^/]+)?$/.test(path)
  );
}

export type SidebarFocusFlags = {
  viewer: boolean;
  workspace: boolean;
};

/** Keep the first pre-collapse value for the focus session; ignore later ones. */
export function capturePreFocusCollapsed(
  existing: boolean | null,
  currentCollapsed: boolean,
  turningOn: boolean,
): boolean | null {
  if (!turningOn) return existing;
  if (existing !== null) return existing;
  return currentCollapsed;
}

/** Restore only when every focus source is off and a snapshot exists. */
export function shouldRestoreSidebarAfterFocus(
  flags: SidebarFocusFlags,
  preCollapsed: boolean | null,
): boolean {
  return !flags.viewer && !flags.workspace && preCollapsed !== null;
}
