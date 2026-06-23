import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, TestTube, Search, Printer, Inbox, FlaskConical, CheckCircle2,
  XCircle, AlertOctagon, ExternalLink, RefreshCw, Trash2, Truck,
  PackageCheck, ChevronRight, ChevronDown,
} from "lucide-react";
import CollectSampleModal from "@/components/CollectSampleModal";
import SampleLabel, { printLabels } from "@/components/SampleLabel";
import { readStaffSession } from "@/lib/staffSession";

type Patient = { id: number; firstName: string; lastName: string; patientId: string; phone: string; gender: string; dateOfBirth: string; ageValue?: number | null; ageUnit?: string | null };
type SampleTest = { orderTestId: number; testId: number; testCode: string; testName: string; category: string; resultStatus: string | null };
type Sample = {
  id: number; barcode: string; orderId: number; patientId: number;
  sampleType: string; containerType: string; volume: string; status: string;
  collectedByName: string; collectedAt: string; collectionSite: string;
  receivedAt: string | null; processingStartedAt: string | null;
  completedAt: string | null; reportedAt: string | null;
  rejectedAt: string | null; rejectionReason: string | null;
  isOutsourced: boolean; outsourceLab: string | null;
  outsourceSentAt: string | null; outsourceExpectedAt: string | null;
  outsourceReceivedAt: string | null; outsourceTrackingId: string | null;
  outsourceCostAmount?: string | number | null;
  outsourceCostOverride?: string | number | null;
  outsourcePatientBill?: string | number | null;
  outsourceMargin?: string | number | null;
  notes: string;
  patient: Patient | null;
  order: { id: number; orderNumber: string } | null;
  tests: SampleTest[];
};

