/**
 * Redirect helpers for consolidating radiology settings into
 * /settings/radiology?tab=…
 */

import { useEffect } from "react";
import { useLocation } from "wouter";

/** Replace current route with Settings → Radiology (optional tab). */
export function RedirectToRadiologySettings({ tab }: { tab?: string }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    const qs = tab ? `?tab=${encodeURIComponent(tab)}` : "";
    navigate(`/settings/radiology${qs}`, { replace: true });
  }, [navigate, tab]);
  return (
    <div className="p-6 text-sm text-muted-foreground animate-pulse">
      Opening Radiology Settings…
    </div>
  );
}
