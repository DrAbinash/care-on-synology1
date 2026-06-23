import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CalendarDays, RefreshCw, Send, CheckCircle2, XCircle, Clock, List,
  Plus, AlertCircle, Server, BookOpen, Copy,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface MwlProcedure {
  id: number;
  accessionNumber: string;
  patientId: string | null;
  patientName: string | null;
  patientSex: string | null;
  patientAge: string | null;
  modality: string | null;
  procedureName: string | null;
  studyDescription: string | null;
  referringDoctor: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  stationAeTitle: string | null;
  status: string;
  createdAt: string;
}

interface MwlResponse {
  procedures: MwlProcedure[];
  byStatus: Record<string, number>;
}

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  SCHEDULED:    { label: "Scheduled",    color: "bg-blue-100 text-blue-800",   icon: <Clock size={12} /> },
  SENT_TO_MWL:  { label: "Sent to MWL",  color: "bg-purple-100 text-purple-800", icon: <Send size={12} /> },
  COMPLETED:    { label: "Completed",    color: "bg-green-100 text-green-800", icon: <CheckCircle2 size={12} /> },
  CANCELLED:    { label: "Cancelled",    color: "bg-red-100 text-red-800",     icon: <XCircle size={12} /> },
};

const MODALITIES = ["", "MR", "CT", "CR", "DX", "US", "NM", "PT", "MG", "OT"];

function formatDate(d: string | null) {
  if (!d) return "—";
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return d;
}

function formatTime(t: string | null) {
  if (!t) return "";
  if (t.length >= 6) return `${t.slice(0, 2)}:${t.slice(2, 4)}`;
  return t;
}

