import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, MonitorPlay, Monitor, RefreshCw, ChevronDown, ChevronUp, Route } from "lucide-react";
import {
  launchRadiologyStudy,
  type StudyLaunchResult,
  type NetworkMode,
  type ConcreteMode,
  type ViewerType,
  CONCRETE_MODES,
  isConcreteMode,
} from "@/lib/studyLaunchService";
import { recordSuccessfulLaunch, recordFailedLaunch } from "@/lib/viewerService";

/**
 * Ticket M1.2 — the ONE study-launch control of the canonical Reporting
 * Workspace. Network selection (AUTO | LAN | TAILSCALE | CLOUDFLARE |
 * PUBLIC), viewer selection (OHIF | Weasis), visible route badge, actionable
 * failures with Retry / Retry-with-next-route, and a permission-gated
 * diagnostics drawer. All URL/selection logic lives in
 * lib/studyLaunchService — nothing here builds URLs.
 */

export interface OpenStudyIdentity {
  studyInstanceUID: string | null;
  accessionNumber: string | null;
  patientId: number | null;
  worklistId: number | null;
}

const MODE_OVERRIDE_KEY = "viewer_network_mode_override";

const MODE_BADGE: Record<ConcreteMode, string> = {
  LAN: "bg-green-100 text-green-800 border-green-300",
  TAILSCALE: "bg-sky-100 text-sky-800 border-sky-300",
  CLOUDFLARE: "bg-orange-100 text-orange-800 border-orange-300",
  PUBLIC: "bg-purple-100 text-purple-800 border-purple-300",
};

const MODE_LABEL: Record<ConcreteMode, string> = {
  LAN: "LAN",
  TAILSCALE: "Tailscale",
  CLOUDFLARE: "Cloudflare",
  PUBLIC: "Public",
};

function messageFor(result: StudyLaunchResult): string {
  if (result.success && result.selectedNetworkMode) {
    const via = `Connected through ${MODE_LABEL[result.selectedNetworkMode]}`;
    return result.identifierType === "ACCESSION_NUMBER"
      ? `${via} — StudyInstanceUID missing, using accession fallback`
      : via;
  }
  switch (result.errorCode) {
    case "MISSING_STUDY_IDENTIFIER":
      return "StudyInstanceUID missing — this study cannot be launched safely";
    case "VIEWER_NOT_CONFIGURED":
      return "Viewer not configured — check Radiology Settings";
    case "NETWORK_MODE_NOT_CONFIGURED":
      return "This network mode has no configured endpoint";
    case "NO_REACHABLE_NETWORK":
      return "No reachable network path — all configured routes failed";
    case "STUDY_NOT_FOUND":
      return "Study not found in PACS";
    case "VIEWER_UNAVAILABLE":
      return "Viewer unavailable — the launch could not be completed";
    case "POPUP_BLOCKED":
      return "Popup blocked — allow popups for this site and retry";
    case "MIXED_CONTENT_BLOCKED":
      return "Mixed-content blocked — this page is HTTPS but the viewer URL is HTTP";
    case "INVALID_BASE_URL":
      return "Configuration invalid — a viewer URL failed validation";
    case "PACS_LOOKUP_FAILED":
      return "PACS lookup failed";
    case "STALE_STUDY_CONTEXT":
      return "Study changed while connecting — launch cancelled for safety";
    default:
      return "Launch failed";
  }
}

interface LaunchDiagnosticsResponse {
  studyInstanceUID: string;
  pacsLookup: "FOUND" | "NOT_FOUND" | "UNAVAILABLE";
  pacsDetail?: string;
  configuredModes: string[];
  endpoints: Record<string, string>;
}

