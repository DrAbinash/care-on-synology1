import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import {
  MessageCircle, HelpCircle, Search, AlertCircle, CheckCircle2,
  Activity, Calendar, Phone, MonitorOff,
} from "lucide-react";

// Types mirror artifacts/api-server/src/routes/receptionCommandCenter.ts exactly.

interface FeedItem {
  id: string;
  channel: "whatsapp" | "knowledge_gap";
  priority: "emergency" | "handoff" | "normal";
  title: string;
  subtitle: string;
  timestamp: string;
  ageMinutes: number;
}

interface FeedResponse {
  items: FeedItem[];
  generatedAt: string;
}

interface Machine {
  id: number;
  name: string;
  status: string;
  department: string;
  isDown: boolean;
}

interface TodaysAppointment {
  id: number;
  appointmentId: string;
  timeSlot: string;
  status: string;
  patientFirstName: string | null;
  patientLastName: string | null;
}

interface StatusPanelsResponse {
  machines: Machine[];
  todaysAppointments: TodaysAppointment[];
  notYetConnected: string[];
}

const CHANNEL_OPTIONS = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "knowledge_gap", label: "Unanswered Questions" },
] as const;

const PRIORITY_STYLES: Record<FeedItem["priority"], string> = {
  emergency: "border-rose-400 bg-rose-50 dark:bg-rose-950/20",
  handoff: "border-amber-400 bg-amber-50 dark:bg-amber-950/20",
  normal: "border-border bg-card",
};

const PRIORITY_LABELS: Record<FeedItem["priority"], string> = {
  emergency: "Emergency",
  handoff: "Needs Staff",
  normal: "Normal",
};

const NOT_YET_CONNECTED_LABELS: Record<string, string> = {
  queue_status: "Queue Status (counter/token tracking)",
  doctor_availability: "Doctor Availability (live in/out status)",
  live_modality_status: "Live MRI/CT/USG Status (beyond machine-level)",
  voice_calls: "Phone Calls (Voice channel)",
  web_chat: "Website Chat",
  qr_enquiries: "QR Code Enquiries",
};

export default function ReceptionCommandCenter() {
  const [channelFilter, setChannelFilter] = useState<Set<string>>(new Set());
  const [priorityFilter, setPriorityFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // Per the design doc's filters/notifications section: poll, don't
  // require manual refresh — a 20s interval balances "feels live"
  // against not hammering the database on a screen meant to be left
  // open all shift.
  const feedQ = useQuery({
    queryKey: ["reception-feed"],
    queryFn: () => api.get<FeedResponse>("/api/reception-command-center/feed"),
    refetchInterval: 20_000,
  });

  const statusQ = useQuery({
    queryKey: ["reception-status-panels"],
    queryFn: () => api.get<StatusPanelsResponse>("/api/reception-command-center/status-panels"),
    refetchInterval: 30_000,
  });

  const items = feedQ.data?.items ?? [];

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (channelFilter.size > 0 && !channelFilter.has(it.channel)) return false;
      if (priorityFilter.size > 0 && !priorityFilter.has(it.priority)) return false;
      const q = search.trim().toLowerCase();
      if (q && !it.subtitle.toLowerCase().includes(q) && !it.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, channelFilter, priorityFilter, search]);

  const handoffCount = items.filter((i) => i.priority === "handoff").length;

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, key: string) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSet(next);
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Reception Command Center"
        subtitle="Live AI Receptionist activity in one place — you should never need a second screen for this."
      />

      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[200px_1fr_260px]">
        <div className="border-r border-border p-4 space-y-5 overflow-auto hidden lg:block">
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Channel</h3>
            <div className="space-y-1.5">
              {CHANNEL_OPTIONS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={channelFilter.has(c.key)} onChange={() => toggle(channelFilter, setChannelFilter, c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Priority</h3>
            <div className="space-y-1.5">
              {(["handoff", "normal"] as const).map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={priorityFilter.has(p)} onChange={() => toggle(priorityFilter, setPriorityFilter, p)} />
                  {PRIORITY_LABELS[p]}
                  {p === "handoff" && handoffCount > 0 && (
                    <span className="text-xs bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200 rounded-full px-1.5">{handoffCount}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Search</h3>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <input
                className="w-full h-8 pl-8 pr-2 rounded-md border border-input bg-background text-sm"
                placeholder="Name, phone, query…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="overflow-auto p-4 space-y-2">
          {feedQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Nothing needs attention right now.</p>
            </div>
          ) : (
            filteredItems.map((it) => (
              <div key={it.id} className={`rounded-lg border p-3 ${PRIORITY_STYLES[it.priority]}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {it.channel === "whatsapp" ? <MessageCircle className="h-4 w-4 shrink-0 text-emerald-600" /> : <HelpCircle className="h-4 w-4 shrink-0 text-amber-600" />}
                    <span className="font-medium text-sm truncate">{it.title}</span>
                    {it.priority === "handoff" && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200 shrink-0">Needs Staff</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{it.ageMinutes < 1 ? "just now" : `${it.ageMinutes}m ago`}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1 truncate">{it.subtitle}</p>
              </div>
            ))
          )}
        </div>

        <div className="border-l border-border p-4 space-y-5 overflow-auto hidden lg:block">
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Machine Status
            </h3>
            {statusQ.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : (statusQ.data?.machines.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">No machines configured.</p>
            ) : (
              <div className="space-y-1">
                {statusQ.data!.machines.map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-xs">
                    <span className="truncate">{m.name}</span>
                    <span className={`flex items-center gap-1 shrink-0 ${m.isDown ? "text-rose-600" : "text-emerald-600"}`}>
                      {m.isDown ? <AlertCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                      {m.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Today's Appointments
            </h3>
            {statusQ.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : (statusQ.data?.todaysAppointments.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">No appointments today.</p>
            ) : (
              <div className="space-y-1">
                {statusQ.data!.todaysAppointments.slice(0, 10).map((a) => (
                  <div key={a.id} className="text-xs">
                    <span className="font-medium">{a.timeSlot}</span>{" "}
                    <span className="text-muted-foreground">
                      {[a.patientFirstName, a.patientLastName].filter(Boolean).join(" ") || "Unnamed"} · {a.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <MonitorOff className="h-3.5 w-3.5" /> Not Yet Connected
            </h3>
            <p className="text-xs text-muted-foreground mb-2">
              These channels/widgets were designed but aren't built yet — shown here honestly rather than silently omitted.
            </p>
            <div className="space-y-1">
              {(statusQ.data?.notYetConnected ?? []).map((key) => (
                <div key={key} className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Phone className="h-3 w-3 opacity-50" />
                  {NOT_YET_CONNECTED_LABELS[key] ?? key}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
