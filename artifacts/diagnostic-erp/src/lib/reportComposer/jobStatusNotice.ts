import type { ComposeJobView } from "./types";

/**
 * U15 — the poll loop's FAILED branch.
 *
 * `useReportComposer.refreshJob` stops polling on every terminal status, but
 * the toast + review-open block only existed inside the READY/STALE_READY
 * branch — so a FAILED compose job stopped the poll with zero notification,
 * and the failure text rendered only inside the AI tab (invisible with the
 * tools rail collapsed). A radiologist who clicked Generate and went back to
 * reading images waited indefinitely for a toast that never came. This is
 * also the radiologist-visible half of the B5 reaper: the reaper (PR #1304)
 * now converts a dead worker's job to FAILED server-side; without this notice
 * that resolution still never reaches the radiologist.
 */
export interface FailedComposeNotice {
  title: string;
  description: string;
  variant: "destructive";
}

export function failedComposeNotice(
  job: Pick<ComposeJobView, "status" | "safeError">,
): FailedComposeNotice | null {
  if (job.status !== "FAILED") return null;
  const reason = (job.safeError ?? "").trim();
  return {
    title: "AI composition failed",
    description: reason
      ? `${reason} — the report is unchanged. Open Reporting Tools → AI to retry.`
      : "The report is unchanged. Open Reporting Tools → AI to retry.",
    variant: "destructive",
  };
}
