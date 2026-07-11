import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Network } from "lucide-react";
import {
  CONCRETE_MODES,
  browserProbe,
  joinUrl,
  validateBaseUrl,
  localStorageRouteCache,
  type ConcreteMode,
} from "@/lib/studyLaunchService";

/**
 * Ticket M1.2 — the ONE settings section owning viewer network routes:
 * per-mode base URLs (LAN | Tailscale | Cloudflare | Public), default
 * network mode, fallback order, probe path/timeout, route-cache TTL, and
 * per-mode test buttons. Lives inside RadiologySettingsCenter's Viewers tab
 * (no new settings page). LAN reuses the EXISTING ohif_base_url /
 * weasis_wado_url keys edited elsewhere in this tab; only the remote modes
 * get their own suffixed keys.
 */

const MODE_FIELDS: Array<{
  mode: ConcreteMode;
  label: string;
  viewerKey: string;
  wadoKey: string;
  placeholder: string;
  note: string;
}> = [
  {
    mode: "LAN",
    label: "LAN (clinic network)",
    viewerKey: "ohif_base_url",
    wadoKey: "weasis_wado_url",
    placeholder: "http://192.168.x.x:3010",
    note: "Reuses the OHIF/Weasis LAN fields above — shown here for testing.",
  },
  {
    mode: "TAILSCALE",
    label: "Tailscale (VPN)",
    viewerKey: "ohif_base_url_tailscale",
    wadoKey: "wado_base_url_tailscale",
    placeholder: "http://100.x.y.z:3010 or http://nas.tailnet-name.ts.net:3010",
    note: "Tailscale IP or MagicDNS hostname of the machine serving OHIF.",
  },
  {
    mode: "CLOUDFLARE",
    label: "Cloudflare Tunnel",
    viewerKey: "ohif_base_url_cloudflare",
    wadoKey: "wado_base_url_cloudflare",
    placeholder: "https://ohif.yourclinic.com or https://tunnel.yourclinic.com/ohif",
    note: "Tunnel hostname (Cloudflare Access stays in front if configured). Subpaths are preserved.",
  },
  {
    mode: "PUBLIC",
    label: "Public IP / domain",
    viewerKey: "ohif_base_url_public",
    wadoKey: "wado_base_url_public",
    placeholder: "https://pacs.yourclinic.com/erp/ohif",
    note: "Public domain with optional port/path — HTTPS strongly recommended.",
  },
];

export default function ViewerNetworkRoutesCard({
  getSetting,
  setSetting,
}: {
  getSetting: (key: string) => string;
  setSetting: (key: string, value: string) => void;
}) {
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const lastRoute = (() => {
    try {
      return localStorageRouteCache().get();
    } catch {
      return null;
    }
  })();

  async function testMode(mode: ConcreteMode, viewerKey: string) {
    const base = getSetting(viewerKey).trim();
    if (!base) {
      setTestResults((r) => ({ ...r, [mode]: "not configured" }));
      return;
    }
    const validation = validateBaseUrl(base);
    if (!validation.ok) {
      setTestResults((r) => ({ ...r, [mode]: `invalid URL (${validation.reason})` }));
      return;
    }
    if (window.location.protocol === "https:" && base.startsWith("http:")) {
      setTestResults((r) => ({ ...r, [mode]: "mixed content — https page cannot reach this http URL" }));
      return;
    }
    setTesting(mode);
    const timeout = Number(getSetting("viewer_probe_timeout_ms")) || 1500;
    const start = Date.now();
    const ok = await browserProbe(joinUrl(base, getSetting("viewer_probe_path")), timeout);
    setTesting(null);
    setTestResults((r) => ({ ...r, [mode]: ok ? `reachable (${Date.now() - start}ms)` : "unreachable" }));
  }

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4" data-testid="network-routes-card">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Network size={16} className="text-primary" />
          Network routes — reliable study launch (M1.2)
        </h3>
        {lastRoute && (
          <Badge variant="outline" className="text-[10px]">
            last successful route: {lastRoute.mode}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        The workspace probes these in order and opens the study through the first reachable route.
        Leave a row empty to disable that mode. AUTO order:{" "}
        <span className="font-mono">{getSetting("viewer_network_fallback_order") || "LAN, TAILSCALE, CLOUDFLARE, PUBLIC"}</span>
      </p>

      <div className="space-y-3">
        {MODE_FIELDS.map(({ mode, label, viewerKey, wadoKey, placeholder, note }) => (
          <div key={mode} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">{label}</span>
              <div className="flex items-center gap-2">
                {testResults[mode] && (
                  <span className={`text-[10px] ${testResults[mode].startsWith("reachable") ? "text-emerald-600" : "text-red-600"}`}>
                    {testResults[mode]}
                  </span>
                )}
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                  disabled={testing !== null}
                  onClick={() => void testMode(mode, viewerKey)}
                  data-testid={`btn-test-${mode.toLowerCase()}`}>
                  {testing === mode ? "Testing…" : "Test connection"}
                </Button>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Viewer (OHIF) base URL</Label>
                <Input className="h-8 text-xs font-mono" placeholder={placeholder}
                  value={getSetting(viewerKey)}
                  onChange={(e) => setSetting(viewerKey, e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">WADO URL for Weasis (optional)</Label>
                <Input className="h-8 text-xs font-mono" placeholder="…:8042/wado"
                  value={getSetting(wadoKey)}
                  onChange={(e) => setSetting(wadoKey, e.target.value)} />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">{note}</p>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t">
        <div className="space-y-1">
          <Label className="text-[10px]">Default network mode</Label>
          <select
            className="w-full h-8 text-xs border rounded-md px-2 bg-background"
            value={getSetting("viewer_network_mode") || "AUTO"}
            onChange={(e) => setSetting("viewer_network_mode", e.target.value)}
          >
            <option value="AUTO">AUTO (probe in order)</option>
            {CONCRETE_MODES.map((m) => (
              <option key={m} value={m}>Force {m}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px]">Fallback order (CSV)</Label>
          <Input className="h-8 text-xs font-mono" placeholder="LAN,TAILSCALE,CLOUDFLARE,PUBLIC"
            value={getSetting("viewer_network_fallback_order")}
            onChange={(e) => setSetting("viewer_network_fallback_order", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px]">Probe path</Label>
          <Input className="h-8 text-xs font-mono" placeholder="(base URL itself)"
            value={getSetting("viewer_probe_path")}
            onChange={(e) => setSetting("viewer_probe_path", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px]">Probe timeout (ms) / cache TTL (ms)</Label>
          <div className="flex gap-1">
            <Input className="h-8 text-xs font-mono" placeholder="1500"
              value={getSetting("viewer_probe_timeout_ms")}
              onChange={(e) => setSetting("viewer_probe_timeout_ms", e.target.value)} />
            <Input className="h-8 text-xs font-mono" placeholder="15000"
              value={getSetting("viewer_route_cache_ttl_ms")}
              onChange={(e) => setSetting("viewer_route_cache_ttl_ms", e.target.value)} />
          </div>
        </div>
      </div>
    </div>
  );
}
