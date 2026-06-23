import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Plus, Pencil, Trash2, Wifi, WifiOff, RefreshCw,
  Activity, Radio, AlertCircle, CheckCircle2, Clock, Server,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type DicomModality = {
  id: number;
  machineName: string;
  modality: string | null;
  aeTitle: string | null;
  ipAddress: string | null;
  port: number | null;
  location: string | null;
  manufacturer: string | null;
  autoSendEnabled: boolean;
  isActive: boolean;
  queryEnabled: boolean;
  retrieveEnabled: boolean;
  pollingEnabled: boolean;
  pollingIntervalSeconds: number;
  retrieveMethod: string;
  preferredTransferSyntax: string | null;
  destinationPacs: string;
  watchFolderPath: string | null;
  cStorePort: number | null;
  usbAutoImportEnabled: boolean;
  nonDicomImportEnabled: boolean;
  autoPushToConquest: boolean;
  autoCreateWorklist: boolean;
  autoNotifyRadiologist: boolean;
  notes: string | null;
  lastConnectionStatus: string | null;
  lastSeenAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type FormState = {
  machineName: string;
  modality: string | null;
  aeTitle: string | null;
  ipAddress: string | null;
  port: number | null;
  location: string | null;
  manufacturer: string | null;
  autoSendEnabled: boolean;
  isActive: boolean;
  queryEnabled: boolean;
  retrieveEnabled: boolean;
  pollingEnabled: boolean;
  pollingIntervalSeconds: number;
  retrieveMethod: string;
  preferredTransferSyntax: string | null;
  destinationPacs: string;
  watchFolderPath: string | null;
  cStorePort: number | null;
  usbAutoImportEnabled: boolean;
  nonDicomImportEnabled: boolean;
  autoPushToConquest: boolean;
  autoCreateWorklist: boolean;
  autoNotifyRadiologist: boolean;
  notes: string | null;
};

// ── Constants ──────────────────────────────────────────────────────────────

const MODALITY_TYPES = ["MR", "CT", "CR", "DX", "US", "XA", "MG", "PT", "NM", "OT"] as const;
const RETRIEVE_METHODS = [
  "C_MOVE", "C_GET", "C_STORE", "WATCH_FOLDER",
  "C_STORE_OR_WATCH_FOLDER", "USB_DICOMDIR", "NON_DICOM_JPG_PNG",
] as const;
const RETRIEVE_METHOD_LABELS: Record<string, string> = {
  C_MOVE: "C-MOVE (classic retrieve)",
  C_GET: "C-GET (direct receive)",
  C_STORE: "C-STORE SCP (push receive)",
  WATCH_FOLDER: "Watch Folder (filesystem scan)",
  C_STORE_OR_WATCH_FOLDER: "C-STORE + Watch Folder (hybrid)",
  USB_DICOMDIR: "USB / DICOMDIR Import",
  NON_DICOM_JPG_PNG: "Non-DICOM JPG/PNG Fallback",
};
const DESTINATION_PACS_OPTIONS = ["CONQUEST", "ORTHANC"] as const;

const MODALITY_COLORS: Record<string, string> = {
  MR: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  CT: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  CR: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  DX: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  US: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  XA: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  MG: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  PT: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  NM: "bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300",
  OT: "bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300",
};

const MODALITY_LABELS: Record<string, string> = {
  MR: "MRI",
  CT: "CT Scan",
  CR: "X-Ray (CR)",
  DX: "X-Ray (DR/DX)",
  US: "Ultrasound",
  XA: "C-Arm",
  MG: "Mammography",
  PT: "PET Scan",
  NM: "Nuclear Med",
  OT: "Other",
};

const BLANK_FORM: FormState = {
  machineName: "",
  modality: "MR",
  aeTitle: "",
  ipAddress: "",
  port: 104,
  location: "",
  manufacturer: "",
  autoSendEnabled: true,
  isActive: true,
  queryEnabled: true,
  retrieveEnabled: true,
  pollingEnabled: false,
  pollingIntervalSeconds: 300,
  retrieveMethod: "C_MOVE",
  preferredTransferSyntax: "",
  destinationPacs: "CONQUEST",
  watchFolderPath: "",
  cStorePort: null,
  usbAutoImportEnabled: false,
  nonDicomImportEnabled: false,
  autoPushToConquest: true,
  autoCreateWorklist: true,
  autoNotifyRadiologist: false,
  notes: "",
};

function modalityToForm(m: DicomModality): FormState {
  return {
    machineName: m.machineName,
    modality: m.modality,
    aeTitle: m.aeTitle,
    ipAddress: m.ipAddress,
    port: m.port,
    location: m.location,
    manufacturer: m.manufacturer,
    autoSendEnabled: m.autoSendEnabled,
    isActive: m.isActive,
    queryEnabled: m.queryEnabled,
    retrieveEnabled: m.retrieveEnabled,
    pollingEnabled: m.pollingEnabled,
    pollingIntervalSeconds: m.pollingIntervalSeconds,
    retrieveMethod: m.retrieveMethod,
    preferredTransferSyntax: m.preferredTransferSyntax,
    destinationPacs: m.destinationPacs,
    watchFolderPath: m.watchFolderPath,
    cStorePort: m.cStorePort,
    usbAutoImportEnabled: m.usbAutoImportEnabled,
    nonDicomImportEnabled: m.nonDicomImportEnabled,
    autoPushToConquest: m.autoPushToConquest,
    autoCreateWorklist: m.autoCreateWorklist,
    autoNotifyRadiologist: m.autoNotifyRadiologist,
    notes: m.notes,
  };
}

// ── Toggle switch helper ───────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <Toggle checked={checked} onChange={onChange} />
      <span className="text-sm">{label}</span>
    </label>
  );
}

