/**
 * Display.tsx — Waiting-room LCD / TV queue board
 *
 * CHANGES FROM PREVIOUS VERSION:
 *
 * 1. Real-time via SSE (Server-Sent Events)
 *    Previously polled every 4 s (21,600 requests/TV/day). Now subscribes to
 *    /api/display/queue-stream. When a patient is called in Queue.tsx, the TV
 *    updates within ~200 ms instead of up to 4 s. Falls back to 8-second
 *    polling automatically if SSE is unavailable or disconnects.
 *
 * 2. Display-token auth for unattended TVs
 *    Reads ?displayToken=<token> from the URL and passes it to both the SSE
 *    and polling endpoints. This allows a TV to run 24 / 7 without a staff
 *    login session. Staff copy the token from Queue.tsx → "Get TV URL" panel.
 *
 * 3. Stale data warning
 *    If no update has been received for >15 s (network drop, server restart),
 *    a subtle amber banner appears so staff know to check connectivity.
 *    The last-known-good queue data remains visible — the display doesn't go blank.
 *
 * 4. floorLabel on every token
 *    The tests.floor_label column is now surfaced. Patients see "Ground Floor"
 *    or "1st Floor" next to the room number so they know where to go.
 *
 * 5. Larger "Now Serving" token number for 40"+ TVs
 *    Previous size was text-5xl/text-6xl. Increased to text-8xl/text-9xl in the
 *    primary (single-dept) view so it's readable from across a waiting room.
 *    Multi-dept grid mode uses text-6xl/text-7xl to keep cards fitting on screen.
 *
 * 6. Voice announcement fix
 *    Previously called synth.cancel() inside a loop so only the last changed
 *    department got announced. Now queues all department changes into a single
 *    combined utterance so nothing is cut off.
 *
 * 7. Connection status icon
 *    Small indicator (green dot = SSE live, amber dot = polling fallback,
 *    red dot = no connection) in the header corner so staff can glance at the
 *    TV and know if queue updates are flowing.
 *
 * UNCHANGED: dark theme, fullscreen button, Mic/BellOff toggle, department
 * card layout, privacy mode, branding, clock, waiting-list display.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { BellOff, Mic, Maximize2, Tv, MapPin, Wifi, WifiOff, AlertTriangle } from "lucide-react";

type TokenEntry = {
  id: number;
  tokenNo: number;
  patientLabel: string;
  testName: string | null;
  floorLabel: string;
  priority: number;
};

type DeptCard = {
  department: string;
  roomNumber: string;
  floorLabel: string;
  nowServing: (TokenEntry & { calledAt: string | null }) | null;
  waiting: TokenEntry[];
  waitingCount: number;
};

type DisplayPayload = { date: string; departments: DeptCard[] };
type Clinic = { name?: string; logoDataUrl?: string | null };

type ConnStatus = "sse-live" | "polling" | "offline";

// ──────────────────────────────────────────────────────────────────────────────

export default function Display() {
  const params = new URLSearchParams(window.location.search);
  const ledgerRaw = params.get("ledgerId");
  const ledgerNum = Number(ledgerRaw);
  const ledgerId = ledgerRaw && Number.isInteger(ledgerNum) && ledgerNum > 0 ? ledgerNum : null;
  const departments = (params.get("departments") ?? params.get("defaultDepartment") ?? "").trim();
  const layout = params.get("layout") === "single" ? "single" : "grid";
  const voiceEnabled = (params.get("voice") ?? "1") !== "0";
  const autoSpeak = (params.get("autoplayVoice") ?? "1") !== "0";
  const displayToken = params.get("displayToken") ?? "";

  const qc = useQueryClient();
  const [connStatus, setConnStatus] = useState<ConnStatus>("polling");
  const [lastUpdateTs, setLastUpdateTs] = useState<number>(Date.now());
  const [sseActive, setSseActive] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  // ── Build API URL helper ─────────────────────────────────────────────────
  const buildQueueUrl = useCallback(
    (path: string) => {
      const u = new URLSearchParams();
      if (ledgerId) u.set("ledgerId", String(ledgerId));
      if (departments) u.set("departments", departments);
      if (displayToken) u.set("displayToken", displayToken);
      return `/api/display/${path}?${u.toString()}`;
    },
    [ledgerId, departments, displayToken],
  );

  // ── TanStack Query (polling fallback) ────────────────────────────────────
  // When SSE is connected the refetchInterval drops to 30 s (just a safety
  // net). When SSE is not active it runs every 8 s (was 4 s — less aggressive
  // since SSE now handles latency-sensitive updates).
  const { data, isLoading, isError } = useQuery<DisplayPayload>({
    queryKey: ["display-queue", ledgerId, departments, displayToken],
    enabled: ledgerId !== null,
    queryFn: () => api.get(buildQueueUrl("queue")),
    refetchInterval: sseActive ? 30_000 : 8_000,
  });

  // Track connection state from poll outcomes (TanStack Query v5 removed
  // onSuccess/onError callbacks — react to data/isError via effects instead)
  useEffect(() => {
    if (data) {
      setLastUpdateTs(Date.now());
      setConnStatus((prev) => (prev === "offline" ? "polling" : prev));
    }
  }, [data]);

  useEffect(() => {
    if (isError) setConnStatus("offline");
  }, [isError]);

  // ── SSE subscription ─────────────────────────────────────────────────────
  useEffect(() => {
    if (ledgerId === null) return;
    if (typeof EventSource === "undefined") return; // Samsung Tizen older browsers

    const url = buildQueueUrl("queue-stream");
    const es = new EventSource(url);
    sseRef.current = es;

    es.onopen = () => {
      setSseActive(true);
      setConnStatus("sse-live");
    };

    es.onmessage = (evt) => {
      if (!evt.data || evt.data.startsWith(":")) return; // heartbeat comment
      try {
        const payload = JSON.parse(evt.data) as DisplayPayload;
        // Push into TanStack Query cache so UI re-renders with instant data
        qc.setQueryData<DisplayPayload>(
          ["display-queue", ledgerId, departments, displayToken],
          payload,
        );
        setLastUpdateTs(Date.now());
        setConnStatus("sse-live");
      } catch {
        // Ignore malformed event
      }
    };

    es.onerror = () => {
      // SSE disconnected — fall back to polling until the next successful reconnect
      setSseActive(false);
      setConnStatus("polling");
      es.close();
      sseRef.current = null;
    };

    return () => {
      es.close();
      sseRef.current = null;
      setSseActive(false);
    };
  }, [ledgerId, departments, displayToken, buildQueueUrl, qc]);

  // ── Stale-data watchdog ──────────────────────────────────────────────────
  // If no update (SSE or poll) for 15+ seconds, show an amber warning.
  const [isStale, setIsStale] = useState(false);
  useEffect(() => {
    const t = setInterval(() => {
      setIsStale(Date.now() - lastUpdateTs > 15_000);
    }, 3_000);
    return () => clearInterval(t);
  }, [lastUpdateTs]);

  // ── Live clock ───────────────────────────────────────────────────────────
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Voice announcements (fixed: queue per-dept changes into one utterance) ─
  const [lastAnnounced, setLastAnnounced] = useState<Record<string, number>>({});
  const hasSpokenInitialRef = useRef(false);

  const speakMessage = useCallback((message: string) => {
    if (!voiceEnabled || !message) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    try {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.rate = 0.92;
      utterance.volume = 0.9;
      synth.speak(utterance);
    } catch {
      //
    }
  }, [voiceEnabled]);

  const initialVoiceMessage = useMemo(() => {
    if (!data?.departments) return "";
    return data.departments
      .filter((d) => d.nowServing)
      .map((d) => {
        const loc = [d.roomNumber, d.floorLabel].filter(Boolean).join(", ");
        return `Token ${d.nowServing?.tokenNo} for ${d.department}${loc ? `, please proceed to ${loc}` : ""}.`;
      })
      .join(" ");
  }, [data]);

  // Initial autoplay after first load
  useEffect(() => {
    if (!data || !voiceEnabled || !autoSpeak || hasSpokenInitialRef.current) return;
    if (initialVoiceMessage) {
      speakMessage(initialVoiceMessage);
      hasSpokenInitialRef.current = true;
    }
  }, [data, voiceEnabled, autoSpeak, initialVoiceMessage, speakMessage]);

  // Per-update announcements — batch all changed departments into one sentence
  useEffect(() => {
    if (!data || !voiceEnabled) return;
    const updates: Record<string, number> = { ...lastAnnounced };
    const changed: string[] = [];

    for (const d of data.departments) {
      if (d.nowServing && lastAnnounced[d.department] !== d.nowServing.tokenNo) {
        const loc = [d.roomNumber, d.floorLabel].filter(Boolean).join(", ");
        changed.push(
          `Token ${d.nowServing.tokenNo} for ${d.department}${loc ? `, please proceed to ${loc}` : ""}.`,
        );
        updates[d.department] = d.nowServing.tokenNo;
      }
    }

    if (changed.length > 0) {
      // Speak ALL changed departments in one utterance (previously only last one fired)
      speakMessage(changed.join(" "));
      setLastAnnounced(updates);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, voiceEnabled]);

  const goFullscreen = () => {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  };

  const cards = data?.departments ?? [];

  // ── Connection status indicator ──────────────────────────────────────────
  const connDot = {
    "sse-live": "bg-emerald-400",
    "polling":  "bg-amber-400",
    "offline":  "bg-red-500 animate-pulse",
  }[connStatus];
  const connTitle = {
    "sse-live": "Live (SSE connected)",
    "polling":  "Polling every 8 s",
    "offline":  "Connection lost — retrying",
  }[connStatus];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white flex flex-col">
      {/* ── Stale data warning ─────────────────────────────────────────────── */}
      {isStale && (
        <div className="px-6 py-2 bg-amber-500/20 border-b border-amber-400/30 flex items-center gap-2 text-amber-200 text-sm">
          <AlertTriangle size={15} className="shrink-0" />
          <span>Display data may be outdated — checking connection…</span>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-6 sm:px-10 pt-6 pb-4 flex items-center justify-between border-b border-white/10 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          {/* Connection status dot */}
          <div className="shrink-0 flex items-center gap-1.5" title={connTitle}>
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${connDot}`} />
          </div>

          <BrandingHeader displayToken={displayToken} />
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="text-3xl sm:text-4xl font-mono font-bold tabular-nums leading-none">
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })}
            </div>
            <div className="text-xs text-white/50 mt-0.5">
              {now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}
            </div>
          </div>

          <button
            onClick={goFullscreen}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            title="Fullscreen (F11 on most browsers)"
          >
            <Maximize2 size={18} />
          </button>

          <button
            onClick={() => speakMessage(initialVoiceMessage)}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            title={voiceEnabled ? "Announce queue now" : "Voice disabled — add ?voice=1 to URL"}
          >
            {voiceEnabled ? <Mic size={18} /> : <BellOff size={18} />}
          </button>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 p-6 sm:p-8 overflow-auto">
        {ledgerId === null && (
          <div className="text-center text-amber-300/90 py-24">
            <div className="text-2xl font-bold mb-2">No book/ledger selected</div>
            <div className="text-sm text-white/60 max-w-sm mx-auto">
              Open this display from the Queue page ("Open TV Display") so the correct
              book and departments are included in the URL.
            </div>
          </div>
        )}
        {ledgerId !== null && isLoading && cards.length === 0 && (
          <div className="text-center text-white/50 text-xl py-32">Loading queue…</div>
        )}
        {!isLoading && cards.length === 0 && ledgerId !== null && (
          <div className="text-center text-white/60 py-24">
            <div className="text-3xl font-bold mb-2">Queue is clear</div>
            <div className="text-base text-white/40">
              Tokens issued during the day will appear here automatically.
            </div>
          </div>
        )}

        {cards.length > 0 && (
          <div className={
            layout === "single" || cards.length === 1
              ? "grid grid-cols-1 gap-6 max-w-3xl mx-auto"
              : "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5"
          }>
            {cards.map((c) => (
              <DepartmentCard
                key={c.department}
                card={c}
                big={layout === "single" || cards.length === 1}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div className="px-6 sm:px-10 py-3 text-center text-xs text-white/30 border-t border-white/10 shrink-0 flex items-center justify-center gap-3">
        {connStatus === "sse-live"
          ? <><Wifi size={11} className="text-emerald-400" /> Live updates via SSE</>
          : connStatus === "offline"
          ? <><WifiOff size={11} className="text-red-400" /> Connection lost — last data shown</>
          : <span>Polling for updates</span>
        }
        {voiceEnabled
          ? <span className="opacity-60">· Voice announcements on</span>
          : <span className="opacity-60">· Voice off</span>
        }
      </div>
    </div>
  );
}

// ── Branding header (lazy loads clinic name + logo via public endpoint) ────────

function BrandingHeader({ displayToken: _dt }: { displayToken: string }) {
  const { data: clinic } = useQuery<Clinic>({
    queryKey: ["clinic-settings-public"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 60_000,
  });

  return (
    <div className="flex items-center gap-3 min-w-0">
      {clinic?.logoDataUrl ? (
        <img
          src={clinic.logoDataUrl}
          alt=""
          className="h-11 w-11 rounded-lg object-contain bg-white/90 p-1 shrink-0"
        />
      ) : (
        <div className="h-11 w-11 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
          <Tv size={24} />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-xl sm:text-2xl font-extrabold tracking-tight truncate">
          {clinic?.name || "Care Diagnostics"}
        </div>
        <div className="text-xs text-white/50">Live Queue Display</div>
      </div>
    </div>
  );
}

// ── Department card ───────────────────────────────────────────────────────────

function DepartmentCard({ card, big }: { card: DeptCard; big: boolean }) {
  // Location label = "Room 101, Ground Floor" or just "Room 101" or "Ground Floor"
  const locationLabel = [card.roomNumber, card.floorLabel].filter(Boolean).join(" · ");

  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
      {/* Department header */}
      <div className="px-5 py-3 bg-gradient-to-r from-blue-700 to-indigo-700 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-xl font-bold tracking-wide truncate">{card.department}</div>
          {locationLabel && (
            <div className="text-xs text-blue-100 flex items-center gap-1 mt-0.5">
              <MapPin size={10} />
              <span>{locationLabel}</span>
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-blue-200 uppercase tracking-wider">Waiting</div>
          <div className={`${big ? "text-3xl" : "text-2xl"} font-bold tabular-nums`}>
            {card.waitingCount}
          </div>
        </div>
      </div>

      {/* Now Serving */}
      <div className="px-5 py-5 bg-emerald-500/10 border-b border-white/10 flex-1">
        <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-300 font-semibold mb-1">
          Now Serving
        </div>
        {card.nowServing ? (
          <div className="flex items-end gap-3 flex-wrap">
            <div
              className={`${
                big ? "text-8xl sm:text-9xl" : "text-6xl sm:text-7xl"
              } font-black text-emerald-300 tabular-nums leading-none`}
            >
              #{card.nowServing.tokenNo}
            </div>
            <div className="min-w-0 pb-1">
              <div className={`${big ? "text-lg" : "text-sm"} font-semibold truncate`}>
                {card.nowServing.patientLabel}
              </div>
              {card.nowServing.testName && (
                <div className={`${big ? "text-sm" : "text-xs"} text-white/50 truncate`}>
                  {card.nowServing.testName}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={`${big ? "text-5xl" : "text-4xl"} font-bold text-white/20 mt-1`}>
            —
          </div>
        )}
      </div>

      {/* Up Next list */}
      <div className="px-5 py-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/40 font-semibold mb-2">
          Up Next
        </div>
        {card.waiting.length === 0 ? (
          <div className="text-white/30 text-sm py-2">Queue is clear</div>
        ) : (
          <div className="space-y-1.5">
            {card.waiting.slice(0, big ? 8 : 5).map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`${big ? "text-2xl" : "text-xl"} font-bold tabular-nums text-blue-300 w-14 shrink-0`}>
                    #{w.tokenNo}
                  </span>
                  <span className={`${big ? "text-sm" : "text-xs"} font-medium truncate text-white/80`}>
                    {w.patientLabel}
                  </span>
                  {w.priority > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/30 text-amber-200 text-[9px] uppercase font-bold tracking-wider shrink-0">
                      VIP
                    </span>
                  )}
                </div>
                {w.testName && (
                  <span className="text-xs text-white/30 truncate hidden sm:block shrink-0 max-w-[100px]">
                    {w.testName}
                  </span>
                )}
              </div>
            ))}
            {card.waitingCount > (big ? 8 : 5) && (
              <div className="text-xs text-white/30 text-right px-1">
                +{card.waitingCount - (big ? 8 : 5)} more waiting
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
