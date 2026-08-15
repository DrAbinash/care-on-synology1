import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Server, Plus, Pencil, Trash2, PlugZap, CheckCircle2, XCircle, Wifi,
  WifiOff, AlertTriangle, Network, RefreshCw, Download, Clock, AlertCircle,
  PlayCircle, History, Settings2, Info,
} from "lucide-react";

type DicomNode = {
  id: number;
  aeTitle: string;
  host: string;
  port: number;
  modality: string;
  description: string;
  location: string;
  isActive: boolean;
  autoPull: boolean;
  pullIntervalSeconds: number;
  queryLookbackHours: number;
  conquestAeTitle: string;
  conquestHost: string;
  conquestPort: number;
  lastTestAt: string | null;
  lastTestStatus: "success" | "failed" | null;
  lastTestMessage: string | null;
  lastTestLatencyMs: number | null;
  lastPullAt: string | null;
  lastPullStatus: "success" | "failed" | "partial" | null;
  lastPullMessage: string | null;
  preferredRetrieveMethod: string;
};

type PullJob = {
  id: number;
  nodeId: number;
  triggerType: string;
  status: string;
  queryDateFrom: string;
  queryDateTo: string;
  studiesFound: number | null;
  studiesPulled: number | null;
  studiesFailed: number | null;
  errorMessage: string | null;
  agentId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

type ProviderInfo = {
  type: "orthanc" | "conquest" | "none";
  displayName: string;
  baseUrl: string | null;
  capabilities: {
    studyArchive: boolean;
    teleradiologyShare: boolean;
    mwlPush: boolean;
    instanceMetadata: boolean;
  };
  health: { ok: boolean; status?: number; message?: string };
};

const MODALITIES = [
  { code: "CT", label: "CT — Computed Tomography" },
  { code: "MR", label: "MR — Magnetic Resonance (MRI)" },
  { code: "CR", label: "CR — Computed Radiography" },
  { code: "DX", label: "DX — Digital Radiography (DR)" },
  { code: "US", label: "US — Ultrasound (USG)" },
  { code: "MG", label: "MG — Mammography" },
  { code: "NM", label: "NM — Nuclear Medicine" },
  { code: "PT", label: "PT — PET" },
  { code: "XA", label: "XA — X-ray Angiography" },
  { code: "RF", label: "RF — Radio Fluoroscopy" },
  { code: "ECG", label: "ECG — Electrocardiogram" },
  { code: "ES", label: "ES — Endoscopy" },
  { code: "OT", label: "OT — Other" },
];

const MODALITY_COLOR: Record<string, string> = {
  CT: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  MR: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  CR: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  DX: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  US: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  MG: "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300",
  NM: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  PT: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  XA: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  RF: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  ECG: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  ES: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  OT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

const PULL_INTERVALS = [
  { value: 60,    label: "Every 1 min" },
  { value: 300,   label: "Every 5 min" },
  { value: 600,   label: "Every 10 min" },
  { value: 900,   label: "Every 15 min" },
  { value: 1200,  label: "Every 20 min" },
  { value: 1800,  label: "Every 30 min" },
  { value: 3600,  label: "Every hour" },
];

type NodeForm = {
  aeTitle: string;
  host: string;
  port: number;
  modality: string;
  description: string;
  location: string;
  isActive: boolean;
  autoPull: boolean;
  pullIntervalSeconds: number;
  queryLookbackHours: number;
  conquestAeTitle: string;
  conquestHost: string;
  conquestPort: number;
  preferredRetrieveMethod: string;
  watchFolderPath: string;
};

const RETRIEVE_METHOD_OPTIONS = [
  { value: "C_MOVE", label: "C-MOVE" },
  { value: "C_GET", label: "C-GET" },
  { value: "C_STORE", label: "C-STORE SCP" },
  { value: "WATCH_FOLDER", label: "Watch Folder" },
  { value: "C_STORE_OR_WATCH_FOLDER", label: "C-STORE + Watch Folder" },
  { value: "USB_DICOMDIR", label: "USB / DICOMDIR" },
  { value: "NON_DICOM_JPG_PNG", label: "Non-DICOM JPG/PNG" },
];

function emptyForm(): NodeForm {
  return {
    aeTitle: "", host: "", port: 104, modality: "CT",
    description: "", location: "", isActive: true,
    autoPull: false, pullIntervalSeconds: 300, queryLookbackHours: 24,
    conquestAeTitle: "", conquestHost: "", conquestPort: 5680,
    preferredRetrieveMethod: "C_MOVE",
    watchFolderPath: "",
  };
}

function jobStatusBadge(status: string) {
  const cls: Record<string, string> = {
    pending:   "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    running:   "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    completed: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
    partial:   "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
    failed:    "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold capitalize ${cls[status] ?? cls.failed}`}>
      {status}
    </span>
  );
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function DicomNodesPanel() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"nodes" | "jobs">("nodes");
  const [editing, setEditing] = useState<DicomNode | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<NodeForm>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<Record<number, { ok: boolean; message: string; latencyMs: number }>>({});
  const [formTest, setFormTest] = useState<{ ok: boolean; message: string; latencyMs: number } | null>(null);
  const [formTesting, setFormTesting] = useState(false);
  const [pullingId, setPullingId] = useState<number | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);

  const { data: provider, refetch: refetchProvider } = useQuery<ProviderInfo>({
    queryKey: ["dicom-provider"],
    queryFn: () => api.get("/api/dicom/provider"),
  });

  const { data: nodesResp, isLoading } = useQuery<{ nodes: DicomNode[] }>({
    queryKey: ["dicom-nodes"],
    queryFn: () => api.get("/api/dicom/nodes"),
    refetchInterval: tab === "nodes" ? 15_000 : false,
  });
  const nodes = nodesResp?.nodes ?? [];

  const { data: jobsResp, isLoading: jobsLoading } = useQuery<{ jobs: PullJob[] }>({
    queryKey: ["dicom-pull-jobs", selectedNodeId],
    queryFn: () => api.get(`/api/dicom/pull-jobs${selectedNodeId ? `?nodeId=${selectedNodeId}` : ""}`),
    refetchInterval: tab === "jobs" ? 8_000 : false,
    enabled: tab === "jobs",
  });
  const jobs = jobsResp?.jobs ?? [];

  const createMut = useMutation({
    mutationFn: (body: NodeForm) => api.post<DicomNode>("/api/dicom/nodes", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dicom-nodes"] }); setOpen(false); },
    onError: (err) => setFormError((err as Error).message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: NodeForm }) =>
      api.put<DicomNode>(`/api/dicom/nodes/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dicom-nodes"] }); setOpen(false); },
    onError: (err) => setFormError((err as Error).message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/dicom/nodes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dicom-nodes"] }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormError(null);
    setFormTest(null);
    setOpen(true);
  };

  const loadPreset = (preset: NodeForm) => {
    setEditing(null);
    setForm(preset);
    setFormError(null);
    setFormTest(null);
    setOpen(true);
  };

  const CLINIC_PRESETS: { label: string; preset: NodeForm }[] = [
    {
      label: "MRI UH",
      preset: {
        aeTitle: "UIH", host: "172.16.1.103", port: 3333, modality: "MR",
        description: "MRI scanner", location: "Room 1", isActive: true,
        // MRI studies are large; 20 min keeps Orthanc/NAS free for billing & USG C-STORE.
        autoPull: true, pullIntervalSeconds: 1200, queryLookbackHours: 24,
        conquestAeTitle: "ORTHANC2", conquestHost: "172.16.1.139", conquestPort: 5680,
        preferredRetrieveMethod: "C_MOVE",
        watchFolderPath: "",
      },
    },
    {
      label: "CT Scan",
      preset: {
        aeTitle: "ct99", host: "172.16.1.99", port: 4006, modality: "CT",
        description: "CT scanner", location: "Room 2", isActive: true,
        autoPull: true, pullIntervalSeconds: 300, queryLookbackHours: 24,
        conquestAeTitle: "ORTHANC2", conquestHost: "172.16.1.139", conquestPort: 5680,
        preferredRetrieveMethod: "C_MOVE",
        watchFolderPath: "",
      },
    },
    {
      label: "USG Voluson",
      preset: {
        aeTitle: "Voluson", host: "172.16.1.46", port: 104, modality: "US",
        description: "Ultrasound", location: "Room 3", isActive: true,
        autoPull: true, pullIntervalSeconds: 300, queryLookbackHours: 24,
        conquestAeTitle: "ORTHANC2", conquestHost: "172.16.1.139", conquestPort: 5680,
        preferredRetrieveMethod: "C_STORE_OR_WATCH_FOLDER",
        watchFolderPath: "D:/HopeDicomFresh/*",
      },
    },
    {
      label: "Conquest PACS",
      preset: {
        aeTitle: "ORTHANC2", host: "172.16.1.139", port: 5680, modality: "OT",
        description: "Conquest PACS", location: "Server", isActive: true,
        autoPull: false, pullIntervalSeconds: 300, queryLookbackHours: 24,
        conquestAeTitle: "", conquestHost: "", conquestPort: 5680,
        preferredRetrieveMethod: "C_MOVE",
        watchFolderPath: "",
      },
    },
  ];

  const openEdit = (node: DicomNode) => {
    setEditing(node);
    setForm({
      aeTitle: node.aeTitle, host: node.host, port: node.port,
      modality: node.modality, description: node.description,
      location: node.location, isActive: node.isActive,
      autoPull: node.autoPull,
      pullIntervalSeconds: (node as any).pullIntervalSeconds ?? 300,
      queryLookbackHours: (node as any).queryLookbackHours ?? 24,
      conquestAeTitle: node.conquestAeTitle ?? "",
      conquestHost: node.conquestHost ?? "",
      conquestPort: node.conquestPort ?? 5680,
      preferredRetrieveMethod: (node as any).preferredRetrieveMethod ?? "C_MOVE",
      watchFolderPath: (node as any).watchFolderPath ?? "",
    });
    setFormError(null);
    setFormTest(null);
    setOpen(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.aeTitle.trim() || !form.host.trim()) {
      setFormError("AE Title and Host are required.");
      return;
    }
    if (form.port < 1 || form.port > 65535 || !Number.isInteger(form.port)) {
      setFormError("Port must be an integer between 1 and 65535.");
      return;
    }
    if (editing) updateMut.mutate({ id: editing.id, body: form });
    else createMut.mutate(form);
  };

  const testNode = async (id: number) => {
    setTestingId(id);
    try {
      const r = await api.post<{ ok: boolean; message: string; latencyMs: number }>(
        `/api/dicom/nodes/${id}/test`, {}
      );
      setTestResult((prev) => ({ ...prev, [id]: r }));
      qc.invalidateQueries({ queryKey: ["dicom-nodes"] });
    } catch (err) {
      setTestResult((prev) => ({ ...prev, [id]: { ok: false, message: (err as Error).message, latencyMs: 0 } }));
    } finally {
      setTestingId(null);
    }
  };

  const testForm = async () => {
    if (!form.host.trim() || !form.port) return;
    setFormTesting(true);
    setFormTest(null);
    try {
      const r = await api.post<{ ok: boolean; message: string; latencyMs: number }>(
        "/api/dicom/test-connection", { host: form.host.trim(), port: Number(form.port) }
      );
      setFormTest(r);
    } catch (err) {
      setFormTest({ ok: false, message: (err as Error).message, latencyMs: 0 });
    } finally {
      setFormTesting(false);
    }
  };

  const pullNow = async (node: DicomNode) => {
    setPullingId(node.id);
    try {
      await api.post(`/api/dicom/nodes/${node.id}/pull`, {});
      qc.invalidateQueries({ queryKey: ["dicom-pull-jobs"] });
      setTab("jobs");
      setSelectedNodeId(node.id);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setPullingId(null);
    }
  };

  const remove = (node: DicomNode) => {
    if (!confirm(`Delete DICOM node "${node.aeTitle}" (${node.host}:${node.port})? This cannot be undone.`)) return;
    deleteMut.mutate(node.id);
  };

  const isMutating = createMut.isPending || updateMut.isPending;

  return (
    <div>
      <div className="flex justify-end gap-2 pb-4">
        <Button size="sm" variant="outline" onClick={() => refetchProvider()}>
          <RefreshCw size={14} className="mr-1" /> Refresh
        </Button>
        {tab === "nodes" && (
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} className="mr-1" /> Add Node
          </Button>
        )}
      </div>

      <div className="px-6 space-y-5">
        <ProviderBanner provider={provider} />

        {/* Quick Setup Presets */}
        {tab === "nodes" && nodes.length === 0 && (
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <PlugZap size={16} className="text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-bold text-blue-800 dark:text-blue-300">Quick Setup — Your Clinic Modality Presets</h3>
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-400 mb-3">
              Auto-Pull ON · 10 min interval · 2 days query · Conquest PACS at 172.16.1.139:5680
            </p>
            <div className="flex flex-wrap gap-2">
              {CLINIC_PRESETS.map((p) => (
                <Button
                  key={p.label}
                  size="sm"
                  variant="outline"
                  className="bg-white dark:bg-card border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                  onClick={() => loadPreset(p.preset)}
                >
                  <Plus size={13} className="mr-1" />
                  {p.label}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={openCreate}>
                <Settings2 size={13} className="mr-1" /> Custom
              </Button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {(["nodes", "jobs"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "nodes" ? (
                <span className="inline-flex items-center gap-1.5"><Settings2 size={13} /> Nodes</span>
              ) : (
                <span className="inline-flex items-center gap-1.5"><History size={13} /> Pull Jobs</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Nodes tab ── */}
        {tab === "nodes" && (
          <>
            <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                      <th className="px-4 py-3 font-medium">AE Title</th>
                      <th className="px-4 py-3 font-medium">Modality</th>
                      <th className="px-4 py-3 font-medium">Host : Port</th>
                      <th className="px-4 py-3 font-medium">Location</th>
                      <th className="px-4 py-3 font-medium">Connectivity</th>
                      <th className="px-4 py-3 font-medium">Auto-Pull</th>
                      <th className="px-4 py-3 font-medium">Retrieve</th>
                      <th className="px-4 py-3 font-medium">Last Pull</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      [...Array(3)].map((_, i) => (
                        <tr key={i} className="border-b border-border/50 animate-pulse">
                          {[...Array(8)].map((_, j) => (
                            <td key={j} className="px-4 py-3">
                              <div className="h-4 bg-muted rounded w-24" />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : nodes.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-16 text-center">
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <Server size={28} />
                            <p className="text-sm">No DICOM nodes registered yet</p>
                            <p className="text-xs">Add your CT scanner, MRI, ultrasound machine, etc.</p>
                            <Button size="sm" onClick={openCreate} className="mt-2">
                              <Plus size={14} className="mr-1" /> Add your first node
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      nodes.map((n) => {
                        const liveTest = testResult[n.id];
                        const status = liveTest ?? (n.lastTestStatus ? {
                          ok: n.lastTestStatus === "success",
                          message: n.lastTestMessage ?? "",
                          latencyMs: n.lastTestLatencyMs ?? 0,
                        } : null);
                        return (
                          <tr key={n.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                            <td className="px-4 py-3">
                              <div className="font-mono font-medium text-primary">{n.aeTitle}</div>
                              {n.description && (
                                <div className="text-xs text-muted-foreground mt-0.5">{n.description}</div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${MODALITY_COLOR[n.modality] ?? MODALITY_COLOR.OT}`}>
                                {n.modality}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">
                              <Network size={12} className="inline mr-1 text-muted-foreground" />
                              {n.host}:{n.port}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{n.location || "—"}</td>
                            <td className="px-4 py-3">
                              {!n.isActive ? (
                                <span className="text-xs text-muted-foreground">Disabled</span>
                              ) : status ? (
                                status.ok ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 px-2 py-0.5 rounded">
                                    <CheckCircle2 size={12} /> Online
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-2 py-0.5 rounded">
                                    <XCircle size={12} /> Offline
                                  </span>
                                )
                              ) : (
                                <span className="text-xs text-muted-foreground">Untested</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {n.autoPull ? (
                                <div>
                                  <span className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 px-2 py-0.5 rounded">
                                    <Clock size={10} /> {PULL_INTERVALS.find(i => i.value === (n as any).pullIntervalSeconds)?.label ?? `${(n as any).pullIntervalSeconds}s`}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">Off</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-[11px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                                {RETRIEVE_METHOD_OPTIONS.find(o => o.value === (n.preferredRetrieveMethod ?? "C_MOVE"))?.label ?? (n.preferredRetrieveMethod ?? "C-MOVE")}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {n.lastPullAt ? (
                                <div>
                                  <div className={n.lastPullStatus === "success" ? "text-green-700 dark:text-green-400" : n.lastPullStatus === "partial" ? "text-orange-600" : "text-red-600"}>
                                    {n.lastPullStatus ?? "—"}
                                  </div>
                                  <div className="text-muted-foreground">{fmtDate(n.lastPullAt)}</div>
                                  {n.lastPullMessage && (
                                    <div className="text-[11px] text-muted-foreground truncate max-w-[160px]">{n.lastPullMessage}</div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">Never</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm" variant="ghost"
                                  disabled={testingId === n.id || !n.isActive}
                                  onClick={() => testNode(n.id)}
                                  title="Test TCP connectivity"
                                >
                                  {testingId === n.id
                                    ? <RefreshCw size={14} className="animate-spin" />
                                    : <PlugZap size={14} />}
                                </Button>
                                <Button
                                  size="sm" variant="ghost"
                                  disabled={pullingId === n.id || !n.isActive}
                                  onClick={() => pullNow(n)}
                                  title="Pull studies now (manual trigger)"
                                  className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                                >
                                  {pullingId === n.id
                                    ? <RefreshCw size={14} className="animate-spin" />
                                    : <Download size={14} />}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => openEdit(n)} title="Edit">
                                  <Pencil size={14} />
                                </Button>
                                <Button
                                  size="sm" variant="ghost" onClick={() => remove(n)}
                                  title="Delete"
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                                >
                                  <Trash2 size={14} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-4 text-xs text-amber-800 dark:text-amber-200 space-y-1">
              <p className="font-semibold flex items-center gap-1.5"><AlertCircle size={13} /> Auto-Pull requires the DICOM Pull Agent running on the Conquest server</p>
              <p>Install the agent from <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">dicom-pull-agent/</code> on your Conquest PC. Set <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">ERP_BASE_URL</code> and <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">INTERNAL_API_KEY</code>, then run <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">node src/index.js</code>. DCMTK must be installed on the same machine.</p>
            </div>
          </>
        )}

        {/* ── Pull Jobs tab ── */}
        {tab === "jobs" && (
          <>
            <div className="flex items-center gap-3">
              <Select
                value={selectedNodeId ? String(selectedNodeId) : "all"}
                onValueChange={(v) => setSelectedNodeId(v === "all" ? null : Number(v))}
              >
                <SelectTrigger className="w-52 h-8 text-xs">
                  <SelectValue placeholder="All nodes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All nodes</SelectItem>
                  {nodes.map((n) => (
                    <SelectItem key={n.id} value={String(n.id)}>
                      {n.aeTitle} ({n.modality})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["dicom-pull-jobs"] })}>
                <RefreshCw size={12} className="mr-1" /> Refresh
              </Button>
            </div>

            <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                      <th className="px-4 py-3 font-medium">Job ID</th>
                      <th className="px-4 py-3 font-medium">Node</th>
                      <th className="px-4 py-3 font-medium">Trigger</th>
                      <th className="px-4 py-3 font-medium">Date Range</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Studies</th>
                      <th className="px-4 py-3 font-medium">Agent</th>
                      <th className="px-4 py-3 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobsLoading ? (
                      [...Array(5)].map((_, i) => (
                        <tr key={i} className="border-b border-border/50 animate-pulse">
                          {[...Array(8)].map((_, j) => (
                            <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded w-20" /></td>
                          ))}
                        </tr>
                      ))
                    ) : jobs.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-16 text-center">
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <History size={28} />
                            <p className="text-sm">No pull jobs yet</p>
                            <p className="text-xs">Use the <Download size={12} className="inline" /> button on a node to trigger a manual pull, or enable auto-pull in the node settings.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      jobs.map((j) => {
                        const node = nodes.find((n) => n.id === j.nodeId);
                        return (
                          <tr key={j.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{j.id}</td>
                            <td className="px-4 py-3">
                              {node ? (
                                <div>
                                  <span className="font-mono text-xs font-medium text-primary">{node.aeTitle}</span>
                                  <span className={`ml-1.5 inline-block px-1.5 py-0 rounded text-[10px] font-semibold ${MODALITY_COLOR[node.modality] ?? MODALITY_COLOR.OT}`}>
                                    {node.modality}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">Node #{j.nodeId}</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${j.triggerType === "auto" ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300" : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}>
                                {j.triggerType === "auto" ? <Clock size={10} /> : <PlayCircle size={10} />}
                                {j.triggerType}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                              {j.queryDateFrom === j.queryDateTo ? j.queryDateFrom : `${j.queryDateFrom} → ${j.queryDateTo}`}
                            </td>
                            <td className="px-4 py-3">
                              {jobStatusBadge(j.status)}
                              {j.errorMessage && (
                                <div className="text-[11px] text-red-600 mt-0.5 max-w-[180px] truncate" title={j.errorMessage}>
                                  {j.errorMessage}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {j.studiesFound != null ? (
                                <div className="space-y-0.5">
                                  <div>Found: <strong>{j.studiesFound}</strong></div>
                                  {j.studiesPulled != null && (
                                    <div className="text-green-700 dark:text-green-400">Pulled: <strong>{j.studiesPulled}</strong></div>
                                  )}
                                  {(j.studiesFailed ?? 0) > 0 && (
                                    <div className="text-red-600">Failed: <strong>{j.studiesFailed}</strong></div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                              {j.agentId ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {fmtDate(j.createdAt)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit DICOM Node" : "Add DICOM Node"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {/* ── Basic fields ── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">AE Title *</Label>
                <Input
                  value={form.aeTitle}
                  onChange={(e) => setForm({ ...form, aeTitle: e.target.value })}
                  maxLength={16}
                  placeholder="CT_SCANNER_01"
                  className="mt-1 font-mono"
                />
                <p className="text-[11px] text-muted-foreground mt-1">Max 16 chars. Letters, digits, _ -.</p>
              </div>
              <div>
                <Label className="text-xs">Modality *</Label>
                <Select value={form.modality} onValueChange={(v) => setForm({ ...form, modality: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODALITIES.map((m) => (
                      <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Machine IP / Hostname *</Label>
                <Input
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="192.168.1.50"
                  className="mt-1 font-mono"
                />
              </div>
              <div>
                <Label className="text-xs">Port *</Label>
                <Input
                  type="number" value={form.port}
                  onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                  min={1} max={65535} className="mt-1 font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Location</Label>
                <Input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Room 3, First Floor"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Siemens Somatom Definition AS"
                  className="mt-1"
                />
              </div>
            </div>
            <div className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
              <div>
                <Label className="text-xs">Active</Label>
                <p className="text-[11px] text-muted-foreground">Inactive nodes are skipped by all pull operations.</p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
            </div>

            {/* ── Auto-Pull section ── */}
            <div className="border border-blue-200 dark:border-blue-900 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 px-3 py-2.5">
                <div>
                  <Label className="text-xs font-semibold text-blue-800 dark:text-blue-200">
                    <Download size={12} className="inline mr-1" />
                    Auto-Pull (DICOM Q/R)
                  </Label>
                  <p className="text-[11px] text-blue-700 dark:text-blue-300 mt-0.5">
                    Conquest will automatically pull studies from this machine via C-FIND + C-MOVE.
                    Requires the DICOM Pull Agent running on the Conquest PC.
                  </p>
                </div>
                <Switch
                  checked={form.autoPull}
                  onCheckedChange={(v) => setForm({ ...form, autoPull: v })}
                />
              </div>

              {form.autoPull && (
                <div className="p-3 space-y-3 bg-card">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Pull frequency</Label>
                      <Select
                        value={String(form.pullIntervalSeconds)}
                        onValueChange={(v) => setForm({ ...form, pullIntervalSeconds: Number(v) })}
                      >
                        <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PULL_INTERVALS.map((i) => (
                            <SelectItem key={i.value} value={String(i.value)}>{i.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Query lookback (hours)</Label>
                      <Select
                        value={String(form.queryLookbackHours)}
                        onValueChange={(v) => setForm({ ...form, queryLookbackHours: Number(v) })}
                      >
                        <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[1, 6, 12, 24, 48, 72, 168].map((h) => (
                            <SelectItem key={h} value={String(h)}>{h === 24 ? "Last 24 hours" : `Last ${h} hours`}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Preferred Retrieve Method</Label>
                    <Select
                      value={form.preferredRetrieveMethod}
                      onValueChange={(v) => setForm({ ...form, preferredRetrieveMethod: v })}
                    >
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {RETRIEVE_METHOD_OPTIONS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground mt-1">How the pull agent fetches images. USG machines may use C-STORE, Watch Folder, or hybrid mode.</p>
                  </div>

                  <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide">Conquest PACS destination (optional overrides)</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Conquest AE Title</Label>
                      <Input
                        value={form.conquestAeTitle}
                        onChange={(e) => setForm({ ...form, conquestAeTitle: e.target.value.toUpperCase() })}
                        placeholder="CONQUEST1"
                        className="mt-1 font-mono h-8 text-xs"
                        maxLength={16}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Conquest Host</Label>
                      <Input
                        value={form.conquestHost}
                        onChange={(e) => setForm({ ...form, conquestHost: e.target.value })}
                        placeholder="127.0.0.1"
                        className="mt-1 font-mono h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Conquest Port</Label>
                      <Input
                        type="number" value={form.conquestPort}
                        onChange={(e) => setForm({ ...form, conquestPort: Number(e.target.value) })}
                        min={1} max={65535}
                        className="mt-1 font-mono h-8 text-xs"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Leave blank to use the agent's default Conquest settings (CONQUEST_AE_TITLE / CONQUEST_HOST / CONQUEST_PORT env vars).</p>
                </div>
              )}
            </div>

            {/* Inline connection test */}
            <div className="bg-muted/30 border border-border rounded-lg p-3 flex items-center gap-3">
              <Button type="button" size="sm" variant="outline" disabled={formTesting || !form.host.trim()} onClick={testForm}>
                {formTesting ? <RefreshCw size={12} className="mr-1 animate-spin" /> : <PlugZap size={12} className="mr-1" />}
                Test TCP
              </Button>
              {formTest && (
                formTest.ok ? (
                  <span className="text-xs text-green-700 dark:text-green-400 inline-flex items-center gap-1">
                    <CheckCircle2 size={12} /> {formTest.message}
                  </span>
                ) : (
                  <span className="text-xs text-red-700 dark:text-red-400 inline-flex items-center gap-1">
                    <XCircle size={12} /> {formTest.message}
                  </span>
                )
              )}
            </div>

            {formError && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md p-2">
                {formError}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isMutating}>
                {isMutating ? "Saving…" : editing ? "Save Changes" : "Add Node"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProviderBanner({ provider }: { provider: ProviderInfo | undefined }) {
  if (!provider) {
    return <div className="bg-muted/30 border border-border rounded-xl p-4 animate-pulse h-[88px]" />;
  }
  const isNone = provider.type === "none";
  const isHealthy = provider.health.ok;
  const tone = isNone
    ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200"
    : isHealthy
      ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900 text-green-800 dark:text-green-200"
      : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-200";
  const Icon = isNone ? AlertTriangle : isHealthy ? Wifi : WifiOff;
  return (
    <div className={`border rounded-xl p-4 flex items-start gap-3 ${tone}`}>
      <Icon size={20} className="flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-sm">PACS Provider: {provider.displayName}</p>
          {provider.baseUrl && <code className="text-xs font-mono opacity-80 truncate">{provider.baseUrl}</code>}
        </div>
        <p className="text-xs mt-0.5 opacity-90">
          {isNone
            ? "Set ORTHANC_URL or CONQUEST_URL in your environment to connect a PACS server."
            : (provider.health.message ?? "")}
        </p>
        {!isNone && (
          <div className="flex flex-wrap gap-2 mt-2 text-[11px]">
            <Capability label="Study Archive" enabled={provider.capabilities.studyArchive} />
            <Capability label="Share Links" enabled={provider.capabilities.teleradiologyShare} />
            <Capability label="MWL Push" enabled={provider.capabilities.mwlPush} />
            <Capability label="DICOM Tags" enabled={provider.capabilities.instanceMetadata} />
          </div>
        )}
      </div>
    </div>
  );
}

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${
      enabled ? "bg-white/60 dark:bg-black/20" : "bg-white/30 dark:bg-black/10 opacity-60"
    }`}>
      {enabled ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
      {label}
    </span>
  );
}

export default function DicomNodes() {
  const [, navigate] = useLocation();
  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="DICOM Nodes" subtitle="Modality registry & automatic Q/R pull scheduler" />
      
      <div className="rounded-xl border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Info className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" size={18} />
          <div>
            <h4 className="font-semibold text-sm">These settings have moved!</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              To simplify configuration and avoid profile/IP mismatches, all PACS, DICOM, Modality, and AI settings are now consolidated in the unified Settings Center.
            </p>
          </div>
        </div>
        <Button variant="default" size="sm" onClick={() => navigate("/settings/radiology")} className="shrink-0">
          Go to Settings Center
        </Button>
      </div>

      <DicomNodesPanel />
    </div>
  );
}
