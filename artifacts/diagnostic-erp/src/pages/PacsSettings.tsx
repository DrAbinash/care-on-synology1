import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Save, RefreshCw, Trash2, Server, Settings2, Radio, Search, ScanLine, MonitorPlay, Network, ToggleLeft, ToggleRight, CheckCircle2, XCircle, Wifi, WifiOff, Copy, ExternalLink, Lock, Tv2, Info } from "lucide-react";
import { readStaffSession, FULL_ACCESS_ROLES, normalizeRole } from "@/lib/staffSession";
import { getOhifUrl, getWeasisUrl } from "@/lib/viewerService";

type Setting = { id: number; key: string; value: string | null; category: string; isSecret: boolean };
type Modality = {
  id: number; machineName: string; modality: string | null; aeTitle: string | null;
  ipAddress: string | null; port: number | null; location: string | null;
  autoSendEnabled: boolean; isActive: boolean;
  lastConnectionStatus: string | null; lastSeenAt: string | null;
};

const SETTING_CATEGORIES = ["general", "conquest", "mwl", "delivery", "notification"];
const MODALITY_CODES = ["MR", "CT", "CR", "DX", "US", "MG", "XA", "OT"];

// MWL settings stored in pacs_settings under category "mwl"
const MWL_FIELDS: Array<{
  key: string;
  label: string;
  placeholder: string;
  type?: string;
  isSelect?: boolean;
  options?: string[];
  hint?: string;
}> = [
  {
    key: "mwl_ae_title",
    label: "MWL AE Title",
    placeholder: "ERPMWL",
    hint: "DICOM Application Entity title for the MWL SCP (e.g. ERPMWL)",
  },
  {
    key: "mwl_port",
    label: "MWL Port",
    placeholder: "4242",
    type: "number",
    hint: "TCP port the MWL SCP listens on",
  },
  {
    key: "mwl_default_station_ae_title",
    label: "Default Station AE Title",
    placeholder: "STATION01",
    hint: "Scheduled station AE title pre-filled on new radiology orders",
  },
  {
    key: "mwl_default_modality",
    label: "Default Modality",
    placeholder: "MR",
    isSelect: true,
    options: ["MR", "CT", "DX", "CR", "US", "MG"],
    hint: "Default DICOM modality code for new radiology orders",
  },
  {
    key: "mwl_accession_prefix",
    label: "Auto Accession Number Prefix",
    placeholder: "ACC",
    hint: "Short prefix prepended to auto-generated accession numbers (e.g. ACC, DCH, RAD)",
  },
];

function SettingRow({ setting, onSave, onDelete }: {
  setting: Setting;
  onSave: (id: number, value: string) => void;
  onDelete: (id: number) => void;
}) {
  const [val, setVal] = useState(setting.value ?? "");
  const dirty = val !== (setting.value ?? "");
  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{setting.key}</p>
        <p className="text-xs text-muted-foreground">{setting.category}</p>
      </div>
      <Input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        type={setting.isSecret ? "password" : "text"}
        className="w-56 text-sm h-8"
        placeholder={setting.isSecret ? "••••••••" : "value"}
      />
      {dirty && (
        <Button size="sm" variant="default" className="h-8 px-2" onClick={() => onSave(setting.id, val)}>
          <Save size={12} />
        </Button>
      )}
      <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive" onClick={() => onDelete(setting.id)}>
        <Trash2 size={12} />
      </Button>
    </div>
  );
}

function ModalityCard({ m, onToggle, onDelete }: {
  m: Modality;
  onToggle: (id: number, field: "autoSendEnabled" | "isActive", val: boolean) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">{m.machineName}</p>
          <p className="text-xs text-muted-foreground">{m.location ?? "No location"}</p>
        </div>
        <div className="flex gap-1">
          <Badge variant={m.isActive ? "default" : "secondary"}>{m.isActive ? "Active" : "Inactive"}</Badge>
          <Badge variant="outline">{m.modality ?? "OT"}</Badge>
        </div>
      </div>
      <div className="text-xs text-muted-foreground space-y-0.5">
        <p>AE: <span className="font-mono">{m.aeTitle ?? "—"}</span> · IP: <span className="font-mono">{m.ipAddress ?? "—"}:{m.port ?? "—"}</span></p>
        {m.lastConnectionStatus && <p>Last: <span className={m.lastConnectionStatus === "ok" ? "text-green-600" : "text-red-600"}>{m.lastConnectionStatus}</span></p>}
      </div>
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onToggle(m.id, "isActive", !m.isActive)}>
          {m.isActive ? "Deactivate" : "Activate"}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onToggle(m.id, "autoSendEnabled", !m.autoSendEnabled)}>
          Auto-send: {m.autoSendEnabled ? "On" : "Off"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive ml-auto" onClick={() => onDelete(m.id)}>
          <Trash2 size={12} />
        </Button>
      </div>
    </div>
  );
}