export function MwlPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState("");
  const [filterModality, setFilterModality] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [search, setSearch] = useState("");

  const params = new URLSearchParams();
  if (filterStatus) params.set("status", filterStatus);
  if (filterModality) params.set("modality", filterModality);
  if (filterDate) params.set("date", filterDate);
  if (search) params.set("search", search);

  const { data, isLoading, refetch, isFetching } = useQuery<MwlResponse>({
    queryKey: ["mwl-procedures", filterStatus, filterModality, filterDate, search],
    queryFn: () => api.get(`/api/radiology/mwl-procedures?${params.toString()}`),
    refetchInterval: 30_000,
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.patch(`/api/radiology/mwl-procedures/${id}`, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mwl-procedures"] });
      toast({ title: "Procedure updated" });
    },
  });

  const procedures = data?.procedures ?? [];
  const byStatus = data?.byStatus ?? {};

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {/* Status summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <button
            key={key}
            onClick={() => setFilterStatus(filterStatus === key ? "" : key)}
            className={`rounded-xl border p-4 text-left transition-all hover:shadow-md ${filterStatus === key ? "ring-2 ring-primary" : "bg-card"}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 ${meta.color}`}>
                {meta.icon} {meta.label}
              </span>
            </div>
            <p className="text-2xl font-bold">{byStatus[key] ?? 0}</p>
          </button>
        ))}
      </div>

      {/* How MWL works info panel */}
      <div className="rounded-xl border bg-blue-50 dark:bg-blue-950/20 p-4">
        <div className="flex items-start gap-3">
          <Server size={18} className="text-blue-600 mt-0.5 shrink-0" />
          <div className="text-sm space-y-1">
            <p className="font-semibold text-blue-800 dark:text-blue-300">How the DICOM MWL SCP works</p>
            <p className="text-blue-700 dark:text-blue-400">
              ERP orders → <strong>Windows MWL Agent</strong> (fetches from{" "}
              <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">/api/internal/radiology/mwl</code>) →
              MRI / CT / X-Ray modality worklist via DICOM C-FIND.
            </p>
            <p className="text-blue-700 dark:text-blue-400">
              New scheduled procedures appear here when radiology orders are created. Use{" "}
              <strong>Send to MWL</strong> to mark them as dispatched, or set up{" "}
              <a href="/erp/radiology/agent-setup" className="underline">Windows MWL Agent auto-push</a>.
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Search patient / accession</label>
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-52"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Date</label>
          <Input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="w-44"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Modality</label>
          <Select value={filterModality} onValueChange={setFilterModality}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              {MODALITIES.map((m) => (
                <SelectItem key={m || "__all"} value={m}>{m || "All modalities"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(filterStatus || filterModality || filterDate || search) && (
          <Button variant="ghost" size="sm" onClick={() => {
            setFilterStatus(""); setFilterModality(""); setFilterDate(""); setSearch("");
          }}>Clear filters</Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <List size={15} />
            Scheduled Procedures
          </h3>
          <span className="text-xs text-muted-foreground">{procedures.length} shown</span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : procedures.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-muted-foreground text-sm">No procedures found.</p>
            <p className="text-xs text-muted-foreground">
              Procedures are auto-created when radiology bills/orders are placed. You can also add manually.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium">Accession #</th>
                  <th className="px-4 py-2 text-left font-medium">Patient</th>
                  <th className="px-4 py-2 text-left font-medium">Modality</th>
                  <th className="px-4 py-2 text-left font-medium">Study / Procedure</th>
                  <th className="px-4 py-2 text-left font-medium">Scheduled</th>
                  <th className="px-4 py-2 text-left font-medium">Station AE</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {procedures.map((p) => {
                  const meta = STATUS_META[p.status];
                  return (
                    <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-semibold">{p.accessionNumber}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{p.patientName ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.patientId ?? ""}{p.patientAge ? ` · ${p.patientAge}` : ""}{p.patientSex ? ` · ${p.patientSex}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {p.modality ? (
                          <Badge variant="outline" className="font-mono">{p.modality}</Badge>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <p className="truncate max-w-[180px]">{p.studyDescription ?? p.procedureName ?? "—"}</p>
                        {p.referringDoctor && (
                          <p className="text-xs text-muted-foreground">Dr. {p.referringDoctor}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p>{formatDate(p.scheduledDate)}</p>
                        <p className="text-xs text-muted-foreground">{formatTime(p.scheduledTime)}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{p.stationAeTitle ?? "—"}</td>
                      <td className="px-4 py-3">
                        {meta ? (
                          <span className={`flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 w-fit ${meta.color}`}>
                            {meta.icon} {meta.label}
                          </span>
                        ) : (
                          <Badge variant="secondary">{p.status}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {/* Copy Accession # */}
                          <button
                            onClick={() => {
                              navigator.clipboard?.writeText(p.accessionNumber).catch(() => undefined);
                              toast({ title: "Accession # copied" });
                            }}
                            className="inline-flex items-center gap-0.5 text-[10px] rounded px-1.5 py-0.5 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 font-medium"
                            title="Copy Accession #"
                          >
                            <Copy size={9} /> ACC
                          </button>
                          {p.status === "SCHEDULED" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              disabled={patchMutation.isPending}
                              onClick={() => patchMutation.mutate({ id: p.id, status: "SENT_TO_MWL" })}
                            >
                              <Send size={11} /> Send to MWL
                            </Button>
                          )}
                          {(p.status === "SCHEDULED" || p.status === "SENT_TO_MWL") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-green-700"
                              disabled={patchMutation.isPending}
                              onClick={() => patchMutation.mutate({ id: p.id, status: "COMPLETED" })}
                            >
                              <CheckCircle2 size={11} />
                            </Button>
                          )}
                          {p.status !== "CANCELLED" && p.status !== "COMPLETED" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-red-600"
                              disabled={patchMutation.isPending}
                              onClick={() => patchMutation.mutate({ id: p.id, status: "CANCELLED" })}
                            >
                              <XCircle size={11} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Instructions for adding modalities */}
      <div className="rounded-xl border p-5 bg-muted/30 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <BookOpen size={15} /> How to add MRI / CT / X-Ray modalities
        </h3>
        <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>Go to <strong>Radiology → Modality Management</strong></li>
          <li>Click <strong>Add Modality</strong> and enter: Name, Modality Type (MR/CT/CR/DX/US), AE Title, IP Address, Port</li>
          <li>Enable <strong>Polling</strong> to let the pull agent query this modality for new studies</li>
          <li>Enable <strong>Auto-create Worklist</strong> to push arrived studies to the MWL automatically</li>
          <li>Configure the <strong>Station AE Title</strong> here so the modality knows to pick up its worklist</li>
        </ol>
      </div>
    </div>
  );
}

export default function MwlDashboard() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="MWL Dashboard" subtitle="Modality Worklist — scheduled imaging procedures" />
      <MwlPanel />
    </div>
  );
}
