import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { BellOff, Mic, Maximize2, Tv } from "lucide-react";

type DeptCard = {
  department: string;
  roomNumber: string;
  nowServing: { tokenNo: number; patientLabel: string; testName: string | null } | null;
  waiting: { id: number; tokenNo: number; patientLabel: string; testName: string | null; priority: number }[];
  waitingCount: number;
};

type DisplayPayload = { date: string; departments: DeptCard[] };
type Clinic = { name?: string; logoDataUrl?: string | null };

// Waiting-room display for staff-authenticated sessions. Designed for an
// LCD/LED TV in portrait or landscape orientation. Auto-refreshes every 4s.
export default function Display() {
  const params = new URLSearchParams(window.location.search);
  const ledgerRaw = params.get("ledgerId");
  const ledgerNum = Number(ledgerRaw);
  const ledgerId = ledgerRaw && Number.isInteger(ledgerNum) && ledgerNum > 0 ? ledgerNum : null;
  const departments = (params.get("departments") ?? params.get("defaultDepartment") ?? "").trim();
  const layout = (params.get("layout") ?? "").trim() === "single" ? "single" : "grid";
  const voiceEnabled = (params.get("voice") ?? "1") !== "0";
  const autoSpeak = (params.get("autoplayVoice") ?? "1") !== "0";

  const { data, isLoading } = useQuery<DisplayPayload>({
    queryKey: ["display-queue", ledgerId, departments],
    enabled: ledgerId !== null,
    queryFn: () => api.get(`/api/display/queue?ledgerId=${ledgerId}${departments ? `&departments=${encodeURIComponent(departments)}` : ""}`),
    refetchInterval: 4_000,
  });

  const { data: clinic } = useQuery<Clinic>({
    queryKey: ["clinic-settings-public"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 60_000,
  });

  // Live clock
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Speech announcement when "now serving" changes per dept.
  const [lastAnnounced, setLastAnnounced] = useState<Record<string, number>>({});
  const hasSpokenRef = useRef(false);
  const voiceMessage = useMemo(() => {
    if (!data) return "";
    return data.departments
      .filter((d) => d.nowServing)
      .map((d) => `Token ${d.nowServing?.tokenNo} for ${d.department}, please proceed to ${d.roomNumber || "the assigned room"}.`)
      .join(" ");
  }, [data]);
  const speakMessage = (message: string) => {
    if (!voiceEnabled || !message) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    try {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.rate = 0.95;
      utterance.volume = 0.9;
      synth.speak(utterance);
      hasSpokenRef.current = true;
    } catch {
      //
    }
  };
  useEffect(() => {
    if (!data || !voiceEnabled) return;
    const updates: Record<string, number> = { ...lastAnnounced };
    let changed = false;
    for (const d of data.departments) {
      if (d.nowServing && lastAnnounced[d.department] !== d.nowServing.tokenNo) {
        speakMessage(`Token ${d.nowServing.tokenNo} for ${d.department}, please proceed to ${d.roomNumber || "the assigned room"}.`);
        updates[d.department] = d.nowServing.tokenNo;
        changed = true;
      }
    }
    if (changed) setLastAnnounced(updates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, voiceEnabled]);

  useEffect(() => {
    if (!voiceEnabled || !autoSpeak || !voiceMessage || hasSpokenRef.current) return;
    speakMessage(voiceMessage);
  }, [autoSpeak, voiceEnabled, voiceMessage]);

  const goFullscreen = () => {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen();
  };

  const cards = data?.departments ?? [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
      {/* Header */}
      <div className="px-6 sm:px-10 pt-6 pb-4 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-4">
          {clinic?.logoDataUrl ? (
            <img src={clinic.logoDataUrl} alt="" className="h-12 w-12 rounded-lg object-contain bg-white/90 p-1" />
          ) : (
            <div className="h-12 w-12 rounded-lg bg-white/10 flex items-center justify-center"><Tv size={28} /></div>
          )}
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold tracking-tight">{clinic?.name || "Care Diagnostics"}</div>
            <div className="text-sm text-white/60">Live Queue Display · {data?.date ?? ""}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-3xl sm:text-4xl font-mono font-bold tabular-nums">
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })}
            </div>
            <div className="text-xs text-white/60">{now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}</div>
          </div>
          <button onClick={goFullscreen} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors" title="Fullscreen">
            <Maximize2 size={18} />
          </button>
          <button
            onClick={() => {
              speakMessage(voiceMessage);
            }}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            title={voiceEnabled ? "Speak queue now" : "Voice disabled"}
          >
            {voiceEnabled ? <Mic size={18} /> : <BellOff size={18} />}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 sm:p-10">
        {ledgerId === null && (
          <div className="text-center text-amber-300/90 py-24">
            <div className="text-2xl font-bold mb-2">Missing book selection</div>
            <div className="text-sm text-white/70">Open this display from the Queue page so a book/ledger is selected.</div>
          </div>
        )}
        {ledgerId !== null && isLoading && (
          <div className="text-center text-white/50 text-xl py-32">Loading queue…</div>
        )}
        {!isLoading && cards.length === 0 && (
          <div className="text-center text-white/60 py-24">
            <div className="text-3xl font-bold mb-2">No active queues</div>
            <div className="text-base">Tokens issued during the day will appear here automatically.</div>
          </div>
        )}

        <div className={layout === "single"
          ? "grid grid-cols-1 gap-6"
          : "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5"}>
          {cards.map((c) => <DepartmentCard key={c.department} card={c} big={layout === "single"} />)}
        </div>
      </div>

      {/* Footer / branding */}
      <div className="px-6 sm:px-10 py-3 text-center text-xs text-white/40 border-t border-white/10">
        {voiceEnabled ? "Voice announcements enabled." : "Voice announcements disabled."} Updates every 4 seconds.
      </div>
    </div>
  );
}

