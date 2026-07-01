import { useState, useMemo, useEffect } from "react";
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
  Star, ExternalLink, PhoneCall, Tv, MapPin, Globe, Crown, ShieldAlert, Clock, CheckCircle, Copy, Check,
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

const STATUS_META: Record<TestToken["status"], { label: string; bg: string; border: string; pillBg: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  waiting:  { label: "Waiting",  bg: "bg-amber-500/5 dark:bg-amber-500/10", border: "border-amber-200 dark:border-amber-900/50", pillBg: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800", icon: Hourglass },
  serving:  { label: "Serving",  bg: "bg-blue-500/5 dark:bg-blue-500/10",   border: "border-blue-200 dark:border-blue-900/50",   pillBg: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",       icon: PlayCircle },
  done:     { label: "Done",     bg: "bg-emerald-500/5 dark:bg-emerald-500/10", border: "border-emerald-200 dark:border-emerald-900/50", pillBg: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800", icon: CheckCircle2 },
  skipped:  { label: "Skipped",  bg: "bg-zinc-500/5 dark:bg-zinc-500/10",     border: "border-zinc-200 dark:border-zinc-900/50",   pillBg: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700",      icon: SkipForward },
};

export default function QueuePage() {
  const qc = useQueryClient();
  const [ledgerId, setLedgerId] = useState<number>(() => {
    try { return Number(localStorage.getItem("queue:ledgerId") || "1") || 1; } catch { return 1; }
  });
  const [department, setDepartment] = useState<string>(() => {
    try { return localStorage.getItem("queue:department") || "all"; } catch { return "all"; }
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    try { return localStorage.getItem("queue:statusFilter") || "all"; } catch { return "all"; }
  });
  const [defaultDepartment, setDefaultDepartment] = useState<string>("");
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("queueDisplay:voiceEnabled") !== "0";
    } catch {
      return true;
    }
  });

  const { data: settings } = useQuery<any>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });

  // Persist filter selections so they survive page refresh
  const handleSetLedgerId = (v: number) => {
    setLedgerId(v);
    try { localStorage.setItem("queue:ledgerId", String(v)); } catch {}
  };
  const handleSetDepartment = (v: string) => {
    setDepartment(v);
    try { localStorage.setItem("queue:department", v); } catch {}
  };
  const handleSetStatusFilter = (v: string) => {
    setStatusFilter(v);
    try { localStorage.setItem("queue:statusFilter", v); } catch {}
  };

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

  // Calculate statistics across today's tokens
  const stats = useMemo(() => {
    let active = 0;
    let waiting = 0;
    let serving = 0;
    let done = 0;
    let vip = 0;
    let delayed = 0;

    for (const t of tokens) {
      if (t.status === "waiting" || t.status === "serving") {
        active++;
      }
      if (t.status === "waiting") {
        waiting++;
        const waitMinutes = (Date.now() - new Date(t.createdAt).getTime()) / 60000;
        if (waitMinutes > 30) {
          delayed++;
        }
      }
      if (t.status === "serving") serving++;
      if (t.status === "done") done++;
      if (t.priority > 0 || t.source === "vip") vip++;
    }

    return { active, waiting, serving, done, vip, delayed };
  }, [tokens]);

  // Client-side quick filtering
  const filteredTokens = useMemo(() => {
    return tokens.filter((t) => {
      if (statusFilter === "waiting") return t.status === "waiting";
      if (statusFilter === "serving") return t.status === "serving";
      if (statusFilter === "done") return t.status === "done";
      if (statusFilter === "skipped") return t.status === "skipped";
      if (statusFilter === "vip") return t.priority > 0 || t.source === "vip";
      if (statusFilter === "delayed") {
        const waitMinutes = (Date.now() - new Date(t.createdAt).getTime()) / 60000;
        return t.status === "waiting" && waitMinutes > 30;
      }
      return true;
    });
  }, [tokens, statusFilter]);

  // Group by department if showing all
  const byDept = useMemo(() => {
    if (department !== "all") return null;
    const map = new Map<string, TestToken[]>();
    for (const t of filteredTokens) {
      if (!map.has(t.department)) map.set(t.department, []);
      map.get(t.department)!.push(t);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredTokens, department]);

  const [tvUrl, setTvUrl] = useState<string>("");
  const [tvUrlCopied, setTvUrlCopied] = useState(false);

  const buildDisplayUrl = (token: string) => {
    const p = new URLSearchParams();
    p.set("ledgerId", String(ledgerId));
    // Send currently-filtered dept or the defaultDepartment setting
    const selectedDept = department !== "all" ? department : defaultDepartment;
    if (selectedDept) p.set("departments", selectedDept);
    p.set("voice", voiceEnabled ? "1" : "0");
    p.set("autoplayVoice", voiceEnabled ? "1" : "0");
    if (token) p.set("displayToken", token);
    return `/display?${p.toString()}`;
  };

  const openDisplay = async () => {
    try {
      const res = await api.get<{ token: string }>("/api/display/token");
      const url = buildDisplayUrl(res.token);
      setTvUrl(`${window.location.origin}${url}`);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // If fetching the token fails (e.g. permissions), open without it — the
      // TV will use the staff session from the same browser tab.
      const url = buildDisplayUrl("");
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const copyTvUrl = async () => {
    if (!tvUrl) { await openDisplay(); return; }
    try {
      await navigator.clipboard.writeText(tvUrl);
      setTvUrlCopied(true);
      setTimeout(() => setTvUrlCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="Queue Control Center"
        subtitle={`Live monitoring and smart patient flows · ${tokens.length} total today`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 text-xs"
              onClick={copyTvUrl}
              title="Copy a permanent TV URL (with display token) that works without a staff login session"
            >
              {tvUrlCopied
                ? <><Check size={13} className="mr-1 text-emerald-600" /> Copied!</>
                : <><Copy size={13} className="mr-1" /> Copy TV URL</>
              }
            </Button>
            <Button variant="default" className="bg-primary hover:bg-primary/90 text-white shadow-md shadow-primary/10 transition-all hover:scale-[1.02]" size="sm" onClick={openDisplay}>
              <Tv size={14} className="mr-1.5" /> Open TV Display
              <ExternalLink size={11} className="ml-1.5 opacity-80" />
            </Button>
          </div>
        }
      />

      {/* STATISTICS CARDS GRID */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-slate-900 dark:to-slate-900/60 border border-indigo-200/50 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
          <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Active Queue</div>
          <div className="text-2xl md:text-3xl font-black mt-2 text-slate-800 dark:text-slate-100">{stats.active}</div>
          <div className="text-[10px] text-muted-foreground mt-1">Waiting + Serving</div>
        </div>
        <div className="bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-slate-900 dark:to-slate-900/60 border border-amber-200/50 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
          <div className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">
            <Hourglass size={12} /> Waiting
          </div>
          <div className="text-2xl md:text-3xl font-black mt-2 text-slate-800 dark:text-slate-100">{stats.waiting}</div>
          <div className="text-[10px] text-muted-foreground mt-1">{stats.delayed} patients delayed &gt; 30m</div>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-sky-50 dark:from-slate-900 dark:to-slate-900/60 border border-blue-200/50 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
          <div className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1">
            <PlayCircle size={12} /> Serving
          </div>
          <div className="text-2xl md:text-3xl font-black mt-2 text-slate-800 dark:text-slate-100">{stats.serving}</div>
          <div className="text-[10px] text-muted-foreground mt-1">Currently in rooms</div>
        </div>
        <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-slate-900 dark:to-slate-900/60 border border-amber-300/40 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition-all ring-1 ring-amber-400/20">
          <div className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">
            <Crown size={12} className="text-amber-600 fill-amber-500" /> VIP Patients
          </div>
          <div className="text-2xl md:text-3xl font-black mt-2 text-slate-800 dark:text-slate-100">{stats.vip}</div>
          <div className="text-[10px] text-muted-foreground mt-1">Preserved end-to-end</div>
        </div>
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-slate-900 dark:to-slate-900/60 border border-emerald-200/50 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition-all col-span-2 md:col-span-1">
          <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1">
            <CheckCircle size={12} /> Completed
          </div>
          <div className="text-2xl md:text-3xl font-black mt-2 text-slate-800 dark:text-slate-100">{stats.done}</div>
          <div className="text-[10px] text-muted-foreground mt-1">Examinations finished</div>
        </div>
      </div>

      {/* FILTER & CONFIGURATION CONTROL BAR */}
      <div className="bg-card border border-card-border rounded-xl p-4 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase">Ledger</span>
            <Select value={String(ledgerId)} onValueChange={(v) => handleSetLedgerId(Number(v))}>
              <SelectTrigger className="w-40 h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ledgers.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase">Dept Filter</span>
            <Select value={department} onValueChange={handleSetDepartment}>
              <SelectTrigger className="w-48 h-9 text-xs"><SelectValue /></SelectTrigger>
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
            <span className="text-xs font-semibold text-muted-foreground uppercase">TV Default</span>
            <Select value={defaultDepartment || "__all__"} onValueChange={(v) => setDefaultDepartment(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-48 h-9 text-xs"><SelectValue placeholder="All / current room" /></SelectTrigger>
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
            className={`px-3 py-1.5 h-9 rounded-md border text-xs font-semibold flex items-center gap-1.5 transition-colors ${voiceEnabled ? "bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-300" : "bg-muted border-card-border text-muted-foreground"}`}
            onClick={() => {
              const next = !voiceEnabled;
              setVoiceEnabled(next);
              try { localStorage.setItem("queueDisplay:voiceEnabled", next ? "1" : "0"); } catch {}
            }}
            type="button"
          >
            Voice Calls: {voiceEnabled ? "ENABLED" : "MUTED"}
          </button>

          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, UHID, phone, bill..."
              className="pl-9 h-9 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Button variant="outline" size="sm" className="h-9 px-3 text-xs" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={12} className={`mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* CAPSULAR QUICK FILTERS */}
        <div className="pt-3 border-t border-card-border/60 flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] font-bold text-muted-foreground uppercase mr-2 tracking-wider">Quick Filters:</span>
          {[
            { id: "all", label: "All Statuses" },
            { id: "waiting", label: "Waiting" },
            { id: "serving", label: "Serving / Called" },
            { id: "vip", label: "VIP Priority" },
            { id: "delayed", label: "Delayed (>30m)", alert: stats.delayed > 0 },
            { id: "done", label: "Completed" },
            { id: "skipped", label: "Skipped" },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => handleSetStatusFilter(f.id)}
              className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all flex items-center gap-1.5 ${
                statusFilter === f.id
                  ? "bg-primary text-white border-primary shadow-sm"
                  : "bg-background hover:bg-muted text-slate-600 dark:text-slate-300 border-card-border"
              }`}
            >
              {f.label}
              {f.alert && (
                <span className="h-2 w-2 rounded-full bg-red-500 animate-ping shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* QUEUE CARDS CONTAINER */}
      {filteredTokens.length === 0 ? (
        <div className="bg-card border border-card-border rounded-xl py-20 text-center shadow-sm">
          <Hourglass size={32} className="mx-auto mb-3 text-muted-foreground/40 animate-pulse" />
          <p className="text-base font-semibold text-slate-800 dark:text-slate-200">No matching queue tokens</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">Try adjusting your filters, clearing your search query, or checking a different book ledger.</p>
        </div>
      ) : department === "all" && byDept ? (
        <div className="space-y-6">
          {byDept.map(([deptName, items]) => (
            <DepartmentSection
              key={deptName}
              deptName={deptName}
              items={items}
              settings={settings}
              onSetStatus={(id, status) => setStatus.mutate({ id, status })}
              onCall={(id) => callServing.mutate(id)}
              onTogglePriority={(t) => togglePriority.mutate({ id: t.id, priority: t.priority > 0 ? 0 : 5 })}
            />
          ))}
        </div>
      ) : (
        <DepartmentSection
          deptName={department === "all" ? "Queue Details" : department}
          items={filteredTokens}
          settings={settings}
          onSetStatus={(id, status) => setStatus.mutate({ id, status })}
          onCall={(id) => callServing.mutate(id)}
          onTogglePriority={(t) => togglePriority.mutate({ id: t.id, priority: t.priority > 0 ? 0 : 5 })}
        />
      )}
    </div>
  );
}

function DepartmentSection({
  deptName, items, settings, onSetStatus, onCall, onTogglePriority,
}: {
  deptName: string;
  items: TestToken[];
  settings: any;
  onSetStatus: (id: number, status: TestToken["status"]) => void;
  onCall: (id: number) => void;
  onTogglePriority: (t: TestToken) => void;
}) {
  const room = items[0]?.roomNumber || "";
  const avgWait = settings?.queueEstimatedWaitPerPatient ?? 15;
  const vipMode = settings?.queueVipMode || "highlighted";

  // Pre-calculate positions of waiting patients for estimated wait times
  const waitingSorted = useMemo(() => {
    return items
      .filter((t) => t.status === "waiting")
      .sort((a, b) => {
        // VIP always sorted at the top if highlighted mode, otherwise normal sorting
        if (vipMode === "highlighted") {
          const aV = a.priority > 0 || a.source === "vip" ? 1 : 0;
          const bV = b.priority > 0 || b.source === "vip" ? 1 : 0;
          if (aV !== bV) return bV - aV;
        }
        return a.tokenNo - b.tokenNo;
      });
  }, [items, vipMode]);

  // Map of tokenId -> position index in waiting queue
  const waitingPositions = useMemo(() => {
    const map = new Map<number, number>();
    waitingSorted.forEach((t, idx) => {
      map.set(t.id, idx);
    });
    return map;
  }, [waitingSorted]);

  // Construct status groups.
  // If queueVipMode === "separate", we show VIPs in a separate sub-group in the Waiting column.
  const groups = (Object.keys(STATUS_META) as TestToken["status"][]).map((s) => {
    const groupItems = items.filter((t) => t.status === s);
    return {
      status: s,
      items: groupItems,
    };
  });

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all">
      {/* Header bar */}
      <div className="px-4 py-3.5 border-b border-card-border flex items-center justify-between bg-gradient-to-r from-primary/5 via-muted/30 to-transparent">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">{deptName}</h3>
          {room && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-card-border">
              <MapPin size={11} className="text-primary" /> {room}
            </span>
          )}
        </div>
        <div className="text-xs font-bold text-muted-foreground bg-muted/50 px-2 py-1 rounded border border-card-border/60">
          {items.length} active token{items.length === 1 ? "" : "s"}
        </div>
      </div>

      {/* Grid columns */}
      <div className="grid grid-cols-1 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-card-border">
        {groups.map((g) => {
          const Meta = STATUS_META[g.status];
          const Icon = Meta.icon;

          // If separate VIP mode is active and we are looking at the waiting group:
          const isWaitingGroup = g.status === "waiting";
          const showVipSeparation = isWaitingGroup && vipMode === "separate";

          const vips = showVipSeparation ? g.items.filter(t => t.priority > 0 || t.source === "vip") : [];
          const generals = showVipSeparation ? g.items.filter(t => t.priority === 0 && t.source !== "vip") : g.items;

          return (
            <div key={g.status} className="min-h-[220px] flex flex-col bg-muted/10">
              {/* Column title header */}
              <div className={`px-3 py-2 text-xs font-bold ${Meta.bg} flex items-center justify-between border-b border-card-border`}>
                <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                  <Icon size={13} className="text-slate-500" /> {Meta.label}
                </span>
                <span className="text-[10px] font-black bg-background border border-card-border/60 px-1.5 py-0.5 rounded-full opacity-90">
                  {g.items.length}
                </span>
              </div>

              {/* Column card list */}
              <div className="p-2.5 space-y-2.5 flex-1 overflow-y-auto max-h-[480px]">
                {g.items.length === 0 ? (
                  <div className="text-xs text-muted-foreground/40 px-2 py-6 text-center italic">— Empty column —</div>
                ) : showVipSeparation ? (
                  <div className="space-y-4">
                    {/* VIP Separate Section */}
                    {vips.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-black text-amber-700 uppercase tracking-wider flex items-center gap-1 px-1">
                          <Crown size={11} className="text-amber-500 fill-amber-500" /> VIP Queue ({vips.length})
                        </div>
                        <div className="space-y-2 border-l-2 border-amber-400 pl-1.5 py-0.5">
                          {vips.map((t) => (
                            <TokenCard
                              key={t.id}
                              t={t}
                              avgWait={avgWait}
                              position={waitingPositions.get(t.id)}
                              onSetStatus={onSetStatus}
                              onCall={onCall}
                              onTogglePriority={onTogglePriority}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* General Section */}
                    {generals.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-black text-muted-foreground uppercase tracking-wider px-1">
                          General Queue ({generals.length})
                        </div>
                        <div className="space-y-2 pl-0.5">
                          {generals.map((t) => (
                            <TokenCard
                              key={t.id}
                              t={t}
                              avgWait={avgWait}
                              position={waitingPositions.get(t.id)}
                              onSetStatus={onSetStatus}
                              onCall={onCall}
                              onTogglePriority={onTogglePriority}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  // Regular/Highlighted List
                  generals.map((t) => (
                    <TokenCard
                      key={t.id}
                      t={t}
                      avgWait={avgWait}
                      position={waitingPositions.get(t.id)}
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
  t, position, avgWait, onSetStatus, onCall, onTogglePriority,
}: {
  t: TestToken;
  position?: number;
  avgWait: number;
  onSetStatus: (id: number, status: TestToken["status"]) => void;
  onCall: (id: number) => void;
  onTogglePriority: (t: TestToken) => void;
}) {
  const isVip = t.priority > 0 || t.source === "vip";
  const minutesWaiting = Math.round((Date.now() - new Date(t.createdAt).getTime()) / 60000);
  const isDelayed = t.status === "waiting" && minutesWaiting > 30;

  // Calculate estimated wait time
  const estWait = useMemo(() => {
    if (t.status !== "waiting" || position === undefined) return null;
    return position * avgWait;
  }, [t.status, position, avgWait]);

  return (
    <div
      className={`border rounded-xl p-3 bg-background shadow-sm hover:shadow transition-all relative overflow-hidden group ${
        isVip
          ? "border-amber-300 dark:border-amber-700 bg-amber-50/20 dark:bg-amber-950/10 ring-1 ring-amber-300/30"
          : "border-card-border"
      } ${isDelayed ? "border-red-300 dark:border-red-900/50 bg-red-50/10" : ""}`}
    >
      {/* Side bar accents */}
      {isVip && (
        <div className="absolute top-0 left-0 bottom-0 w-1 bg-amber-400" />
      )}
      {isDelayed && !isVip && (
        <div className="absolute top-0 left-0 bottom-0 w-1 bg-red-400" />
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-2xl font-black tabular-nums text-slate-800 dark:text-slate-100 leading-none">#{t.tokenNo}</span>
          {isVip && <span title="VIP Priority"><Crown size={12} className="text-amber-500 fill-amber-500 animate-bounce" /></span>}
          {t.source === "online" && <span title="Online website booking"><Globe size={11} className="text-blue-500" /></span>}
        </div>
        <div className="flex items-center gap-1">
          {/* Priority Star toggle button */}
          <button
            onClick={() => onTogglePriority(t)}
            className={`p-1 rounded hover:bg-muted transition-colors ${isVip ? "text-amber-500" : "text-muted-foreground/40 hover:text-amber-500"}`}
            title={isVip ? "Demote VIP priority" : "Promote to VIP / priority"}
          >
            <Star size={13} className={isVip ? "fill-amber-500" : ""} />
          </button>
        </div>
      </div>

      <div className="mt-2 space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate max-w-[150px]">
            {t.patientName || "Walk-in Patient"}
          </div>
          {isVip && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded text-[9px] font-black bg-amber-100 text-amber-700 border border-amber-300/60 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900 shrink-0">
              VIP
            </span>
          )}
          {t.source === "online" && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded text-[9px] font-black bg-blue-100 text-blue-700 border border-blue-300/60 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900 shrink-0">
              WEB
            </span>
          )}
        </div>
        
        <div className="text-[10px] text-muted-foreground font-medium truncate">
          {t.testCode && `${t.testCode} · `}{t.testName}
        </div>

        {/* Dynamic Estimated Wait Time Display */}
        {estWait !== null && (
          <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1 mt-1 bg-muted/40 px-1.5 py-0.5 rounded w-fit">
            <Clock size={10} className="text-primary/70" />
            <span>Est. Wait: <strong>{estWait === 0 ? "Next in line" : `~${estWait} mins`}</strong></span>
          </div>
        )}

        {/* Delay Alert */}
        {isDelayed && (
          <div className="text-[9px] text-red-600 dark:text-red-400 font-bold flex items-center gap-1 mt-0.5">
            <ShieldAlert size={9} />
            <span>Waiting for {minutesWaiting} mins!</span>
          </div>
        )}

        {t.patientPhone && (
          <div className="pt-0.5">
            <a href={`tel:${t.patientPhone}`} className="text-[10px] text-muted-foreground inline-flex items-center gap-1 hover:text-primary transition-colors">
              <PhoneCall size={9} /> {t.patientPhone}
            </a>
          </div>
        )}
      </div>

      {/* Actions line */}
      <div className="mt-2.5 pt-2 border-t border-muted-foreground/10 flex flex-wrap gap-1">
        {t.status === "waiting" && (
          <>
            <Button size="sm" variant="default" className="h-6.5 px-2.5 text-[10px] font-bold bg-primary hover:bg-primary/95 text-white flex items-center gap-1 shadow-sm rounded-lg" onClick={() => onCall(t.id)}>
              <PlayCircle size={11} /> Call Patient
            </Button>
            <Button size="sm" variant="outline" className="h-6.5 px-1.5 text-[10px] text-muted-foreground rounded-lg" onClick={() => onSetStatus(t.id, "skipped")} title="Skip patient">
              <SkipForward size={11} />
            </Button>
          </>
        )}
        {t.status === "serving" && (
          <div className="flex gap-1 w-full">
            <Button size="sm" variant="default" className="h-6.5 px-2.5 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 rounded-lg w-full justify-center" onClick={() => onSetStatus(t.id, "done")}>
              <CheckCircle size={11} /> Finish Examination
            </Button>
            <Button size="sm" variant="outline" className="h-6.5 px-2.5 text-[10px] font-semibold text-muted-foreground rounded-lg" onClick={() => onCall(t.id)} title="Recall patient">
              Recall
            </Button>
          </div>
        )}
        {t.status === "skipped" && (
          <Button size="sm" variant="outline" className="h-6.5 px-2 text-[10px] font-bold rounded-lg border-card-border" onClick={() => onSetStatus(t.id, "waiting")}>
            Re-queue Patient
          </Button>
        )}
        {t.status === "done" && (
          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
            <CheckCircle2 size={10} className="fill-emerald-100 dark:fill-emerald-950" /> Examination Completed
          </div>
        )}
      </div>
    </div>
  );
}
