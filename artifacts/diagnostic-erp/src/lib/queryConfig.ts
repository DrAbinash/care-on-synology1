/**
 * queryConfig.ts — Shared React Query refresh settings for "live number"
 * pages (billing, accounts, reconciliation, day close, dues).
 *
 * Background: the app's global default (App.tsx QueryClient) already
 * auto-refreshes every page every 60 seconds, and refetches immediately
 * whenever the browser tab regains focus (refetchOnWindowFocus) or the
 * network reconnects. That's a reasonable default for most screens.
 *
 * Financial pages are different — multiple staff can be creating bills,
 * recording payments, or closing the day at the same time, and stale
 * totals on a money screen are a real problem, not just a minor
 * inconvenience. FINANCIAL_REFRESH_MS gives those pages a faster,
 * CONSISTENT refresh rate instead of each page inventing its own number
 * (this codebase previously had 15s/30s/60s scattered ad-hoc across
 * different financial pages with no single standard).
 *
 * 15 seconds was chosen as the standard: fast enough that a second staff
 * member's bill/payment shows up well within one billing cycle, without
 * hammering the database with a query every few seconds. This matches
 * common practice for live financial/ops dashboards (most fall in the
 * 10-30s range) and was already in use on two of this app's own pages
 * before this change, which this file now makes consistent everywhere.
 *
 * Usage — spread directly into a useQuery call:
 *   useQuery({
 *     queryKey: [...],
 *     queryFn: ...,
 *     ...FINANCIAL_QUERY_OPTIONS,
 *   })
 */

/** Standard refresh interval (ms) for financial / "live numbers" pages. */
export const FINANCIAL_REFRESH_MS = 15_000;

/**
 * Spread into any useQuery on a billing/accounts/reconciliation page.
 * - refetchInterval: re-fetches automatically every 15s, even if the tab
 *   is just sitting open (so numbers update without any click).
 * - staleTime: 0 forces an immediate refetch the moment the page/tab is
 *   opened or focused too — no waiting to see today's real totals.
 * - refetchIntervalInBackground: false avoids polling tabs that are in
 *   the background (saves load); refetchOnWindowFocus (global default,
 *   already true) covers catching up the instant that tab is viewed again.
 */
export const FINANCIAL_QUERY_OPTIONS = {
  refetchInterval: FINANCIAL_REFRESH_MS,
  refetchIntervalInBackground: false,
  staleTime: 0,
} as const;
