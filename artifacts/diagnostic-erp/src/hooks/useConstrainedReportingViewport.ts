import * as React from "react";
import { CONSTRAINED_REPORTING_VIEWPORT_MAX_PX } from "@/lib/reportingPaneFocus";

/**
 * Viewport-width policy for reporting focus / exclusive accordion.
 * Uses matchMedia on actual CSS pixels — never user-agent sniffing.
 */
export function useConstrainedReportingViewport(
  maxPx: number = CONSTRAINED_REPORTING_VIEWPORT_MAX_PX,
): { widthPx: number; constrained: boolean } {
  const read = () =>
    typeof window !== "undefined" ? window.innerWidth : maxPx + 1;

  const [widthPx, setWidthPx] = React.useState<number>(read);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${maxPx}px)`);
    const sync = () => setWidthPx(window.innerWidth);
    sync();
    mql.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      mql.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, [maxPx]);

  return {
    widthPx,
    constrained: widthPx <= maxPx,
  };
}
