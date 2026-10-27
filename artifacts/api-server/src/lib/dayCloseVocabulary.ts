/**
 * Server-side mirror of `artifacts/diagnostic-erp/src/lib/dayCloseVocabulary.ts`.
 *
 * The two live in different workspace packages with no shared lib between them,
 * so the strings are duplicated deliberately — and pinned by a test in each
 * package (`staffDayCloseEmail.test.ts` here, `dayCloseVocabulary.test.ts there)
 * that asserts the same wording, because this text is what a cashier signs and
 * what an admin reads in an email about the same drawer.
 */

export const DRAWER_STATUS_NOT_VERIFIED = "not_physically_verified";

const LABELS: Record<string, string> = {
  open: "Open",
  balanced: "Balanced",
  mismatch: "Mismatch",
  approved: "Approved",
  closed: "Closed",
  reopened: "Reopened",
  [DRAWER_STATUS_NOT_VERIFIED]: "Not Physically Verified",
};

export function drawerStatusLabel(status: string | null | undefined): string {
  if (!status) return "Open";
  const known = LABELS[status];
  if (known) return known;
  return status
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
