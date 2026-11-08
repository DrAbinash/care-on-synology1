/**
 * penDrivePairingGuard — route guard for the hidden Ctrl+Shift+K pen-drive
 * pairing trigger (Layout.tsx).
 *
 * WHY THIS EXISTS (UX review U11): the pairing trigger and the reporting
 * workspace's "park study" shortcut claim the SAME combo — Ctrl+Shift+K.
 * Layout's capture-phase listener calls preventDefault() but never stops
 * propagation, so in the workspace one keypress parked the study AND opened
 * the USB pairing dialog (on an unpaired machine: the OS folder picker).
 *
 * The pairing trigger is a super-admin affordance; the park shortcut is a
 * daily radiologist action. Inside the radiology reporting surfaces the park
 * shortcut must be the single owner, so the pairing trigger stands down on
 * every canonical workspace route:
 *
 *   /radiology/report/:studyId             (primary)
 *   /radiology/reporting-workspace(/:id)   (named alias)
 *   /radiology/report-legacy/:studyId      (deprecated alias, redirects)
 *   /radiology/report-generator(/:id)      (deprecated page, redirects)
 *
 * The single `/radiology/report` prefix also covers the deprecated aliases —
 * suppressing the hidden pairing dialog there is harmless (it stays available
 * on every other screen).
 */

/** True when the pen-drive pairing trigger must stand down (park-study owns Ctrl+Shift+K here). */
export function shouldSuppressPenDrivePairing(pathname: string): boolean {
  return pathname.startsWith("/radiology/report");
}
