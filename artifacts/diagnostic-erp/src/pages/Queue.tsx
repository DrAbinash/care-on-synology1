import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Hourglass, PlayCircle, CheckCircle2, SkipForward, RefreshCw, Search,
  Star, ExternalLink, PhoneCall, Tv, MapPin, Globe, Crown,
} from "lucide-react";

type TestToken = {
  id: number;
  tokenNo: number;
  tokenDate: string;
  status: "waiting" | "serving" | "done" | "skipped";
  priority: number;
  department: string;
  roomNumber: string;
  billId: number | null;
  orderId: number | null;
  patientId: number | null;
  patientName: string | null;
  patientCode: string | null;
  patientPhone: string | null;
  testCode: string | null;
  testName: string | null;
  testDuration: string | null;
  billNumber: string | null;
  calledAt: string | null;
  createdAt: string;
  source: string | null;
};

type Ledger = { id: number; name: string };
type Department = { department: string; roomNumber: string };

const STATUS_META: Record<TestToken["status"], { label: string; bg: string; pillBg: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  waiting:  { label: "Waiting",  bg: "bg-amber-50 dark:bg-amber-900/20",   pillBg: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700", icon: Hourglass },
  serving:  { label: "Serving",  bg: "bg-blue-50 dark:bg-blue-900/20",     pillBg: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700",       icon: PlayCircle },
  done:     { label: "Done",     bg: "bg-emerald-50 dark:bg-emerald-900/20", pillBg: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700", icon: CheckCircle2 },
  skipped:  { label: "Skipped",  bg: "bg-zinc-50 dark:bg-zinc-900/20",     pillBg: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700",      icon: SkipForward },
};

export default function QueuePage() {
  const qc = useQueryClient();
  const [ledgerId, setLedgerId] = useState<number>(1);
  const [department, setDepartment] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [defaultDepartment, setDefaultDepartment] = useState<string>("");
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("queueDisplay:voiceEnabled") !== "0";
    } catch {
      return true;
    }
  });

  const { data: ledgersData } = useQuery<{ ledgers: Ledger[] }>({
    queryKey: ["ledgers"],
    queryFn: () => api.get("/api/ledgers"),
  });
  const ledgers = ledgersData?.ledgers ?? [];

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["test-token-departments"],
    queryFn: () => api.get("/api/test-tokens/departments"),
  });

  const { data: tokens = [], isFetching, refetch } = useQuery<TestToken[]>({
    queryKey: ["test-tokens-today", ledgerId, department, search],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("ledgerId", String(ledgerId));
      if (department !== "all") params.set("department", department);
      if (search.trim()) params.set("search", search.trim());
      return api.get(`/api/test-tokens/today?${params.toString()}`);
    },
    refetchInterval: 5_000,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TestToken["status"] }) =>
      api.patch(`/api/test-tokens/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test-tokens-today"] }),
  });

  const callServing = useMutation({
    mutationFn: (id: number) => api.post(`/api/test-tokens/${id}/call`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test-tokens-today"] }),
  });

  const togglePriority = useMutation({
    mutationFn: ({ id, priority }: { id: number; priority: number }) =>
      api.patch(`/api/test-tokens/${id}`, { priority }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test-tokens-today"] }),
  });

  const counts = useMemo(() => {
    const c: Record<TestToken["status"], number> = { waiting: 0, serving: 0, done: 0, skipped: 0 };
    for (const t of tokens) c[t.status]++;
    return c;
  }, [tokens]);

  // When "all" departments, group by department; otherwise show flat columns by status.
  const byDept = useMemo(() => {
    if (department !== "all") return null;
    const map = new Map<string, TestToken[]>();
    for (const t of tokens) {
      if (!map.has(t.department)) map.set(t.department, []);
      map.get(t.department)!.push(t);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [tokens, department]);

  const openDisplay = () => {
    const params = new URLSearchParams();
    params.set("ledgerId", String(ledgerId));
    const selectedDepartment = department !== "all" ? department : defaultDepartment;
    if (defaultDepartment) params.set("defaultDepartment", defaultDepartment);
    if (selectedDepartment) params.set("departments", selectedDepartment);
    params.set("voice", voiceEnabled ? "1" : "0");
    params.set("autoplayVoice", voiceEnabled ? "1" : "0");
    window.open(`/display?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PageHeader
        title="Queue Tokens"
        subtitle={`Per-test, per-department · ${tokens.length} active`}
        actions={
          <Button variant="outline" size="sm" onClick={openDisplay}>
            <Tv size={14} className="mr-1.5" /> Open Display
            <ExternalLink size={11} className="ml-1.5 opacity-60" />
          </Button>
        }
      />

      {/* Filter bar */}
      <div className="bg-card border border-card-border rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Book</span>
          <Select value={String(ledgerId)} onValueChange={(v) => setLedgerId(Number(v))}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ledgers.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Department</span>
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.department} value={d.department}>
                  {d.department}{d.roomNumber ? ` · ${d.roomNumber}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Default</span>
          <Select value={defaultDepartment || "__all__"} onValueChange={(v) => setDefaultDepartment(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All / current room" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All / current room</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.department} value={d.department}>
                  {d.department}{d.roomNumber ? ` · ${d.roomNumber}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <button
          className={`px-3 py-2 rounded-md border text-sm font-medium ${voiceEnabled ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-muted border-card-border text-muted-foreground"}`}
          onClick={() => {
            const next = !voiceEnabled;
            setVoiceEnabled(next);
            try { localStorage.setItem("queueDisplay:voiceEnabled", next ? "1" : "0"); } catch {}
          }}
          type="button"
        >
          Voice {voiceEnabled ? "On" : "Off"}
        </button>
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search token #, patient, phone, test…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2 ml-auto">
          {(Object.keys(STATUS_META) as TestToken["status"][]).map((s) => (
            <span key={s} className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${STATUS_META[s].pillBg}`}>
              {STATUS_META[s].label}: {counts[s]}
            </span>
          ))}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={13} className={`mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Body */}
      {tokens.length === 0 ? (
        <div className="bg-card border border-card-border rounded-xl py-16 text-center">
          <Hourglass size={28} className="mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-base font-medium">No tokens for the selected filters</p>
          <p className="text-sm text-muted-foreground mt-1">Tokens are auto-issued for each test when a bill is created.</p>
        </div>
      ) : department === "all" && byDept ? (
        <div className="space-y-4">
          {byDept.map(([deptName, items]) => (
            <DepartmentSection
              key={deptName}
              deptName={deptName}
              items={items}
              onSetStatus={(id, status) => setStatus.mutate({ id, status })}
              onCall={(id) => callServing.mutate(id)}
              onTogglePriority={(t) => togglePriority.mutate({ id: t.id, priority: t.priority > 0 ? 0 : 5 })}
            />
          ))}
        </div>
      ) : (
        <DepartmentSection
          deptName={department}
          items={tokens}
          onSetStatus={(id, status) => setStatus.mutate({ id, status })}
          onCall={(id) => callServing.mutate(id)}
          onTogglePriority={(t) => togglePriority.mutate({ id: t.id, priority: t.priority > 0 ? 0 : 5 })}
        />
      )}
    </div>
  );
}

function DepartmentSection({
  deptName, items, onSetStatus, onCall, onTogglePriority,
}: {
  deptName: string;
  items: TestToken[];
  onSetStatus: (id: number, status: TestToken["status"]) => void;
  onCall: (id: number) => void;
  onTogglePriority: (t: TestToken) => void;
}) {
  const groups = (Object.keys(STATUS_META) as TestToken["status"][]).map((s) => ({
    status: s,
    items: items.filter((t) => t.status === s),
  }));
  const room = items[0]?.roomNumber || "";

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-card-border flex items-center justify-between bg-gradient-to-r from-primary/5 via-transparent to-transparent">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-lg">{deptName}</h3>
          {room && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin size={12} /> {room}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{items.length} token{items.length === 1 ? "" : "s"}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4">
        {groups.map((g) => {
          const Meta = STATUS_META[g.status];
          const Icon = Meta.icon;
          return (
            <div key={g.status} className="border-r border-card-border last:border-r-0 min-h-[200px]">
              <div className={`px-3 py-2 text-xs font-semibold ${Meta.bg} flex items-center justify-between`}>
                <span className="flex items-center gap-1.5"><Icon size={13} /> {Meta.label}</span>
                <span className="text-[11px] opacity-70">{g.items.length}</span>
              </div>
              <div className="p-2 space-y-2">
                {g.items.length === 0 ? (
                  <div className="text-xs text-muted-foreground/50 px-2 py-3 text-center">—</div>
                ) : (
                  g.items.map((t) => (
                    <TokenCard
                      key={t.id}
                      t={t}
                      onSetStatus={onSetStatus}
                      onCall={onCall}
                      onTogglePriority={onTogglePriority}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TokenCard({
  t, onSetStatus, onCall, onTogglePriority,
}: {
  t: TestToken;
  onSetStatus: (id: number, status: TestToken["status"]) => void;
  onCall: (id: number) => void;
  onTogglePriority: (t: TestToken) => void;
}) {
  return (
    <div className={`border rounded-lg p-2.5 bg-background ${t.priority > 0 ? "border-amber-300 dark:border-amber-700 ring-1 ring-amber-200 dark:ring-amber-900/50" : "border-card-border"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-2xl font-extrabold tabular-nums text-primary leading-none">#{t.tokenNo}</span>
          {t.source === "vip" && <span title="VIP booking"><Crown size={13} className="text-amber-500 fill-amber-500" /></span>}
          {t.source === "online" && <span title="Online booking"><Globe size={13} className="text-blue-500" /></span>}
          {t.priority > 0 && t.source !== "vip" && t.source !== "online" && <Star size={13} className="text-amber-500 fill-amber-500" />}
        </div>
        <button
          onClick={() => onTogglePriority(t)}
          className={`shrink-0 p-1 rounded hover:bg-muted transition-colors ${t.priority > 0 ? "text-amber-500" : "text-muted-foreground/50 hover:text-amber-500"}`}
          title={t.priority > 0 ? "Remove VIP priority" : "Mark as VIP / priority"}
        >
          <Star size={14} className={t.priority > 0 ? "fill-amber-500" : ""} />
        </button>
      </div>

      <div className="mt-1.5 space-y-0.5">
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-medium truncate">{t.patientName || "—"}</div>
          {t.source === "vip" && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-300 shrink-0">
              <Crown size={8} className="fill-amber-600" />VIP
            </span>
          )}
          {t.source === "online" && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[9px] font-bold bg-blue-100 text-blue-700 border border-blue-300 shrink-0">
              <Globe size={8} />WEB
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">{t.testCode} · {t.testName}</div>
        {t.patientPhone && (
          <a href={`tel:${t.patientPhone}`} className="text-[11px] text-muted-foreground inline-flex items-center gap-1 hover:text-primary">
            <PhoneCall size={10} /> {t.patientPhone}
          </a>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {t.status === "waiting" && (
          <>
            <Button size="sm" variant="default" className="h-6 px-2 text-[11px]" onClick={() => onCall(t.id)}>
              <PlayCircle size={11} className="mr-1" /> Call
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-muted-foreground" onClick={() => onSetStatus(t.id, "skipped")}>
              <SkipForward size={11} />
            </Button>
          </>
        )}
        {t.status === "serving" && (
          <Button size="sm" variant="default" className="h-6 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700" onClick={() => onSetStatus(t.id, "done")}>
            <CheckCircle2 size={11} className="mr-1" /> Done
          </Button>
        )}
        {t.status === "skipped" && (
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onSetStatus(t.id, "waiting")}>
            Re-queue
          </Button>
        )}
        {t.status === "done" && (
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">✓ Completed</span>
        )}
      </div>
    </div>
  );
}