// ── Form dialog ────────────────────────────────────────────────────────────

function ModalityForm({
  open,
  initial,
  title,
  onClose,
  onSave,
  isSaving,
}: {
  open: boolean;
  initial: FormState;
  title: string;
  onClose: () => void;
  onSave: (data: FormState) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio size={16} className="text-primary" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Identity */}
          <section className="rounded-lg border p-4 space-y-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Identity</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Machine Name *</label>
                <Input value={form.machineName} onChange={(e) => set("machineName", e.target.value)} placeholder="e.g. MRI Room 1" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Modality Type</label>
                <select
                  value={form.modality ?? "MR"}
                  onChange={(e) => set("modality", e.target.value)}
                  className="w-full h-8 text-sm border rounded-md px-2 bg-background"
                >
                  {MODALITY_TYPES.map((m) => (
                    <option key={m} value={m}>{m} — {MODALITY_LABELS[m] ?? m}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Manufacturer / Model</label>
                <Input value={form.manufacturer ?? ""} onChange={(e) => set("manufacturer", e.target.value)} placeholder="e.g. Siemens MAGNETOM" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Location / Room</label>
                <Input value={form.location ?? ""} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Radiology Wing - B2" className="h-8 text-sm" />
              </div>
            </div>
          </section>

          {/* Network / DICOM */}
          <section className="rounded-lg border p-4 space-y-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Network / DICOM</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1">
                <label className="text-xs font-medium">IP Address</label>
                <Input value={form.ipAddress ?? ""} onChange={(e) => set("ipAddress", e.target.value)} placeholder="192.168.1.100" className="h-8 text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">DICOM Port</label>
                <Input
                  type="number"
                  value={form.port ?? 104}
                  onChange={(e) => set("port", Number(e.target.value))}
                  placeholder="104"
                  className="h-8 text-sm font-mono"
                />
              </div>
              <div className="col-span-3 space-y-1">
                <label className="text-xs font-medium">AE Title</label>
                <Input
                  value={form.aeTitle ?? ""}
                  onChange={(e) => set("aeTitle", e.target.value.toUpperCase())}
                  placeholder="e.g. MRI_ROOM1"
                  className="h-8 text-sm font-mono"
                />
              </div>
            </div>
          </section>

          {/* Pull agent config */}
          <section className="rounded-lg border p-4 space-y-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Pull Agent Configuration</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Retrieve Method</label>
                <select
                  value={form.retrieveMethod}
                  onChange={(e) => set("retrieveMethod", e.target.value)}
                  className="w-full h-8 text-sm border rounded-md px-2 bg-background"
                >
                  {RETRIEVE_METHODS.map((m) => <option key={m} value={m}>{RETRIEVE_METHOD_LABELS[m]}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Destination PACS</label>
                <select
                  value={form.destinationPacs}
                  onChange={(e) => set("destinationPacs", e.target.value)}
                  className="w-full h-8 text-sm border rounded-md px-2 bg-background"
                >
                  {DESTINATION_PACS_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Polling Interval (seconds)</label>
                <Input
                  type="number"
                  value={form.pollingIntervalSeconds}
                  onChange={(e) => set("pollingIntervalSeconds", Math.max(30, Number(e.target.value)))}
                  min={30}
                  max={3600}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Preferred Transfer Syntax</label>
                <Input
                  value={form.preferredTransferSyntax ?? ""}
                  onChange={(e) => set("preferredTransferSyntax", e.target.value)}
                  placeholder="Leave blank for default"
                  className="h-8 text-sm font-mono"
                />
              </div>
            </div>

            {/* USG / Voluson-specific import settings — shown when retrieveMethod supports file-based import */}
            {(form.retrieveMethod === "WATCH_FOLDER" || form.retrieveMethod === "C_STORE_OR_WATCH_FOLDER" ||
              form.retrieveMethod === "USB_DICOMDIR" || form.retrieveMethod === "NON_DICOM_JPG_PNG") && (
              <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Watch Folder Path</label>
                  <Input
                    value={form.watchFolderPath ?? ""}
                    onChange={(e) => set("watchFolderPath", e.target.value)}
                    placeholder="e.g. /var/dicom/incoming/voluson"
                    className="h-8 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">C-STORE SCP Port</label>
                  <Input
                    type="number"
                    value={form.cStorePort ?? ""}
                    onChange={(e) => set("cStorePort", e.target.value ? Number(e.target.value) : null)}
                    placeholder="e.g. 11112"
                    className="h-8 text-sm font-mono"
                  />
                </div>
              </div>
            )}
          </section>

          {/* Toggles */}
          <section className="rounded-lg border p-4 space-y-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Capabilities &amp; Automation</p>
            <div className="grid grid-cols-2 gap-y-3 gap-x-6">
              <ToggleRow label="Device Active" checked={form.isActive} onChange={(v) => set("isActive", v)} />
              <ToggleRow label="Auto Send Enabled" checked={form.autoSendEnabled} onChange={(v) => set("autoSendEnabled", v)} />
              <ToggleRow label="Query (C-FIND)" checked={form.queryEnabled} onChange={(v) => set("queryEnabled", v)} />
              <ToggleRow label="Retrieve (C-MOVE / C-GET)" checked={form.retrieveEnabled} onChange={(v) => set("retrieveEnabled", v)} />
              <ToggleRow label="Enable Polling" checked={form.pollingEnabled} onChange={(v) => set("pollingEnabled", v)} />
              <ToggleRow label="Auto Push to Conquest" checked={form.autoPushToConquest} onChange={(v) => set("autoPushToConquest", v)} />
              <ToggleRow label="Auto Create Worklist" checked={form.autoCreateWorklist} onChange={(v) => set("autoCreateWorklist", v)} />
              <ToggleRow label="Auto Notify Radiologist" checked={form.autoNotifyRadiologist} onChange={(v) => set("autoNotifyRadiologist", v)} />
              <ToggleRow label="USB / DICOMDIR Auto-Import" checked={form.usbAutoImportEnabled} onChange={(v) => set("usbAutoImportEnabled", v)} />
              <ToggleRow label="Non-DICOM JPG/PNG Fallback" checked={form.nonDicomImportEnabled} onChange={(v) => set("nonDicomImportEnabled", v)} />
            </div>
          </section>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-medium">Notes</label>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Optional notes about this device…"
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(form)} disabled={!form.machineName.trim() || isSaving}>
            {isSaving ? "Saving…" : "Save Device"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Modality card ──────────────────────────────────────────────────────────

type EchoState = "idle" | "testing" | "ok" | "fail";

function ModalityCard({
  m,
  onEdit,
  onDelete,
  onQuickToggle,
}: {
  m: DicomModality;
  onEdit: () => void;
  onDelete: () => void;
  onQuickToggle: (field: keyof DicomModality, val: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [echoState, setEchoState] = useState<EchoState>("idle");
  const [echoMsg, setEchoMsg] = useState("");

  const colorCls = MODALITY_COLORS[m.modality ?? "OT"] ?? MODALITY_COLORS["OT"]!;
  const isOnline = m.lastConnectionStatus === "ok";

  const echoMut = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; latencyMs: number; message: string }>(
        `/api/radiology/modalities/${m.id}/echo-test`,
        {},
      ),
    onMutate: () => { setEchoState("testing"); setEchoMsg(""); },
    onSuccess: (res: { ok: boolean; latencyMs: number; message: string }) => {
      setEchoState(res.ok ? "ok" : "fail");
      setEchoMsg(res.message);
      qc.invalidateQueries({ queryKey: ["pacs-modalities"] });
      toast({
        title: res.ok ? `Reachable in ${res.latencyMs}ms` : "Connection failed",
        description: res.message,
        variant: res.ok ? "default" : "destructive",
      });
    },
    onError: () => { setEchoState("fail"); setEchoMsg("Test request failed"); },
  });

  return (
    <div className={`rounded-xl border bg-card p-4 space-y-3 transition-shadow hover:shadow-md ${!m.isActive ? "opacity-60" : ""}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${colorCls}`}>
              {m.modality ?? "OT"} — {MODALITY_LABELS[m.modality ?? "OT"] ?? m.modality}
            </span>
            {m.isActive ? (
              <span className="flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                Active
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">Inactive</span>
            )}
          </div>
          <p className="font-semibold text-sm mt-1 truncate">{m.machineName}</p>
          {m.manufacturer && <p className="text-xs text-muted-foreground truncate">{m.manufacturer}</p>}
        </div>
        <div className="flex gap-1 shrink-0">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onEdit} title="Edit">
            <Pencil size={12} />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={onDelete} title="Delete">
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      {/* Network info */}
      <div className="text-xs font-mono text-muted-foreground space-y-0.5">
        {(m.ipAddress || m.port) && (
          <p className="flex items-center gap-1.5">
            <Server size={11} className="shrink-0" />
            {m.ipAddress ?? "—"}:{m.port ?? "—"}
          </p>
        )}
        {m.aeTitle && (
          <p className="flex items-center gap-1.5">
            <Radio size={11} className="shrink-0" />
            AE: {m.aeTitle}
          </p>
        )}
        {m.location && <p className="text-[11px] font-sans mt-0.5">{m.location}</p>}
      </div>

      {/* Connection status */}
      <div className="flex items-center gap-2 min-h-[18px]">
        {isOnline ? (
          <span className="flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400 font-medium">
            <Wifi size={11} />
            Online
            {m.lastSeenAt && (
              <span className="text-muted-foreground font-normal ml-1">
                {new Date(m.lastSeenAt).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
              </span>
            )}
          </span>
        ) : m.lastConnectionStatus ? (
          <span className="flex items-center gap-1 text-[11px] text-red-600 font-medium">
            <WifiOff size={11} />
            Unreachable
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Not tested</span>
        )}
        {echoState === "ok" && <CheckCircle2 size={12} className="text-green-600 ml-auto" />}
        {echoState === "fail" && <AlertCircle size={12} className="text-red-600 ml-auto" />}
      </div>

      {echoMsg && (
        <p className="text-[11px] text-muted-foreground bg-muted px-2 py-1 rounded font-mono truncate">{echoMsg}</p>
      )}
      {m.lastError && echoState === "idle" && (
        <p className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-2 py-1 rounded truncate">
          {m.lastError}
        </p>
      )}

      {/* Capability badges */}
      <div className="flex flex-wrap gap-1">
        {m.pollingEnabled && (
          <span className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-1.5 py-0.5 rounded-full font-medium">
            <Activity size={9} className="inline mr-0.5" />
            Polling {m.pollingIntervalSeconds}s
          </span>
        )}
        {m.queryEnabled && (
          <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">C-FIND</span>
        )}
        {m.retrieveEnabled && (
          <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
            {RETRIEVE_METHOD_LABELS[m.retrieveMethod] ?? m.retrieveMethod}
          </span>
        )}
        {m.usbAutoImportEnabled && (
          <span className="text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 px-1.5 py-0.5 rounded-full">USB</span>
        )}
        {m.nonDicomImportEnabled && (
          <span className="text-[10px] bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 px-1.5 py-0.5 rounded-full">JPG/PNG</span>
        )}
        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
          → {m.destinationPacs}
        </span>
      </div>

      {/* Action row */}
      <div className="flex gap-2 pt-1 border-t">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs flex-1"
          onClick={() => echoMut.mutate()}
          disabled={!m.ipAddress || !m.port || echoState === "testing"}
        >
          {echoState === "testing" ? (
            <RefreshCw size={11} className="mr-1 animate-spin" />
          ) : (
            <Wifi size={11} className="mr-1" />
          )}
          {echoState === "testing" ? "Testing…" : "Test Connection"}
        </Button>
        <Button
          size="sm"
          variant={m.pollingEnabled ? "default" : "outline"}
          className="h-7 text-xs"
          onClick={() => onQuickToggle("pollingEnabled", !m.pollingEnabled)}
          title={m.pollingEnabled ? "Disable polling" : "Enable polling"}
        >
          <Clock size={11} className="mr-1" />
          {m.pollingEnabled ? "Polling" : "Poll Off"}
        </Button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export function ModalityPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DicomModality | null>(null);

  const { data: modalities = [], isFetching, refetch } = useQuery<DicomModality[]>({
    queryKey: ["pacs-modalities"],
    queryFn: () => api.get("/api/radiology/modalities"),
  });

  const upsertMut = useMutation({
    mutationFn: (body: object) => api.post("/api/radiology/modalities", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pacs-modalities"] });
      toast({ title: "Modality saved" });
      setAddOpen(false);
      setEditTarget(null);
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/radiology/modalities/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pacs-modalities"] });
      toast({ title: "Modality deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  function buildPayload(data: FormState, id?: number): object {
    return {
      ...(id !== undefined ? { id } : {}),
      machineName: data.machineName.trim(),
      modality: data.modality || null,
      aeTitle: data.aeTitle?.trim() || null,
      ipAddress: data.ipAddress?.trim() || null,
      port: data.port || null,
      location: data.location?.trim() || null,
      manufacturer: data.manufacturer?.trim() || null,
      autoSendEnabled: data.autoSendEnabled,
      isActive: data.isActive,
      queryEnabled: data.queryEnabled,
      retrieveEnabled: data.retrieveEnabled,
      pollingEnabled: data.pollingEnabled,
      pollingIntervalSeconds: data.pollingIntervalSeconds,
      retrieveMethod: data.retrieveMethod,
      preferredTransferSyntax: data.preferredTransferSyntax?.trim() || null,
      destinationPacs: data.destinationPacs,
      watchFolderPath: data.watchFolderPath?.trim() || null,
      cStorePort: data.cStorePort,
      usbAutoImportEnabled: data.usbAutoImportEnabled,
      nonDicomImportEnabled: data.nonDicomImportEnabled,
      autoPushToConquest: data.autoPushToConquest,
      autoCreateWorklist: data.autoCreateWorklist,
      autoNotifyRadiologist: data.autoNotifyRadiologist,
      notes: data.notes?.trim() || null,
    };
  }

  // Group by modality type for display
  const byType: Record<string, DicomModality[]> = {};
  for (const m of modalities) {
    const key = m.modality ?? "OT";
    (byType[key] ??= []).push(m);
  }

  const stats = {
    total: modalities.length,
    active: modalities.filter((m) => m.isActive).length,
    polling: modalities.filter((m) => m.pollingEnabled).length,
    online: modalities.filter((m) => m.lastConnectionStatus === "ok").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
        </Button>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={14} className="mr-1" />
          Add Device
        </Button>
      </div>

      {/* Stats strip */}
      {modalities.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(
            [
              { label: "Total Devices", value: stats.total, icon: <Server size={14} className="text-muted-foreground" /> },
              { label: "Active", value: stats.active, icon: <CheckCircle2 size={14} className="text-green-600" /> },
              { label: "Polling", value: stats.polling, icon: <Activity size={14} className="text-blue-600" /> },
              { label: "Online Now", value: stats.online, icon: <Wifi size={14} className="text-green-600" /> },
            ] as const
          ).map((s) => (
            <div key={s.label} className="rounded-xl border bg-card p-3 text-center space-y-1">
              <div className="flex justify-center">{s.icon}</div>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Modality cards grouped by type */}
      {modalities.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center space-y-4">
          <Radio size={36} className="mx-auto text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">No imaging devices configured</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add your MRI, CT, X-Ray, and USG machines to enable DICOM Query/Retrieve and Worklist.
            </p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} className="mr-1" />
            Add First Device
          </Button>
        </div>
      ) : (
        <div className="space-y-7">
          {Object.entries(byType).map(([type, devices]) => (
            <div key={type}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${MODALITY_COLORS[type] ?? MODALITY_COLORS["OT"]}`}>
                  {type} — {MODALITY_LABELS[type] ?? type}
                </span>
                <span className="text-xs text-muted-foreground">
                  {devices.length} device{devices.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {devices.map((m) => (
                  <ModalityCard
                    key={m.id}
                    m={m}
                    onEdit={() => setEditTarget(m)}
                    onDelete={() => {
                      if (!confirm(`Delete "${m.machineName}"? This cannot be undone.`)) return;
                      deleteMut.mutate(m.id);
                    }}
                    onQuickToggle={(field, val) => upsertMut.mutate({ id: m.id, [field]: val })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add dialog — keyed to reset form on reopen */}
      <ModalityForm
        key={addOpen ? "add-open" : "add-closed"}
        open={addOpen}
        initial={{ ...BLANK_FORM }}
        title="Add Imaging Device"
        onClose={() => setAddOpen(false)}
        onSave={(data) => upsertMut.mutate(buildPayload(data))}
        isSaving={upsertMut.isPending}
      />

      {/* Edit dialog — keyed to target so form resets when switching cards */}
      {editTarget && (
        <ModalityForm
          key={`edit-${editTarget.id}`}
          open={!!editTarget}
          initial={modalityToForm(editTarget)}
          title={`Edit — ${editTarget.machineName}`}
          onClose={() => setEditTarget(null)}
          onSave={(data) => upsertMut.mutate(buildPayload(data, editTarget.id))}
          isSaving={upsertMut.isPending}
        />
      )}
    </div>
  );
}

export default function ModalityManagement() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="Modality Management" subtitle="Configure imaging devices (MRI, CT, X-Ray, USG) for DICOM Q/R and Worklist" />
      <ModalityPanel />
    </div>
  );
}