function DepartmentCard({ card, big }: { card: DeptCard; big: boolean }) {
  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
      <div className="px-5 py-3 bg-gradient-to-r from-blue-700 to-indigo-700 flex items-center justify-between">
        <div>
          <div className="text-xl font-bold tracking-wide">{card.department}</div>
          {card.roomNumber && <div className="text-xs text-blue-100">{card.roomNumber}</div>}
        </div>
        <div className="text-right">
          <div className="text-xs text-blue-100 uppercase tracking-wider">Waiting</div>
          <div className="text-2xl font-bold tabular-nums">{card.waitingCount}</div>
        </div>
      </div>

      {/* Now serving */}
      <div className="px-5 py-6 bg-emerald-500/10 border-b border-white/10">
        <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-300 font-semibold">Now Serving</div>
        {card.nowServing ? (
          <div className="mt-1 flex items-baseline gap-3">
            <div className={`${big ? "text-7xl sm:text-8xl" : "text-5xl sm:text-6xl"} font-extrabold text-emerald-300 tabular-nums leading-none`}>
              #{card.nowServing.tokenNo}
            </div>
            <div className="min-w-0">
              <div className={`${big ? "text-xl" : "text-base"} font-semibold truncate`}>{card.nowServing.patientLabel}</div>
              {card.nowServing.testName && <div className={`${big ? "text-sm" : "text-xs"} text-white/60 truncate`}>{card.nowServing.testName}</div>}
            </div>
          </div>
        ) : (
          <div className={`${big ? "text-4xl" : "text-3xl"} font-bold text-white/30 mt-1`}>—</div>
        )}
      </div>

      {/* Up next */}
      <div className="px-5 py-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/50 font-semibold mb-2">Up Next</div>
        {card.waiting.length === 0 ? (
          <div className="text-white/40 text-sm py-3">Queue is clear</div>
        ) : (
          <div className="space-y-1.5">
            {card.waiting.slice(0, big ? 8 : 5).map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/5">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-2xl font-bold tabular-nums text-blue-300 w-12">#{w.tokenNo}</span>
                  <span className="text-sm font-medium truncate">{w.patientLabel}</span>
                  {w.priority > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/30 text-amber-200 text-[10px] uppercase font-bold tracking-wider">VIP</span>
                  )}
                </div>
                {w.testName && <span className="text-xs text-white/40 truncate hidden sm:block">{w.testName}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