export default function OpenStudyPanel({ study, isAdmin, onLaunchStateChange }: {
  study: OpenStudyIdentity;
  isAdmin: boolean;
  /** M1.5 — lets the workspace's workflow controller know a launch is in
   *  flight (study switches are blocked while connecting) and what the last
   *  launch outcome was (the "Viewer" status chip). Read-only exposure. */
  onLaunchStateChange?: (state: { busy: boolean; lastResult: StudyLaunchResult | null }) => void;
}) {
  const { data: settings = {} as Record<string, string> } = useQuery<Record<string, string>>({
    queryKey: ["pacs-viewer-settings"],
    queryFn: async () => {
      const rows = await api.get<{ key: string; value: string }[]>("/api/radiology/pacs-settings");
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
    staleTime: 60_000,
  });

  const [mode, setMode] = useState<NetworkMode>(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(MODE_OVERRIDE_KEY) : null;
    return stored === "AUTO" || (stored && isConcreteMode(stored)) ? (stored as NetworkMode) : "AUTO";
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StudyLaunchResult | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [showNetwork, setShowNetwork] = useState(false);
  const [pacsCheck, setPacsCheck] = useState<LaunchDiagnosticsResponse | null>(null);
  const [pacsChecking, setPacsChecking] = useState(false);

  // Wrong-patient prevention: launches capture the UID at click time; if the
  // workspace switches studies while probes are in flight, the launch aborts.
  const currentUidRef = useRef(study.studyInstanceUID);
  useEffect(() => {
    currentUidRef.current = study.studyInstanceUID;
    setResult(null);
    setPacsCheck(null);
  }, [study.studyInstanceUID]);

  // M1.5 — mirror launch state up to the workflow controller.
  useEffect(() => {
    onLaunchStateChange?.({ busy, lastResult: result });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, result]);

  const defaultViewer: ViewerType = settings["default_viewer"] === "OHIF" ? "OHIF" : "WEASIS";

  function chooseMode(next: NetworkMode) {
    setMode(next);
    try {
      localStorage.setItem(MODE_OVERRIDE_KEY, next);
    } catch {
      /* private mode */
    }
  }

  async function launch(viewer: ViewerType, opts: { skipModes?: ConcreteMode[]; requestedMode?: NetworkMode } = {}) {
    if (busy) return;
    // Open the tab synchronously inside the click gesture — the number-one
    // reason the old flow hit popup blockers was window.open after awaits.
    const openTarget = window.open("", "_blank");
    const capturedUid = study.studyInstanceUID;
    setBusy(true);
    setResult(null);
    try {
      const res = await launchRadiologyStudy(
        {
          studyInstanceUID: study.studyInstanceUID,
          accessionNumber: study.accessionNumber,
          patientId: study.patientId,
          worklistId: study.worklistId,
          viewer,
          requestedMode: opts.requestedMode ?? mode,
        },
        settings,
        {
          openTarget,
          pageIsHttps: window.location.protocol === "https:",
          isStale: () => currentUidRef.current !== capturedUid,
          skipModes: opts.skipModes,
          recordSuccess: recordSuccessfulLaunch,
          recordFailure: recordFailedLaunch,
        },
      );
      setResult(res);
    } finally {
      setBusy(false);
    }
  }

  async function verifyInPacs() {
    if (!study.studyInstanceUID) return;
    setPacsChecking(true);
    try {
      const res = await api.get<LaunchDiagnosticsResponse>(
        `/api/radiology/studies/${encodeURIComponent(study.studyInstanceUID)}/launch-diagnostics`,
      );
      setPacsCheck(res);
    } catch (e) {
      setPacsCheck({
        studyInstanceUID: study.studyInstanceUID,
        pacsLookup: "UNAVAILABLE",
        pacsDetail: e instanceof Error ? e.message : String(e),
        configuredModes: [],
        endpoints: {},
      });
    } finally {
      setPacsChecking(false);
    }
  }

  const launchable = Boolean(study.studyInstanceUID?.trim() || study.accessionNumber?.trim());
  const failedMode = result && !result.success ? result.selectedNetworkMode : null;
  const probedModes = result?.probeResults.map((r) => r.mode) ?? [];

  return (
    <div className="rounded-md border bg-background p-2 space-y-2" data-testid="open-study-panel">
      {/* Row 1: primary action + viewer-specific launches */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button
          size="sm"
          className="h-7 text-xs gap-1"
          disabled={!launchable || busy}
          onClick={() => void launch(defaultViewer)}
          data-testid="btn-open-study"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <MonitorPlay size={12} />}
          {busy ? "Opening study…" : "Open Study"}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={!launchable || busy}
          onClick={() => void launch("OHIF")} data-testid="btn-open-ohif">
          <Monitor size={12} /> OHIF
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={!launchable || busy}
          onClick={() => void launch("WEASIS")} data-testid="btn-open-weasis">
          <MonitorPlay size={12} /> Weasis
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-1.5 text-[10px] gap-0.5 text-muted-foreground"
            onClick={() => setShowNetwork((v) => !v)}
            title="Network route (default AUTO — silent probe)"
            data-testid="btn-toggle-network"
          >
            <Route size={12} />
            {mode === "AUTO" ? "AUTO" : MODE_LABEL[mode as ConcreteMode] ?? mode}
          </Button>
          {showNetwork && (
            <Select value={mode} onValueChange={(v) => chooseMode(v as NetworkMode)}>
              <SelectTrigger className="h-7 w-[118px] text-xs" data-testid="network-mode-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AUTO">AUTO (silent)</SelectItem>
                {CONCRETE_MODES.map((m) => (
                  <SelectItem key={m} value={m}>{MODE_LABEL[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Row 2: status line + route badge */}
      {(busy || result) && (
        <div className="flex items-center gap-2 text-xs flex-wrap" data-testid="launch-status">
          {busy && (
            <span className="text-muted-foreground flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" /> Probing network routes…
            </span>
          )}
          {!busy && result && (
            <>
              <span className={result.success ? "text-emerald-700" : "text-red-600 font-medium"}>
                {messageFor(result)}
              </span>
              {result.selectedNetworkMode && (
                <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${MODE_BADGE[result.selectedNetworkMode]}`} data-testid="route-badge">
                  {MODE_LABEL[result.selectedNetworkMode]}
                </Badge>
              )}
              {!result.success && (
                <span className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-5 px-1.5 text-[10px] gap-0.5"
                    onClick={() => void launch(result.viewerType)} data-testid="btn-retry">
                    <RefreshCw size={9} /> Retry
                  </Button>
                  {(result.requestedMode !== "AUTO" || failedMode || probedModes.length > 0) && (
                    <Button size="sm" variant="outline" className="h-5 px-1.5 text-[10px]"
                      onClick={() =>
                        void launch(result.viewerType, {
                          requestedMode: "AUTO",
                          // Explicit user choice: fall back past everything
                          // that just failed (forced mode included).
                          skipModes: probedModes.filter((m) => !result.probeResults.find((r) => r.mode === m)?.reachable),
                        })
                      }
                      data-testid="btn-retry-fallback"
                    >
                      Retry with next route
                    </Button>
                  )}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Row 3: permission-gated diagnostics drawer */}
      {isAdmin && result && !busy && (
        <div className="border-t pt-1.5">
          <button
            className="text-[10px] text-muted-foreground flex items-center gap-0.5 hover:text-foreground"
            onClick={() => setShowDiag((s) => !s)}
            data-testid="btn-diagnostics"
          >
            {showDiag ? <ChevronUp size={10} /> : <ChevronDown size={10} />} Launch diagnostics
          </button>
          {showDiag && (
            <div className="mt-1 space-y-1 text-[10px] font-mono bg-muted/40 rounded p-1.5 max-h-48 overflow-y-auto" data-testid="diagnostics-drawer">
              <div>requested mode: {result.requestedMode ?? mode}</div>
              <div>selected mode: {result.selectedNetworkMode ?? "—"} ({result.selectedBaseUrl ?? "no route"})</div>
              <div>identifier: {result.identifierType ?? "—"} = {result.identifierUsed ?? "—"}</div>
              <div className="break-all">launch URL: {result.finalLaunchUrl ?? "—"}</div>
              {result.fallbackHistory.length > 0 && (
                <div>
                  probes:
                  {result.fallbackHistory.map((h, i) => (
                    <div key={i} className="pl-2">• {h}</div>
                  ))}
                </div>
              )}
              {result.diagnostics.map((d, i) => (
                <div key={i} className="text-muted-foreground">– {d}</div>
              ))}
              <div className="pt-1 flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-5 px-1.5 text-[10px]"
                  disabled={pacsChecking || !study.studyInstanceUID} onClick={() => void verifyInPacs()}>
                  {pacsChecking ? "Checking PACS…" : "Verify study in PACS"}
                </Button>
                {pacsCheck && (
                  <span className={pacsCheck.pacsLookup === "FOUND" ? "text-emerald-700" : "text-red-600"}>
                    {pacsCheck.pacsLookup === "FOUND"
                      ? "Study present in PACS"
                      : pacsCheck.pacsLookup === "NOT_FOUND"
                        ? "Study not found in PACS"
                        : `PACS lookup unavailable${pacsCheck.pacsDetail ? `: ${pacsCheck.pacsDetail}` : ""}`}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