// MWL Settings tab — dedicated form for the five MWL configuration keys.
// Values are persisted to pacs_settings under category "mwl".
function MwlSettingsTab({
  settings,
  onSave,
}: {
  settings: Setting[];
  onSave: (key: string, value: string) => void;
}) {
  // Build an editable state map from the current saved settings
  const savedMap: Record<string, string> = {};
  for (const s of settings.filter((s) => s.category === "mwl")) {
    savedMap[s.key] = s.value ?? "";
  }

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of MWL_FIELDS) init[f.key] = savedMap[f.key] ?? "";
    return init;
  });

  // Re-initialise when server data arrives (query refetch)
  // This is intentionally done via a key approach in the parent — see below.

  const dirty = MWL_FIELDS.some((f) => values[f.key] !== (savedMap[f.key] ?? ""));

  function handleSave() {
    for (const f of MWL_FIELDS) {
      const current = savedMap[f.key] ?? "";
      if (values[f.key] !== current) {
        onSave(f.key, values[f.key] ?? "");
      }
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Radio size={16} className="text-primary" />
          <h3 className="text-sm font-semibold">Modality Worklist (MWL) Settings</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Configure the DICOM Modality Worklist SCP so imaging machines (CT, MRI, X-Ray)
          can query scheduled studies directly from this ERP.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {MWL_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <label className="text-xs font-medium text-foreground">{f.label}</label>
              {f.isSelect ? (
                <select
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="w-full h-9 text-sm border rounded-md px-2 bg-background"
                >
                  <option value="">— use system default —</option>
                  {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <Input
                  type={f.type ?? "text"}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="h-9 text-sm"
                />
              )}
              {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-2">
          <Button size="sm" onClick={handleSave} disabled={!dirty} className="h-8">
            <Save size={13} className="mr-1" /> Save MWL Settings
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-muted/40 p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground text-sm">Mandatory DICOM fields before scanning</p>
        <p>A radiology order cannot move to <span className="font-mono bg-muted px-1 rounded">in_progress</span> (ready-for-scan) until all of these are filled on the study:</p>
        <ul className="list-disc ml-4 mt-1 space-y-0.5">
          <li>Study Description (DICOM 0008,1030)</li>
          <li>Body Part Examined (DICOM 0018,0015)</li>
          <li>Scheduled Station AE Title (DICOM 0040,0001)</li>
          <li>Referring Physician Name (DICOM 0008,0090)</li>
          <li>Modality must be one of: MR · CT · DX · CR · US · MG</li>
          <li>Patient sex, mobile number, and date of birth</li>
        </ul>
        <p className="mt-2">Internal MWL endpoint: <span className="font-mono bg-muted px-1 rounded">GET /api/internal/radiology/mwl-orders</span> (requires Bearer INTERNAL_API_KEY)</p>
        <p>MWL status update: <span className="font-mono bg-muted px-1 rounded">POST /api/internal/radiology/mwl-order-status</span></p>
        <p className="mt-1">Valid MWL statuses: SCHEDULED · ARRIVED · IN_PROGRESS · COMPLETED · CANCELLED</p>
      </div>
    </div>
  );
}

type DiagnosticTest = { id: number; name: string; code: string; category: string; isActive: boolean };

type MwlTestDefault = { bodyPart: string; stationAE: string };

function DicomMwlTestsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: tests = [], isLoading: testsLoading } = useQuery<DiagnosticTest[]>({
    queryKey: ["tests-all-dicom-mwl"],
    queryFn: () => api.get<{ tests: DiagnosticTest[] }>("/api/tests?limit=500").then((d) => d.tests ?? []),
  });

  const { data: settings, isLoading: settingsLoading } = useQuery<{ dicomMwlTestIds?: string; dicomMwlTestDefaults?: string }>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Per-test defaults: { "<id>": { bodyPart, stationAE } }
  const [defaults, setDefaults] = useState<Record<string, MwlTestDefault>>({});

  useEffect(() => {
    if (!settingsLoading && settings !== undefined) {
      try {
        const ids: number[] = JSON.parse(settings?.dicomMwlTestIds ?? "[]");
        setSelectedIds(new Set(ids));
      } catch { /* ignore */ }
      try {
        const d = JSON.parse(settings?.dicomMwlTestDefaults ?? "{}");
        setDefaults(typeof d === "object" && d !== null ? d : {});
      } catch { /* ignore */ }
    }
  }, [settings, settingsLoading]);

  const saveMut = useMutation({
    mutationFn: () =>
      api.put("/api/clinic-settings", {
        dicomMwlTestIds: JSON.stringify([...selectedIds]),
        dicomMwlTestDefaults: JSON.stringify(defaults),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clinic-settings"] });
      toast({ title: "DICOM MWL test list saved" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const toggleTest = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const setDefault = (id: number, field: keyof MwlTestDefault, value: string) => {
    setDefaults((prev) => {
      const existing: MwlTestDefault = prev[String(id)] ?? { bodyPart: "", stationAE: "" };
      return { ...prev, [String(id)]: { ...existing, [field]: value } };
    });
  };

  const activeTests = tests.filter((t) => t.isActive !== false);
  const filteredTests = activeTests.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
  });

  const byCategory: Record<string, DiagnosticTest[]> = {};
  for (const t of filteredTests) {
    if (!byCategory[t.category]) byCategory[t.category] = [];
    byCategory[t.category].push(t);
  }

  if (testsLoading || settingsLoading) {
    return <div className="rounded-xl border bg-card p-6 text-center text-muted-foreground text-sm animate-pulse">Loading tests…</div>;
  }

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <ScanLine size={15} className="text-blue-600" />
            DICOM MWL — Required Tests & Defaults
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tick each test that needs DICOM Worklist. Set a default Body Part and Station AE Title
            so Billing Desk auto-fills them — staff only need to type the Referring Doctor.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold text-blue-600">{selectedIds.size} selected</span>
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="h-8">
            {saveMut.isPending ? "Saving…" : <><Save size={12} className="mr-1" />Save</>}
          </Button>
        </div>
      </div>

      {/* Quick-select buttons */}
      <div className="flex gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground self-center">Quick select:</span>
        {["Radiology", "CT", "MRI", "X-Ray", "Ultrasound", "USG"].map((cat) => {
          const catTests = activeTests.filter((t) => t.category.toLowerCase().includes(cat.toLowerCase()) || t.name.toLowerCase().includes(cat.toLowerCase()));
          if (catTests.length === 0) return null;
          return (
            <Button key={cat} variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => setSelectedIds((prev) => { const next = new Set(prev); catTests.forEach((t) => next.add(t.id)); return next; })}
            >
              + {cat} ({catTests.length})
            </Button>
          );
        })}
        <Button variant="outline" size="sm" className="h-7 text-xs text-destructive"
          onClick={() => setSelectedIds(new Set())}>
          Clear all
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter tests by name, code or category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-8 text-sm"
        />
      </div>

      {/* Test list grouped by category */}
      <div className="max-h-[480px] overflow-y-auto space-y-3 pr-1">
        {Object.keys(byCategory).length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No tests match the filter.</p>
        )}
        {Object.entries(byCategory).map(([cat, catTests]) => (
          <div key={cat}>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{cat}</p>
            <div className="space-y-1.5">
              {catTests.map((t) => {
                const checked = selectedIds.has(t.id);
                const def = defaults[String(t.id)] ?? { bodyPart: "", stationAE: "" };
                return (
                  <div
                    key={t.id}
                    className={`rounded-md border transition-colors ${checked ? "border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800" : "border-transparent hover:bg-muted/50"}`}
                  >
                    {/* Checkbox row */}
                    <label className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer text-sm">
                      <input type="checkbox" checked={checked} onChange={() => toggleTest(t.id)} className="accent-blue-600 shrink-0" />
                      <span className="flex-1 font-medium">{t.name}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{t.code}</span>
                    </label>
                    {/* Defaults row — only visible when checked */}
                    {checked && (
                      <div className="px-3 pb-2 grid grid-cols-2 gap-2">
                        <div className="space-y-0.5">
                          <p className="text-[10px] text-muted-foreground font-medium">Default Body Part</p>
                          <Input
                            value={def.bodyPart}
                            onChange={(e) => setDefault(t.id, "bodyPart", e.target.value.toUpperCase())}
                            placeholder="e.g. BRAIN"
                            className="h-7 text-xs font-mono"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[10px] text-muted-foreground font-medium">Default Station AE Title</p>
                          <Input
                            value={def.stationAE}
                            onChange={(e) => setDefault(t.id, "stationAE", e.target.value.toUpperCase())}
                            placeholder="e.g. MRI_ROOM1"
                            className="h-7 text-xs font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {saveMut.isSuccess && (
        <p className="text-xs text-green-600 font-medium">✓ Settings saved successfully.</p>
      )}
    </div>
  );
}

export default function PacsSettings() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<"settings" | "modalities" | "mwl" | "viewer" | "routing" | "tests">(
    "settings"
  );
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [newCat, setNewCat] = useState("general");
  const [newSecret, setNewSecret] = useState(false);

  const [newMachineName, setNewMachineName] = useState("");
  const [newModCode, setNewModCode] = useState("MR");
  const [newAeTitle, setNewAeTitle] = useState("");
  const [newIp, setNewIp] = useState("");
  const [newPort, setNewPort] = useState("");
  const [newLocation, setNewLocation] = useState("");

  const { data: settings = [], refetch: refetchSettings, isFetching: fetchingSettings } = useQuery<Setting[]>({
    queryKey: ["pacs-settings"],
    queryFn: () => api.get("/api/radiology/pacs-settings"),
  });

  const { data: modalities = [], refetch: refetchModalities, isFetching: fetchingModalities } = useQuery<Modality[]>({
    queryKey: ["pacs-modalities"],
    queryFn: () => api.get("/api/radiology/modalities"),
  });

  const upsertSetting = useMutation({
    mutationFn: (body: object) => api.post("/api/radiology/pacs-settings", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pacs-settings"] }); toast({ title: "Setting saved" }); },
    onError: () => toast({ title: "Failed to save setting", variant: "destructive" }),
  });

  const deleteSetting = useMutation({
    mutationFn: (id: number) => api.delete(`/api/radiology/pacs-settings/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pacs-settings"] }); toast({ title: "Setting deleted" }); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const upsertModality = useMutation({
    mutationFn: (body: object) => api.post("/api/radiology/modalities", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pacs-modalities"] }); toast({ title: "Modality saved" }); },
    onError: () => toast({ title: "Failed to save modality", variant: "destructive" }),
  });

  const deleteModality = useMutation({
    mutationFn: (id: number) => api.delete(`/api/radiology/modalities/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pacs-modalities"] }); toast({ title: "Modality deleted" }); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const grouped = settings.reduce<Record<string, Setting[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  // Save a single MWL key via the generic pacs-settings upsert endpoint.
  function saveMwlKey(key: string, value: string) {
    const existing = settings.find((s) => s.key === key);
    upsertSetting.mutate({
      ...(existing ? { id: existing.id } : {}),
      key,
      value,
      category: "mwl",
      isSecret: false,
    });
  }

  // Save a single viewer setting key
  function saveViewerKey(key: string, value: string) {
    const existing = settings.find((s) => s.key === key && s.category === "viewer");
    upsertSetting.mutate({
      ...(existing ? { id: existing.id } : {}),
      key,
      value,
      category: "viewer",
      isSecret: false,
    });
  }

  // Viewer settings form state
  const viewerMap: Record<string, string> = {};
  for (const s of settings) if (s.category === "viewer") viewerMap[s.key] = s.value ?? "";

  const isAdmin = FULL_ACCESS_ROLES.has(normalizeRole(readStaffSession()?.user.role ?? ""));

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="PACS / DICOM Settings"
        subtitle="Configure Conquest PACS, imaging devices, and Modality Worklist (MWL)"
        actions={
          <Button variant="outline" size="sm" onClick={() => { refetchSettings(); refetchModalities(); }} disabled={fetchingSettings || fetchingModalities}>
            <RefreshCw size={14} className={fetchingSettings || fetchingModalities ? "animate-spin" : ""} />
            Refresh
          </Button>
        }
      />

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

      {/* Tab bar */}
      <div className="flex flex-wrap gap-2 border-b">
        {([
          { key: "settings",   icon: <Settings2  size={14} className="inline mr-1" />, label: "Settings" },
          { key: "modalities", icon: <Server     size={14} className="inline mr-1" />, label: "Modalities" },
          { key: "mwl",        icon: <Radio      size={14} className="inline mr-1" />, label: "Worklist (MWL)" },
          { key: "viewer",     icon: <MonitorPlay size={14} className="inline mr-1" />, label: "Viewer Settings" },
          { key: "routing",    icon: <Network    size={14} className="inline mr-1" />, label: "Routing Rules" },
          { key: "tests",      icon: <Wifi       size={14} className="inline mr-1" />, label: "Connection Tests" },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {activeTab === "settings" && (
        <div className="space-y-6">
          {/* Add new setting */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold">Add / Update Setting</h3>
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Key (e.g. conquest_host)" value={newKey} onChange={(e) => setNewKey(e.target.value)} className="w-48 h-8 text-sm" />
              <Input placeholder="Value" value={newVal} onChange={(e) => setNewVal(e.target.value)} className="w-48 h-8 text-sm" />
              <select value={newCat} onChange={(e) => setNewCat(e.target.value)} className="h-8 text-sm border rounded-md px-2 bg-background">
                {SETTING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={newSecret} onChange={(e) => setNewSecret(e.target.checked)} />
                Secret
              </label>
              <Button size="sm" className="h-8" onClick={() => {
                if (!newKey.trim()) return;
                upsertSetting.mutate({ key: newKey.trim(), value: newVal, category: newCat, isSecret: newSecret });
                setNewKey(""); setNewVal("");
              }}>
                <Plus size={13} />Add
              </Button>
            </div>
          </div>

          {/* Existing settings */}
          {Object.entries(grouped).length === 0 ? (
            <p className="text-sm text-muted-foreground">No settings configured yet.</p>
          ) : (
            Object.entries(grouped).map(([cat, rows]) => (
              <div key={cat} className="rounded-xl border bg-card p-4">
                <h3 className="text-sm font-semibold mb-3 capitalize">{cat}</h3>
                {rows.map((s) => (
                  <SettingRow
                    key={s.id}
                    setting={s}
                    onSave={(id, value) => upsertSetting.mutate({ id, key: s.key, value, category: s.category, isSecret: s.isSecret })}
                    onDelete={(id) => deleteSetting.mutate(id)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "modalities" && (
        <div className="space-y-6">
          {/* Link to full modality management page */}
          <div className="rounded-xl border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">Full Modality Management</p>
              <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
                Configure polling, C-FIND/C-MOVE, destination PACS, and test connectivity for each imaging device.
              </p>
            </div>
            <a href="/erp/radiology/modality-management" className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 transition-colors">
              Open →
            </a>
          </div>

          {/* Add new modality (quick-add) */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold">Quick-Add Imaging Device</h3>
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Machine name" value={newMachineName} onChange={(e) => setNewMachineName(e.target.value)} className="w-40 h-8 text-sm" />
              <select value={newModCode} onChange={(e) => setNewModCode(e.target.value)} className="h-8 text-sm border rounded-md px-2 bg-background">
                {MODALITY_CODES.map((m) => <option key={m}>{m}</option>)}
              </select>
              <Input placeholder="AE Title" value={newAeTitle} onChange={(e) => setNewAeTitle(e.target.value)} className="w-32 h-8 text-sm" />
              <Input placeholder="IP Address" value={newIp} onChange={(e) => setNewIp(e.target.value)} className="w-36 h-8 text-sm" />
              <Input placeholder="Port" value={newPort} onChange={(e) => setNewPort(e.target.value)} className="w-20 h-8 text-sm" type="number" />
              <Input placeholder="Location (Room/Ward)" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} className="w-36 h-8 text-sm" />
              <Button size="sm" className="h-8" onClick={() => {
                if (!newMachineName.trim()) return;
                upsertModality.mutate({
                  machineName: newMachineName.trim(), modality: newModCode,
                  aeTitle: newAeTitle || null, ipAddress: newIp || null,
                  port: newPort ? Number(newPort) : null, location: newLocation || null,
                });
                setNewMachineName(""); setNewAeTitle(""); setNewIp(""); setNewPort(""); setNewLocation("");
              }}>
                <Plus size={13} />Add
              </Button>
            </div>
          </div>

          {/* Modality cards */}
          {modalities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No imaging devices configured.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {modalities.map((m) => (
                <ModalityCard
                  key={m.id}
                  m={m}
                  onToggle={(id, field, val) => upsertModality.mutate({ id, [field]: val })}
                  onDelete={(id) => deleteModality.mutate(id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "mwl" && (
        <div className="space-y-6">
          <MwlSettingsTab
            key={settings.length}
            settings={settings}
            onSave={saveMwlKey}
          />
          <DicomMwlTestsTab />
        </div>
      )}

      {/* ── Viewer Settings Tab ── */}
      {activeTab === "viewer" && (
        <div className="space-y-6">
          {/* Admin restriction notice */}
          {!isAdmin && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 flex items-center gap-3 text-sm">
              <Lock size={14} className="text-amber-600 shrink-0" />
              <span className="text-amber-800 dark:text-amber-300">
                PACS viewer settings are <strong>read-only</strong> for your role. Ask an admin to update URL configuration.
              </span>
            </div>
          )}

          {/* Load Defaults + Verification Panel */}
          <div className="rounded-xl border bg-card p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Viewer Settings Status</h3>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs"
                  onClick={() => {
                    api.post("/api/radiology/pacs-settings/load-defaults", {})
                      .then(() => {
                        qc.invalidateQueries({ queryKey: ["pacs-settings"] });
                        toast({ title: "Loaded 12 default viewer settings" });
                      })
                      .catch(() => toast({ title: "Failed to load defaults", variant: "destructive" }));
                  }}
                >
                  <Plus size={13} className="mr-1" />Load Clinic Viewer Defaults
                </Button>
              )}
            </div>
            <ViewerSettingsVerificationPanel viewerMap={viewerMap} />
          </div>

          {/* Viewer Mode */}
          <div className="rounded-xl border bg-card p-5 space-y-5">
            <h3 className="font-semibold text-sm">Viewer Mode</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ViewerField label="Viewer Mode" description="Which viewer buttons to show" type="select"
                options={["WEASIS", "OHIF", "BOTH"]} value={viewerMap["viewer_mode"] ?? "BOTH"}
                onSave={(v) => saveViewerKey("viewer_mode", v)} disabled={!isAdmin} />
              <ViewerField label="Default Viewer" description="Primary viewer button" type="select"
                options={["OHIF", "WEASIS"]} value={viewerMap["default_viewer"] ?? "OHIF"}
                onSave={(v) => saveViewerKey("default_viewer", v)} disabled={!isAdmin} />
              <ViewerField label="OHIF Enabled" type="select" options={["true", "false"]}
                value={viewerMap["ohif_enabled"] ?? "true"} onSave={(v) => saveViewerKey("ohif_enabled", v)} disabled={!isAdmin} />
              <ViewerField label="Weasis Enabled" type="select" options={["true", "false"]}
                value={viewerMap["weasis_enabled"] ?? "true"} onSave={(v) => saveViewerKey("weasis_enabled", v)} disabled={!isAdmin} />
              <ViewerField label="Viewer Open Mode" type="select" options={["NEW_TAB", "SAME_TAB", "EMBEDDED"]}
                value={viewerMap["viewer_open_mode"] ?? "NEW_TAB"} onSave={(v) => saveViewerKey("viewer_open_mode", v)} disabled={!isAdmin} />
              <ViewerField label="Allow Public Viewer Links" description="False by default (requires login)" type="select"
                options={["false", "true"]} value={viewerMap["allow_public_viewer_links"] ?? "false"}
                onSave={(v) => saveViewerKey("allow_public_viewer_links", v)} disabled={!isAdmin} />
            </div>
          </div>

          {/* PACS Server */}
          <div className="rounded-xl border bg-card p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">PACS Server</h3>
              {isAdmin && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => {
                  saveViewerKey("pacs_ip", "172.16.1.139");
                  saveViewerKey("pacs_port", "5680");
                  saveViewerKey("pacs_ae_title", "ORTHANC2");
                }}>Load Defaults</Button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <ViewerField label="PACS IP" description="Server IP address" type="text"
                value={viewerMap["pacs_ip"] ?? ""} onSave={(v) => saveViewerKey("pacs_ip", v)}
                placeholder="172.16.1.139" disabled={!isAdmin} />
              <ViewerField label="PACS Port" description="DICOM listener port" type="text"
                value={viewerMap["pacs_port"] ?? ""} onSave={(v) => saveViewerKey("pacs_port", v)}
                placeholder="5680" disabled={!isAdmin} />
              <ViewerField label="PACS AE Title" description="Application Entity Title" type="text"
                value={viewerMap["pacs_ae_title"] ?? ""} onSave={(v) => saveViewerKey("pacs_ae_title", v)}
                placeholder="ORTHANC2" disabled={!isAdmin} />
            </div>
          </div>

          {/* OHIF Viewer */}
          <div className="rounded-xl border bg-card p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm flex items-center gap-2"><MonitorPlay size={14} />OHIF Viewer</h3>
              {isAdmin && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => {
                  saveViewerKey("ohif_base_url", "http://192.168.1.137:3010");
                  saveViewerKey("dicom_web_base_url", "http://192.168.1.137:3010/dicom-web");
                  saveViewerKey("ohif_study_url_template", "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}");
                }}>Load Defaults</Button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ViewerField label="OHIF Base URL (LAN)" description="e.g. http://172.16.1.139:3000" type="text"
                value={viewerMap["ohif_base_url"] ?? ""} onSave={(v) => saveViewerKey("ohif_base_url", v)}
                placeholder="http://172.16.1.139:3000" disabled={!isAdmin} />
              <ViewerField label="OHIF Base URL (Tailscale)" description="Used automatically when Tailscale network mode is active. e.g. http://100.65.255.115:3000" type="text"
                value={viewerMap["ohif_base_url_tailscale"] ?? ""} onSave={(v) => saveViewerKey("ohif_base_url_tailscale", v)}
                placeholder="http://100.65.255.115:3000" disabled={!isAdmin} />
              <ViewerField label="DICOMweb Base URL" description="e.g. http://172.16.1.139:3000/dicom-web" type="text"
                value={viewerMap["dicom_web_base_url"] ?? ""} onSave={(v) => saveViewerKey("dicom_web_base_url", v)}
                placeholder="http://172.16.1.139:3000/dicom-web" disabled={!isAdmin} />
            </div>
            <ViewerTemplateField
              label="OHIF Study URL Template"
              description="Use {OHIF_BASE_URL} and {studyInstanceUID} as placeholders. Preview shows a test UID substituted in."
              value={viewerMap["ohif_study_url_template"] ?? ""}
              defaultValue="{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}"
              previewFn={(tpl) =>
                tpl
                  .replace(/\{OHIF_BASE_URL\}/g, (viewerMap["ohif_base_url"] ?? "http://192.168.1.137:3010").replace(/\/$/, ""))
                  .replace(/\{studyInstanceUID\}/g, "1.2.3.4.5.TEST")
              }
              onSave={(v) => saveViewerKey("ohif_study_url_template", v)}
              disabled={!isAdmin}
              openable
            />
          </div>

          {/* Weasis / WADO */}
          <div className="rounded-xl border bg-card p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm flex items-center gap-2"><Tv2 size={14} />Weasis / WADO</h3>
              {isAdmin && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => {
                  saveViewerKey("wado_uri_base_url", "http://172.16.1.139:8042/wado");
                  saveViewerKey("conquest_base_url", "");
                  saveViewerKey("weasis_manifest_url_template", 'weasis://$dicom:get -w "http://172.16.1.139:8042/wado?requestType=WADO&studyUID={studyInstanceUID}&contentType=application/dicom"');
                }}>Load Defaults</Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Uses the same LAN/Tailscale host swap as OHIF (configured above). Whichever IP appears in the
              template below is automatically replaced with the Tailscale IP when Tailscale mode is active.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ViewerField label="WADO-URI Base URL" description="Primary WADO endpoint for Weasis" type="text"
                value={viewerMap["wado_uri_base_url"] ?? ""} onSave={(v) => saveViewerKey("wado_uri_base_url", v)}
                placeholder="http://172.16.1.139:8042/wado" disabled={!isAdmin} />
              <ViewerField label="Conquest Base URL" description="Not used — leave blank (system uses Orthanc)" type="text"
                value={viewerMap["conquest_base_url"] ?? ""} onSave={(v) => saveViewerKey("conquest_base_url", v)}
                placeholder="Not used" disabled={!isAdmin} />
            </div>
            <ViewerTemplateField
              label="Weasis Manifest URL Template"
              description="Use {studyInstanceUID} as placeholder. This is a weasis:// URI — clicking Test attempts to launch Weasis."
              value={viewerMap["weasis_manifest_url_template"] ?? ""}
              defaultValue={'weasis://$dicom:get -w "http://172.16.1.139:8042/wado?requestType=WADO&studyUID={studyInstanceUID}&contentType=application/dicom"'}
              previewFn={(tpl) => tpl.replace(/\{studyInstanceUID\}/g, "1.2.3.4.5.TEST")}
              onSave={(v) => saveViewerKey("weasis_manifest_url_template", v)}
              disabled={!isAdmin}
              openable={false}
            />
          </div>
        </div>
      )}

      {/* ── Routing Rules Tab ── */}
      {activeTab === "routing" && (
        <RoutingRulesTab />
      )}

      {/* ── Connection Tests Tab ── */}
      {activeTab === "tests" && (
        <ConnectionTestsTab viewerMap={viewerMap} modalities={modalities} />
      )}
    </div>
  );
}

// ─── ViewerField component ────────────────────────────────────────────────────

function ViewerField({
  label, description, type, value, onSave, options, placeholder, disabled,
}: {
  label: string;
  description?: string;
  type: "text" | "select";
  value: string;
  onSave: (v: string) => void;
  options?: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [val, setVal] = useState(value);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setVal(value); }, [value]);

  const dirty = val !== value;

  function save() {
    onSave(val);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
      <div className="flex gap-2">
        {type === "select" && options ? (
          <select
            value={val}
            onChange={(e) => { if (!disabled) setVal(e.target.value); }}
            disabled={disabled}
            className="flex-1 h-8 text-sm border rounded-md px-2 bg-background disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {options.map((o) => <option key={o}>{o}</option>)}
          </select>
        ) : (
          <Input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className="flex-1 h-8 text-sm"
          />
        )}
        {!disabled && (
          <Button
            size="sm"
            className="h-8 px-2"
            variant={saved ? "outline" : dirty ? "default" : "outline"}
            onClick={save}
          >
            {saved ? "✓" : <Save size={12} />}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── ViewerTemplateField component ───────────────────────────────────────────

function ViewerTemplateField({
  label, description, value, defaultValue, previewFn, onSave, disabled, openable = false,
}: {
  label: string;
  description?: string;
  value: string;
  defaultValue: string;
  previewFn: (v: string) => string;
  onSave: (v: string) => void;
  disabled?: boolean;
  openable?: boolean;
}) {
  const { toast } = useToast();
  const effective = value || defaultValue;
  const [val, setVal] = useState(effective);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setVal(value || defaultValue); }, [value, defaultValue]);

  const dirty = val !== effective;
  const preview = (() => { try { return previewFn(val); } catch { return val; } })();

  function save() {
    onSave(val);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
      <div className="flex gap-2">
        <Input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="flex-1 h-8 text-xs font-mono"
          disabled={disabled}
        />
        {!disabled && (
          <Button size="sm" className="h-8 px-2 shrink-0"
            variant={saved ? "outline" : dirty ? "default" : "outline"}
            onClick={save}
          >
            {saved ? "✓" : <Save size={12} />}
          </Button>
        )}
      </div>
      {preview && (
        <div className="flex items-center gap-1.5 rounded-md bg-muted/40 border px-3 py-1.5">
          <code className="flex-1 text-[10px] font-mono text-muted-foreground truncate" title={preview}>{preview}</code>
          <button
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
            title="Copy generated URL"
            onClick={() => { void navigator.clipboard.writeText(preview); toast({ title: "Copied to clipboard" }); }}
          >
            <Copy size={11} />
          </button>
          {openable && (
            <button
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
              title="Test: open in new tab"
              onClick={() => window.open(preview, "_blank")}
            >
              <ExternalLink size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ConnectionTestsTab component ────────────────────────────────────────────

type EchoResult = { status: "idle" | "testing" | "ok" | "fail"; message?: string };

type PacsHealth = {
  pendingRetries: number;
  totalActiveModalities: number;
  healthyModalities: number;
  pulledToday: Record<string, number>;
};

function ViewerSettingsVerificationPanel({
  viewerMap,
}: {
  viewerMap: Record<string, string>;
}) {
  const REQUIRED_KEYS = [
    { key: "ohif_base_url", label: "OHIF Base URL" },
    { key: "dicom_web_base_url", label: "DICOMweb Base URL" },
    { key: "ohif_study_url_template", label: "OHIF Study URL Template" },
    { key: "wado_uri_base_url", label: "WADO-URI Base URL" },
    { key: "weasis_manifest_url_template", label: "Weasis Manifest Template" },
    { key: "pacs_ip", label: "PACS IP" },
    { key: "pacs_port", label: "PACS Port" },
    { key: "pacs_ae_title", label: "PACS AE Title" },
    { key: "viewer_mode", label: "Viewer Mode" },
    { key: "default_viewer", label: "Default Viewer" },
    { key: "ohif_enabled", label: "OHIF Enabled" },
    { key: "weasis_enabled", label: "Weasis Enabled" },
  ];

  const configured = REQUIRED_KEYS.filter((k) => (viewerMap[k.key] ?? "").trim().length > 0);
  const missing = REQUIRED_KEYS.filter((k) => (viewerMap[k.key] ?? "").trim().length === 0);

  const sampleUID = "1.2.3.4.5.TEST";
  const ohifBase = (viewerMap["ohif_base_url"] ?? "").replace(/\/$/, "");
  const ohifPreview = ohifBase
    ? (viewerMap["ohif_study_url_template"] ?? "").replace(/\{OHIF_BASE_URL\}/g, ohifBase).replace(/\{studyInstanceUID\}/g, sampleUID)
    : null;
  const weasisPreview = viewerMap["weasis_manifest_url_template"]
    ? (viewerMap["weasis_manifest_url_template"] ?? "").replace(/\{studyInstanceUID\}/g, sampleUID)
    : null;

  const handleTestViewer = (viewerType: "OHIF" | "WEASIS") => {
    const url = viewerType === "OHIF"
      ? getOhifUrl(sampleUID, viewerMap)
      : getWeasisUrl(sampleUID, viewerMap);
    const openMode = viewerMap["viewer_open_mode"] || "NEW_TAB";
    if (openMode === "SAME_TAB") {
      window.open(url, "_self");
    } else {
      window.open(url, "_blank");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm flex-wrap gap-2">
        <span className={`font-semibold ${configured.length === REQUIRED_KEYS.length ? "text-green-600" : "text-amber-600"}`}>
          {configured.length} / {REQUIRED_KEYS.length} configured
        </span>
        {missing.length > 0 && (
          <span className="text-xs text-muted-foreground">Missing: {missing.map((m) => m.label).join(", ")}</span>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleTestViewer("OHIF")}>
            Test OHIF
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleTestViewer("WEASIS")}>
            Test Weasis
          </Button>
        </div>
      </div>
      {(configured.length === REQUIRED_KEYS.length) && (
        <div className="rounded-lg border bg-green-50 dark:bg-green-950/20 p-3 space-y-2 text-sm">
          <p className="font-semibold text-green-800 dark:text-green-200">All viewer settings are configured.</p>
          {ohifPreview && (
            <p className="text-xs text-muted-foreground font-mono truncate" title={ohifPreview}>OHIF sample: {ohifPreview}</p>
          )}
          {weasisPreview && (
            <p className="text-xs text-muted-foreground font-mono truncate" title={weasisPreview}>Weasis sample: {weasisPreview}</p>
          )}
        </div>
      )}
      {missing.length > 0 && (
        <div className="rounded-lg border bg-red-50 dark:bg-red-950/20 p-3 space-y-2 text-sm">
          <p className="font-semibold text-red-800 dark:text-red-200">Missing viewer settings</p>
          <ul className="text-xs text-red-700 dark:text-red-400 list-disc list-inside">
            {missing.map((m) => (
              <li key={m.key}>{m.label}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Click <strong>Load Clinic Viewer Defaults</strong> above to populate all 12 required settings.
          </p>
        </div>
      )}
    </div>
  );
}

function ConnectionTestsTab({
  viewerMap,
  modalities,
}: {
  viewerMap: Record<string, string>;
  modalities: Modality[];
}) {
  const { toast } = useToast();
  const [echoResults, setEchoResults] = useState<Record<number, EchoResult>>({});

  const { data: health, refetch: refetchHealth, isFetching: healthFetching } = useQuery<PacsHealth>({
    queryKey: ["pacs-health-settings"],
    queryFn: () => api.get("/api/radiology/pacs-dashboard-ext"),
  });

  async function runEcho(id: number) {
    setEchoResults((prev) => ({ ...prev, [id]: { status: "testing" } }));
    try {
      const res = await api.post<{ ok: boolean; latencyMs?: number; error?: string }>(
        `/api/radiology/modalities/${id}/echo-test`,
        {},
      );
      const ok = res.ok !== false;
      const modality = modalities.find((m) => m.id === id);
      const ip = modality?.ipAddress ?? "";
      const isPrivateIp = /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/.test(ip);
      const errorMsg = res.error ?? "C-ECHO failed";
      const friendlyMsg = !ok && isPrivateIp && errorMsg.includes("blocked")
        ? `${errorMsg} — The ERP server is cloud-hosted and cannot reach your clinic's LAN. This is expected. The viewer URLs will still work when opened on a PC inside the clinic.`
        : errorMsg;
      setEchoResults((prev) => ({
        ...prev,
        [id]: {
          status: ok ? "ok" : "fail",
          message: ok
            ? (res.latencyMs !== undefined ? `${res.latencyMs} ms` : "Reachable")
            : friendlyMsg,
        },
      }));
      if (ok) toast({ title: "C-ECHO OK" });
      else toast({ title: "C-ECHO failed", variant: "destructive" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Network error";
      setEchoResults((prev) => ({ ...prev, [id]: { status: "fail", message: msg } }));
      toast({ title: "C-ECHO error", description: msg, variant: "destructive" });
    }
  }

  const VIEWER_URL_KEYS = [
    { key: "ohif_base_url",          label: "OHIF Base URL",        desc: "Required for OHIF viewer" },
    { key: "wado_base_url",          label: "WADO Base URL",        desc: "Required for Weasis" },
    { key: "dicom_web_base_url",     label: "DICOMweb Base URL",    desc: "Passed to OHIF as data source" },
    { key: "orthanc_base_url",       label: "Orthanc Base URL",     desc: "Orthanc REST API" },
    { key: "conquest_wado_base_url", label: "Conquest WADO URL",    desc: "Conquest WADO endpoint (if used)" },
  ];

  const failedQueue = health?.pendingRetries ?? 0;
  const healthyMods = health?.healthyModalities ?? 0;
  const totalMods   = health?.totalActiveModalities ?? 0;

  return (
    <div className="space-y-6">
      {/* ── Health Summary ── */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Wifi size={15} /> Overall Status
          </h3>
          <button
            onClick={() => void refetchHealth()}
            disabled={healthFetching}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <RefreshCw size={11} className={healthFetching ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border bg-background p-3 text-center">
            <p className={`text-2xl font-bold ${totalMods > 0 && healthyMods === totalMods ? "text-green-600" : "text-amber-600"}`}>
              {healthyMods}/{totalMods}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mt-0.5">Modalities OK</p>
          </div>
          <div className="rounded-lg border bg-background p-3 text-center">
            <p className={`text-2xl font-bold ${failedQueue === 0 ? "text-green-600" : "text-red-600"}`}>{failedQueue}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mt-0.5">Failed Queue</p>
          </div>
          <div className="rounded-lg border bg-background p-3 text-center">
            <p className="text-2xl font-bold text-purple-600">{health?.pulledToday?.PULLED ?? 0}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mt-0.5">Pulled Today</p>
          </div>
        </div>
      </div>

      {/* ── Viewer URL Configuration Status ── */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ScanLine size={15} /> Viewer URL Configuration
        </h3>
        <p className="text-xs text-muted-foreground">
          These URLs must be configured in <strong>Viewer Settings</strong> for OHIF and Weasis to work.
          Green = configured, Red = missing.
        </p>
        <div className="space-y-2">
          {VIEWER_URL_KEYS.map(({ key, label, desc }) => {
            const val = viewerMap[key] ?? "";
            const ok  = val.trim().length > 0;
            return (
              <div key={key} className={`flex items-center gap-3 rounded-lg border p-3 ${ok ? "border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800" : "border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800"}`}>
                {ok ? (
                  <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                ) : (
                  <XCircle size={16} className="text-red-500 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold">{label}</p>
                  <p className="text-[10px] text-muted-foreground">{desc}</p>
                  {ok && <p className="text-[10px] font-mono text-muted-foreground truncate mt-0.5">{val}</p>}
                </div>
                {!ok && (
                  <span className="text-[10px] text-red-600 font-semibold shrink-0">NOT SET</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Modality C-ECHO Tests ── */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Server size={15} /> Modality C-ECHO Tests
        </h3>
        <p className="text-xs text-muted-foreground">
          A C-ECHO verifies that this ERP can reach the imaging device (MRI, CT, X-Ray) over the network.
          Green = reachable. Red = unreachable or misconfigured.
        </p>
        {modalities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No modalities configured. Add them in the <strong>Modalities</strong> tab.</p>
        ) : (
          <div className="space-y-2">
            {modalities.map((m) => {
              const r = echoResults[m.id] ?? { status: "idle" };
              return (
                <div key={m.id} className="flex items-center gap-3 rounded-lg border bg-background p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold">{m.machineName}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      AE: {m.aeTitle ?? "—"} · {m.ipAddress ?? "—"}:{m.port ?? "—"} · {m.modality ?? "OT"}
                    </p>
                    {r.status !== "idle" && r.message && (
                      <p className={`text-[10px] font-medium mt-0.5 ${r.status === "ok" ? "text-green-600" : "text-red-600"}`}>
                        {r.message}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.status === "ok"   && <CheckCircle2 size={16} className="text-green-600" />}
                    {r.status === "fail" && <XCircle      size={16} className="text-red-500" />}
                    {r.status === "idle" && <WifiOff      size={16} className="text-gray-400" />}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={r.status === "testing"}
                      onClick={() => void runEcho(m.id)}
                    >
                      {r.status === "testing" ? (
                        <><RefreshCw size={11} className="animate-spin mr-1" /> Testing…</>
                      ) : (
                        <>C-ECHO</>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Network Requirements ── */}
      <div className="rounded-xl border bg-muted/30 p-5 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Network size={15} /> Network Requirements
        </h3>
        <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
          <li>DICOM port <strong>104</strong> (or configured port) must be open on each modality.</li>
          <li>Orthanc/Conquest PACS: ports <strong>4242</strong> (DICOM) and <strong>8042</strong> (HTTP) by default.</li>
          <li>OHIF Viewer: port <strong>3000</strong> by default (or as configured in OHIF Base URL).</li>
          <li>The ERP server's AE Title must be registered as a known DICOM node on each modality.</li>
          <li>Windows Pull Agent must be on the same LAN segment as the modalities, with DCMTK installed.</li>
          <li>Firewall rules should permit DICOM traffic between this server, modalities, and PACS.</li>
        </ul>
      </div>
    </div>
  );
}

// ─── RoutingRulesTab component ────────────────────────────────────────────────

interface RoutingRule {
  id: number;
  name: string;
  modalityType: string | null;
  sourceAeTitle: string | null;
  destinationPacs: string;
  destinationAeTitle: string | null;
  destinationIp: string | null;
  destinationPort: number | null;
  autoPush: boolean;
  priority: number;
  isEnabled: boolean;
  notes: string | null;
}

function RoutingRulesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: rules = [], isLoading } = useQuery<RoutingRule[]>({
    queryKey: ["routing-rules"],
    queryFn: () => api.get("/api/radiology/routing-rules"),
  });

  const saveMutation = useMutation({
    mutationFn: (body: object) => api.post("/api/radiology/routing-rules", body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["routing-rules"] }); toast({ title: "Rule saved" }); },
    onError: () => toast({ title: "Failed to save rule", variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) => api.patch(`/api/radiology/routing-rules/${id}/toggle`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["routing-rules"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/radiology/routing-rules/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["routing-rules"] }); toast({ title: "Rule deleted" }); },
  });

  const [name, setName] = useState("");
  const [modality, setModality] = useState("*");
  const [destPacs, setDestPacs] = useState("CONQUEST");
  const [destAe, setDestAe] = useState("");
  const [destIp, setDestIp] = useState("");
  const [destPort, setDestPort] = useState("104");

  function addRule() {
    if (!name.trim()) return;
    saveMutation.mutate({
      name: name.trim(),
      modalityType: modality === "*" ? null : modality,
      destinationPacs: destPacs,
      destinationAeTitle: destAe || null,
      destinationIp: destIp || null,
      destinationPort: destPort ? Number(destPort) : null,
      autoPush: true,
      isEnabled: true,
    });
    setName(""); setDestAe(""); setDestIp(""); setDestPort("104");
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-blue-50 dark:bg-blue-950/20 p-4 text-sm text-blue-800 dark:text-blue-300">
        <p className="font-semibold mb-1">What are routing rules?</p>
        <p className="text-xs text-blue-700 dark:text-blue-400">
          Routing rules tell the pull agent where to forward studies after retrieval.
          Example: all MR studies → ORTHANC2, all CT studies → CONQUEST_ARCHIVE.
          Rules are matched by modality type and source AE title in priority order.
        </p>
      </div>

      {/* Add new rule */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold">Add Routing Rule</h3>
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Rule name (e.g. MRI → Orthanc)" value={name} onChange={(e) => setName(e.target.value)} className="w-52 h-8 text-sm" />
          <select value={modality} onChange={(e) => setModality(e.target.value)} className="h-8 text-sm border rounded-md px-2 bg-background">
            {["*", "MR", "CT", "CR", "DX", "US", "NM", "PT", "MG"].map((m) => (
              <option key={m} value={m}>{m === "*" ? "All modalities" : m}</option>
            ))}
          </select>
          <select value={destPacs} onChange={(e) => setDestPacs(e.target.value)} className="h-8 text-sm border rounded-md px-2 bg-background">
            <option>CONQUEST</option>
            <option>ORTHANC</option>
            <option>CUSTOM</option>
          </select>
          <Input placeholder="Dest AE Title" value={destAe} onChange={(e) => setDestAe(e.target.value)} className="w-28 h-8 text-sm" />
          <Input placeholder="Dest IP" value={destIp} onChange={(e) => setDestIp(e.target.value)} className="w-32 h-8 text-sm" />
          <Input placeholder="Port" value={destPort} onChange={(e) => setDestPort(e.target.value)} className="w-20 h-8 text-sm" type="number" />
          <Button size="sm" className="h-8" onClick={addRule} disabled={saveMutation.isPending}>
            <Plus size={13} /> Add Rule
          </Button>
        </div>
      </div>

      {/* Rules list */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading rules…</p>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border p-8 text-center text-muted-foreground text-sm">
          No routing rules yet. Add a rule above.
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-sm">Routing Rules ({rules.length})</h3>
            <span className="text-xs text-muted-foreground">Applied in priority order (lower number = higher priority)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 text-xs text-muted-foreground border-b">
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Modality</th>
                  <th className="px-4 py-2 text-left">Destination</th>
                  <th className="px-4 py-2 text-center">Priority</th>
                  <th className="px-4 py-2 text-center">Status</th>
                  <th className="px-4 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rules.map((r) => (
                  <tr key={r.id} className={`hover:bg-muted/20 transition-colors ${!r.isEnabled ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5 font-medium">{r.name}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="font-mono text-xs">{r.modalityType ?? "*"}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-xs">{r.destinationPacs}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.destinationAeTitle ?? ""}{r.destinationIp ? ` · ${r.destinationIp}:${r.destinationPort ?? 104}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs font-mono">{r.priority}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => toggleMutation.mutate(r.id)}
                        className={`text-xs rounded-full px-2 py-0.5 font-medium ${r.isEnabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}
                      >
                        {r.isEnabled ? "Enabled" : "Disabled"}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 text-red-600 hover:text-red-700"
                        onClick={() => deleteMutation.mutate(r.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