const STATUS_DEFS: Array<{ key: string; label: string; tone: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = [
  { key: "all",            label: "All",          tone: "bg-card text-foreground border-border", icon: Inbox },
  { key: "pending",        label: "Pending",      tone: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900", icon: AlertOctagon },
  { key: "collected",      label: "Collected",    tone: "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900", icon: TestTube },
  { key: "received",       label: "Received",     tone: "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-900", icon: PackageCheck },
  { key: "in_processing",  label: "In Processing", tone: "bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-900", icon: FlaskConical },
  { key: "completed",      label: "Completed",    tone: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900", icon: CheckCircle2 },
  { key: "reported",       label: "Reported",     tone: "bg-green-50 text-green-800 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900", icon: CheckCircle2 },
  { key: "rejected",       label: "Rejected",     tone: "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900", icon: XCircle },
];

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  collected: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  received: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  in_processing: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  reported: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

// What's the next workflow step button(s) for each status.
const NEXT_ACTIONS: Record<string, Array<{ next: string; label: string }>> = {
  pending: [{ next: "collected", label: "Mark Collected" }, { next: "rejected", label: "Reject" }],
  collected: [{ next: "received", label: "Receive at Lab" }, { next: "rejected", label: "Reject" }],
  received: [{ next: "in_processing", label: "Start Processing" }, { next: "rejected", label: "Reject" }],
  in_processing: [{ next: "completed", label: "Mark Completed" }, { next: "rejected", label: "Reject" }],
  completed: [{ next: "reported", label: "Mark Reported" }],
  reported: [],
  rejected: [],
};

export default function Samples() {
  const qc = useQueryClient();
  const [collectOpen, setCollectOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [outsourcedOnly, setOutsourcedOnly] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [outsourcingSample, setOutsourcingSample] = useState<Sample | null>(null);
  const [outsourceForm, setOutsourceForm] = useState({ lab: "", expected: "", tracking: "", costOverride: "" });
  const [outsourceCustom, setOutsourceCustom] = useState(false);
  const [computedCost, setComputedCost] = useState<number | null>(null);

  const session = readStaffSession();
  const staffName = session?.user?.name ?? "";

  const { data: outsourcedLabsList = [] } = useQuery<Array<{ id: number; name: string; isActive: boolean }>>({
    queryKey: ["outsourced-labs"],
    queryFn: () => api.get("/api/outsourced-labs"),
  });
  const activeLabs = outsourcedLabsList.filter((l) => l.isActive !== false);

  const { data, isLoading, refetch } = useQuery<{ samples: Sample[]; counters: Record<string, number> }>({
    queryKey: ["samples", { statusFilter, dateFrom, dateTo, outsourcedOnly, search }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (outsourcedOnly) params.set("outsourcedOnly", "true");
      if (search.trim()) params.set("search", search.trim());
      return api.get(`/api/samples?${params.toString()}`);
    },
  });
  const samples = data?.samples ?? [];
  const counters = data?.counters ?? {};
  const totalAll = useMemo(() => Object.values(counters).reduce((a, b) => a + b, 0), [counters]);

  const statusMut = useMutation({
    mutationFn: ({ id, status, reason }: { id: number; status: string; reason?: string }) =>
      api.post<Sample>(`/api/samples/${id}/status`, {
        status, rejectionReason: reason, actorName: staffName,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["samples"] });
      setRejectingId(null);
      setRejectReason("");
    },
    onError: (err) => alert((err as Error).message),
  });

  const outsourceMut = useMutation({
    mutationFn: (s: Sample) => api.post<Sample>(`/api/samples/${s.id}/outsource`, {
      outsourceLab: outsourceForm.lab.trim(),
      outsourceExpectedAt: outsourceForm.expected,
      outsourceTrackingId: outsourceForm.tracking.trim(),
      outsourceCostOverride: outsourceForm.costOverride ? Number(outsourceForm.costOverride) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["samples"] });
      setOutsourcingSample(null);
      setOutsourceForm({ lab: "", expected: "", tracking: "", costOverride: "" });
      setOutsourceCustom(false);
      setComputedCost(null);
    },
    onError: (err) => alert((err as Error).message),
  });

  const receiveOutsourceMut = useMutation({
    mutationFn: (id: number) => api.post(`/api/samples/${id}/outsource/receive`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["samples"] }),
  });
  const cancelOutsourceMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/samples/${id}/outsource`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["samples"] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/samples/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["samples"] }),
  });

  const handleStatus = (s: Sample, next: string) => {
    if (next === "rejected") {
      setRejectingId(s.id);
      setRejectReason("");
      return;
    }
    statusMut.mutate({ id: s.id, status: next });
  };

  const submitReject = () => {
    if (!rejectingId) return;
    if (!rejectReason.trim()) { alert("Rejection reason is required."); return; }
    statusMut.mutate({ id: rejectingId, status: "rejected", reason: rejectReason.trim() });
  };

  const remove = (s: Sample) => {
    if (!confirm(`Permanently delete sample ${s.barcode}? This will remove it from the workflow.`)) return;
    deleteMut.mutate(s.id);
  };

  const printOne = (s: Sample) => {
    const el = document.querySelector<HTMLElement>(`[data-sample-label="${s.barcode}"]`);
    if (el) printLabels([el]);
  };

  const setQuickRange = (from: string, to: string) => { setDateFrom(from); setDateTo(to); };
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="pb-8">
      <PageHeader
        title="Sample Collection / Lab Processing"
        subtitle="Barcode, collection entry, status tracking, processing workflow & outsourced tests"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              <RefreshCw size={14} className="mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setCollectOpen(true)}>
              <Plus size={14} className="mr-1" /> Collect Sample
            </Button>
          </div>
        }
      />

      <div className="px-6 space-y-5">
        {/* Filters */}
        <div className="bg-card border border-card-border rounded-xl shadow-sm p-3 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-xs">Search by barcode</Label>
            <div className="relative mt-1">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SMP-… or any part" className="pl-7" />
            </div>
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1" />
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => setQuickRange(today, today)}>Today</Button>
            <Button size="sm" variant="outline" onClick={() => setQuickRange(yesterday, yesterday)}>Yesterday</Button>
            <Button size="sm" variant="outline" onClick={() => setQuickRange(weekAgo, today)}>Last 7d</Button>
            <Button size="sm" variant="ghost" onClick={() => { setDateFrom(""); setDateTo(""); }}>All time</Button>
          </div>
          <label className="flex items-center gap-1 text-xs ml-auto cursor-pointer">
            <input
              type="checkbox" checked={outsourcedOnly}
              onChange={(e) => setOutsourcedOnly(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            <ExternalLink size={12} /> Outsourced only
          </label>
        </div>

        {/* Status pipeline */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {STATUS_DEFS.map((s) => {
            const isActive = statusFilter === s.key;
            const count = s.key === "all" ? totalAll : (counters[s.key] ?? 0);
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key)}
                className={`text-left border rounded-lg p-3 transition-all ${s.tone} ${isActive ? "ring-2 ring-primary shadow-md" : "hover:shadow-sm"}`}
              >
                <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide opacity-80">
                  <span>{s.label}</span>
                  <Icon size={14} />
                </div>
                <div className="text-2xl font-bold tabular-nums mt-1">{count}</div>
              </button>
            );
          })}
        </div>

        {/* Samples table */}
        <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-3 py-3 font-medium w-6"></th>
                  <th className="px-3 py-3 font-medium">Barcode</th>
                  <th className="px-3 py-3 font-medium">Patient</th>
                  <th className="px-3 py-3 font-medium">Type / Container</th>
                  <th className="px-3 py-3 font-medium">Tests</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Collected</th>
                  <th className="px-3 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-border/50 animate-pulse">
                      {[...Array(8)].map((_, j) => <td key={j} className="px-3 py-3"><div className="h-4 bg-muted rounded w-16" /></td>)}
                    </tr>
                  ))
                ) : samples.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <TestTube size={32} />
                        <p className="text-sm">No samples found for the selected filters</p>
                        <Button size="sm" onClick={() => setCollectOpen(true)} className="mt-2">
                          <Plus size={14} className="mr-1" /> Collect a sample
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : samples.map((s) => {
                  const expanded = expandedId === s.id;
                  const actions = NEXT_ACTIONS[s.status] ?? [];
                  return (
                    <FragmentWithKey key={s.id}>
                      <tr className="border-b border-border/50 hover:bg-muted/30">
                        <td className="px-3 py-2 align-top">
                          <button onClick={() => setExpandedId(expanded ? null : s.id)} className="text-muted-foreground hover:text-foreground">
                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="font-mono text-xs font-bold text-primary">{s.barcode}</div>
                          {s.order && <div className="text-[10px] text-muted-foreground">{s.order.orderNumber}</div>}
                          {s.isOutsourced && (
                            <span className="inline-flex items-center gap-0.5 mt-1 text-[10px] bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 px-1.5 py-0.5 rounded-full">
                              <ExternalLink size={10} /> Outsourced
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="text-sm font-medium">{s.patient ? `${s.patient.firstName} ${s.patient.lastName}` : "—"}</div>
                          <div className="text-[11px] text-muted-foreground">{s.patient?.patientId} • {s.patient?.gender}</div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="text-xs">{s.sampleType}</div>
                          <div className="text-[11px] text-muted-foreground">{s.containerType}{s.volume ? ` • ${s.volume}` : ""}</div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="text-xs space-y-0.5">
                            {s.tests.length === 0 ? <span className="text-muted-foreground">—</span> :
                              s.tests.slice(0, 2).map((t) => (
                                <div key={t.orderTestId} className="truncate max-w-[180px]" title={t.testName}>{t.testName}</div>
                              ))
                            }
                            {s.tests.length > 2 && <div className="text-[10px] text-muted-foreground">+{s.tests.length - 2} more</div>}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[s.status] ?? "bg-gray-100 text-gray-700"}`}>
                            {s.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="text-[11px]">{new Date(s.collectedAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</div>
                          {s.collectedByName && <div className="text-[10px] text-muted-foreground">by {s.collectedByName}</div>}
                          {s.collectionSite && s.collectionSite !== "Center" && <div className="text-[10px] text-muted-foreground">@ {s.collectionSite}</div>}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            {actions.map((a) => (
                              <Button
                                key={a.next}
                                size="sm"
                                variant={a.next === "rejected" ? "outline" : "default"}
                                className={a.next === "rejected" ? "text-red-600 hover:text-red-700" : ""}
                                onClick={() => handleStatus(s, a.next)}
                                disabled={statusMut.isPending}
                              >
                                {a.label}
                              </Button>
                            ))}
                            {!s.isOutsourced && s.status !== "rejected" && s.status !== "reported" && (
                              <Button size="sm" variant="ghost" title="Send to external lab" onClick={() => { setOutsourcingSample(s); setOutsourceForm({ lab: "", expected: "", tracking: "", costOverride: "" }); setOutsourceCustom(false); }}>
                                <Truck size={14} />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" title="Print label" onClick={() => printOne(s)}>
                              <Printer size={14} />
                            </Button>
                            <Button size="sm" variant="ghost" title="Delete" onClick={() => remove(s)} className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30">
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-muted/20 border-b border-border/50">
                          <td></td>
                          <td colSpan={7} className="px-3 py-3">
                            <SampleDetail s={s}
                              onReceiveOutsource={() => receiveOutsourceMut.mutate(s.id)}
                              onCancelOutsource={() => { if (confirm("Cancel outsourcing? Sample returns to in-house workflow.")) cancelOutsourceMut.mutate(s.id); }}
                            />
                          </td>
                        </tr>
                      )}
                    </FragmentWithKey>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Hidden labels (for printing) — one per sample so the printOne button can grab any */}
      <div className="absolute -left-[9999px] -top-[9999px]" aria-hidden="true">
        {samples.map((s) => (
          <SampleLabel
            key={s.id}
            barcode={s.barcode}
            patientName={s.patient ? `${s.patient.firstName} ${s.patient.lastName}` : "—"}
            patientId={s.patient?.patientId}
            age={s.patient ? `${calcAge(s.patient.dateOfBirth, s.patient.ageValue, s.patient.ageUnit)}${s.patient.ageUnit === "years" ? "y" : s.patient.ageUnit === "months" ? "m" : s.patient.ageUnit === "days" ? "d" : "y"}` : ""}
            gender={s.patient?.gender}
            sampleType={s.sampleType}
            containerType={s.containerType}
            collectedAt={s.collectedAt}
            collectedByName={s.collectedByName}
            testNames={s.tests.map((t) => t.testName)}
          />
        ))}
      </div>

      <CollectSampleModal open={collectOpen} onOpenChange={setCollectOpen} staffName={staffName} />

      {/* Reject dialog */}
      <Dialog open={!!rejectingId} onOpenChange={(v) => { if (!v) { setRejectingId(null); setRejectReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reject Sample</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Reason for rejection *</Label>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Hemolysed / clotted / insufficient quantity / wrong tube…"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectingId(null); setRejectReason(""); }}>Cancel</Button>
            <Button onClick={submitReject} className="bg-red-600 hover:bg-red-700 text-white" disabled={statusMut.isPending}>
              {statusMut.isPending ? "Rejecting…" : "Confirm Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Outsource dialog */}
      <Dialog open={!!outsourcingSample} onOpenChange={(v) => { if (!v) setOutsourcingSample(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Send to External Lab</DialogTitle></DialogHeader>
          {outsourcingSample && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Sending <code className="font-mono font-bold">{outsourcingSample.barcode}</code>
                {" "}({outsourcingSample.tests.length} test{outsourcingSample.tests.length === 1 ? "" : "s"}) to a referral lab.
              </div>
              <div>
                <Label className="text-xs">External Lab *</Label>
                {activeLabs.length > 0 ? (
                  <>
                    <Select value={outsourceCustom ? "__custom__" : outsourceForm.lab} onValueChange={(v) => {
                      if (v === "__custom__") { setOutsourceCustom(true); setOutsourceForm({ ...outsourceForm, lab: "" }); }
                      else { setOutsourceCustom(false); setOutsourceForm({ ...outsourceForm, lab: v }); }
                    }}>
                      <SelectTrigger className="mt-1 text-sm"><SelectValue placeholder="Choose a lab" /></SelectTrigger>
                      <SelectContent>
                        {activeLabs.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
                        <SelectItem value="__custom__">Other (type manually)</SelectItem>
                      </SelectContent>
                    </Select>
                    {outsourceCustom && (
                      <Input value={outsourceForm.lab} onChange={(e) => setOutsourceForm({ ...outsourceForm, lab: e.target.value })} placeholder="Enter lab name" className="mt-2" autoFocus />
                    )}
                  </>
                ) : (
                  <Input value={outsourceForm.lab} onChange={(e) => setOutsourceForm({ ...outsourceForm, lab: e.target.value })} placeholder="SRL Diagnostics" className="mt-1" autoFocus />
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Expected Return</Label>
                  <Input type="date" value={outsourceForm.expected} onChange={(e) => setOutsourceForm({ ...outsourceForm, expected: e.target.value })} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Tracking / Ref ID</Label>
                  <Input value={outsourceForm.tracking} onChange={(e) => setOutsourceForm({ ...outsourceForm, tracking: e.target.value })} placeholder="Optional" className="mt-1" />
                </div>
              </div>
              <div className="border-t border-border pt-2 mt-1">
                <Label className="text-xs">Cost Override (₹)</Label>
                <Input type="number" step="0.01" min={0} value={outsourceForm.costOverride} onChange={(e) => setOutsourceForm({ ...outsourceForm, costOverride: e.target.value })} placeholder="Leave blank to auto-compute from lab rates" className="mt-1" />
                {outsourcingSample && (
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Estimated patient bill: <span className="font-mono font-medium">₹{outsourcingSample.tests.length > 0 ? "will compute on server" : "0"}</span>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOutsourcingSample(null)}>Cancel</Button>
                <Button onClick={() => outsourceMut.mutate(outsourcingSample)} disabled={!outsourceForm.lab.trim() || outsourceForm.lab === "__custom__" || outsourceMut.isPending}>
                  {outsourceMut.isPending ? "Sending…" : "Mark as Sent"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SampleDetail({ s, onReceiveOutsource, onCancelOutsource }: {
  s: Sample;
  onReceiveOutsource: () => void;
  onCancelOutsource: () => void;
}) {
  const events: Array<{ at: string; label: string; sub?: string }> = [];
  events.push({ at: s.collectedAt, label: "Collected", sub: `by ${s.collectedByName || "—"} @ ${s.collectionSite}` });
  if (s.receivedAt) events.push({ at: s.receivedAt, label: "Received at lab" });
  if (s.processingStartedAt) events.push({ at: s.processingStartedAt, label: "Processing started" });
  if (s.completedAt) events.push({ at: s.completedAt, label: "Completed" });
  if (s.reportedAt) events.push({ at: s.reportedAt, label: "Reported" });
  if (s.rejectedAt) events.push({ at: s.rejectedAt, label: "Rejected", sub: s.rejectionReason ?? "" });
  if (s.outsourceSentAt) events.push({ at: s.outsourceSentAt, label: `Sent to ${s.outsourceLab ?? "external lab"}`, sub: s.outsourceTrackingId ? `Ref: ${s.outsourceTrackingId}` : undefined });
  if (s.outsourceReceivedAt) events.push({ at: s.outsourceReceivedAt, label: "Result received from external lab" });
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2">
        <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Tests in this sample</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {s.tests.length === 0 ? <p className="text-xs text-muted-foreground">No tests assigned.</p> :
            s.tests.map((t) => (
              <div key={t.orderTestId} className="text-xs flex items-center gap-2 bg-card border border-border rounded px-2 py-1">
                <FlaskConical size={12} className="text-muted-foreground flex-shrink-0" />
                <span className="flex-1 truncate" title={t.testName}>{t.testName}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{t.testCode}</span>
              </div>
            ))
          }
        </div>
        {s.notes && (
          <>
            <h4 className="text-xs font-semibold text-muted-foreground mt-3 mb-1 uppercase tracking-wide">Notes</h4>
            <p className="text-xs bg-muted/40 border border-border rounded px-2 py-1.5">{s.notes}</p>
          </>
        )}
        {s.isOutsourced && (
          <>
            <h4 className="text-xs font-semibold text-muted-foreground mt-3 mb-1 uppercase tracking-wide flex items-center gap-1">
              <ExternalLink size={12} /> Outsourcing
            </h4>
            <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900 rounded px-2 py-2 text-xs space-y-1">
              <div><strong>Lab:</strong> {s.outsourceLab}</div>
              {s.outsourceExpectedAt && <div><strong>Expected:</strong> {s.outsourceExpectedAt}</div>}
              {s.outsourceTrackingId && <div><strong>Tracking:</strong> {s.outsourceTrackingId}</div>}
              {(s.outsourceCostAmount != null || s.outsourceCostOverride != null) && (
                <div className="border-t border-orange-200 dark:border-orange-900 pt-1 mt-1">
                  <div className="flex justify-between">
                    <span>Computed cost:</span>
                    <span className="font-mono">₹{Number(s.outsourceCostAmount ?? 0).toFixed(2)}</span>
                  </div>
                  {s.outsourceCostOverride != null && (
                    <div className="flex justify-between">
                      <span>Override cost:</span>
                      <span className="font-mono">₹{Number(s.outsourceCostOverride).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Patient bill:</span>
                    <span className="font-mono">₹{Number(s.outsourcePatientBill ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-medium text-green-700 dark:text-green-400">
                    <span>Margin:</span>
                    <span className="font-mono">₹{Number(s.outsourceMargin ?? 0).toFixed(2)}</span>
                  </div>
                </div>
              )}
              {s.outsourceReceivedAt
                ? <div className="text-green-700 dark:text-green-400">✓ Result received {new Date(s.outsourceReceivedAt).toLocaleString("en-IN")}</div>
                : (
                  <div className="flex gap-2 mt-1">
                    <Button size="sm" onClick={onReceiveOutsource}><PackageCheck size={12} className="mr-1" /> Mark Result Received</Button>
                    <Button size="sm" variant="outline" onClick={onCancelOutsource}>Cancel Outsourcing</Button>
                  </div>
                )
              }
            </div>
          </>
        )}
      </div>
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Timeline</h4>
        <ol className="space-y-2 text-xs">
          {events.map((e, i) => (
            <li key={i} className="flex gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{e.label}</div>
                <div className="text-[10px] text-muted-foreground">{new Date(e.at).toLocaleString("en-IN")}</div>
                {e.sub && <div className="text-[10px] text-muted-foreground italic">{e.sub}</div>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function FragmentWithKey({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function calcAge(dob: string, ageValue?: number | null, ageUnit?: string | null): string {
  if (ageValue != null && ageUnit) {
    if (ageUnit === "years") return ageValue > 0 ? `${ageValue}` : "";
    if (ageUnit === "months") return `${ageValue}`;
    if (ageUnit === "days") return `${ageValue}`;
  }
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "";
  return String(Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000)));
}
