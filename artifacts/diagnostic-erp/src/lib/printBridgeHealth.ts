/**
 * printBridgeHealth.ts — pure mapping from GET /api/radiology/print-bridge/
 * health's response to the small status dot + tooltip PrintImagePicker shows
 * next to "Print images". Kept in its own alias-free module (rather than
 * inline in PrintImagePicker.tsx) so it can be unit-tested directly: the
 * repo's root vitest config runs component-adjacent .ts files in a plain
 * Node environment with no "@/" alias resolution, which a .tsx component's
 * usual import graph (react-query, UI components, etc.) depends on.
 */

export interface BridgeHealth {
  configured: boolean;
  reachable: boolean;
  printerStatus: string | null;
  printerInfo: string | null;
}

export function healthDotClass(health: BridgeHealth | undefined): string {
  if (!health || !health.configured) return "bg-muted-foreground/30";
  if (!health.reachable) return "bg-red-500";
  if (health.printerStatus === "NORMAL") return "bg-emerald-500";
  return "bg-amber-500"; // reachable, but the printer itself reports FAILURE/WARNING
}

export function healthTooltip(health: BridgeHealth | undefined): string {
  if (!health) return "Checking printer status…";
  if (!health.configured) return "Print bridge not configured (PRINT_BRIDGE_URL unset)";
  if (!health.reachable) return `Print bridge unreachable${health.printerInfo ? `: ${health.printerInfo}` : ""}`;
  return health.printerInfo || health.printerStatus || "Printer status unknown";
}
