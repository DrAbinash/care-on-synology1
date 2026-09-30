import { useEffect, useState } from "react";
import {
  CARE_TIME_CHANGED,
  getClinicDateIst,
  msUntilBusinessDayRollover,
  refreshCareTime,
} from "@/lib/careTime";

/**
 * Stage 1A — hydrate the CARE business date once per app shell.
 *
 * Mounted from `components/Layout.tsx`, next to `useServerFeatureFlags()`,
 * which it deliberately mirrors: one background request per session rather than
 * one per form, fail-soft, and no error surface for what is only a form default.
 * It also schedules exactly one re-fetch at the rollover of the CARE business
 * day the *server* described, so the value cannot age into tomorrow — the ERP's
 * global React Query `staleTime` is 5 minutes and nothing here should depend on
 * a component happening to re-mount at midnight.
 *
 * The re-fetch is triggered by, and only by:
 *   - mount,
 *   - the browser coming back online,
 *   - the tab becoming visible again,
 *   - the server-reported business-day rollover.
 * It never listens to `careTimeChanged`, which is the loop that once turned
 * feature-flag hydration into thousands of polls per minute.
 */
export function useCareTime(): void {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRollover = () => {
      if (timer) clearTimeout(timer);
      const ms = msUntilBusinessDayRollover();
      if (ms === null || cancelled) return;
      timer = setTimeout(() => void hydrate(), ms);
    };

    async function hydrate() {
      await refreshCareTime();
      if (!cancelled) scheduleRollover();
    }

    const onOnline = () => void hydrate();
    const onVisible = () => {
      if (document.visibilityState === "visible") void hydrate();
    };

    void hydrate();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

/**
 * The CARE business date a *blank new form* should default to, or `null` when
 * the server has not answered. Re-renders the caller when the date rolls over
 * so a form left open across IST midnight is not quietly seeded from a stale
 * day.
 *
 * `null` is load-bearing: callers must render an empty date field, never a
 * browser-derived date. Offline behaviour is documented in Stage 1A §"server
 * authority unavailable" — the operator sees a required blank field instead of
 * a CARE business date nobody authorized.
 */
export function useClinicDateIst(): string | null {
  const [clinicDateIst, setClinicDateIst] = useState<string | null>(() => getClinicDateIst());

  useEffect(() => {
    const sync = () => setClinicDateIst(getClinicDateIst());
    sync();
    window.addEventListener(CARE_TIME_CHANGED, sync);
    return () => window.removeEventListener(CARE_TIME_CHANGED, sync);
  }, []);

  return clinicDateIst;
}
