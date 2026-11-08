/**
 * Route guards for the Radiology Reporting Workspace (Layout.tsx,
 * GlobalCommandPalette.tsx).
 *
 * WHY THIS EXISTS (UX review U11/U14): app-level key triggers and the
 * workspace's own shortcut matrix claim overlapping combos —
 *
 *   - Ctrl+Shift+K: pen-drive pairing (Layout) vs "park study" (workspace).
 *     Layout's capture listener called preventDefault() without stopping
 *     propagation, so in the workspace one keypress parked the study AND
 *     opened the USB pairing dialog (on an unpaired machine: the OS folder
 *     picker).
 *   - Ctrl+K: the global navigation palette vs the workspace command
 *     palette. On mobile (and on desktop whenever the workspace never raised
 *     `care:workspace-focus`) both listeners are live and one keypress opens
 *     two stacked palettes.
 *
 * Inside the workspace routes the workspace's own shortcuts are the single
 * owner; the app-level triggers stand down.
 */

/**
 * The routes the Radiology Reporting Workspace (and its command palette /
 * shortcut matrix) is mounted on. `/radiology/report-builder` is deliberately
 * NOT here — it is a different page with no workspace palette, and suppressing
 * the global palette there would leave Ctrl+K dead.
 */
const WORKSPACE_ROUTE_PREFIXES = [
  "/radiology/report/",
  "/radiology/reporting-workspace",
  "/radiology/report-legacy/",
  "/radiology/report-generator",
];

/** True on any route the Reporting Workspace's own palette/shortcuts own. */
export function isRadiologyReportingWorkspaceRoute(pathname: string): boolean {
  const p = (pathname ?? "").replace(/\/+$/, "");
  if (p === "/radiology/report" || p === "/radiology/reporting-workspace") return true;
  return WORKSPACE_ROUTE_PREFIXES.some((r) => p.startsWith(r));
}

/**
 * True when the pen-drive pairing trigger must stand down (park-study owns
 * Ctrl+Shift+K here). Uses the wider `/radiology/report` prefix: the hidden
 * pairing dialog losing the deprecated aliases (report-legacy, report-generator,
 * report-builder) is harmless — it stays available on every other screen.
 */
export function shouldSuppressPenDrivePairing(pathname: string): boolean {
  return pathname.startsWith("/radiology/report");
}
