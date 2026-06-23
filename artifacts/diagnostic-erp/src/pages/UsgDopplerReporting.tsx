import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fetchApi } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import ReportPrintSettingsDialog from "@/components/ReportPrintSettingsDialog";
import {
  generateReportPDF, loadPrintSettings, savePrintSettings, type PrintSettings,
} from "@/lib/reportPdfGenerator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { readStaffSession } from "@/lib/staffSession";
import VoiceDictationButton from "@/components/VoiceDictationButton";
import {
  Activity, Plus, CheckCircle2, XCircle, Clock, ArrowLeft,
  ChevronDown, ChevronUp, Waves, Download, Settings2,
} from "lucide-react";

interface DopplerMeasurement {
  id: number;
  worklistId: number | null;
  studyInstanceUID: string | null;
  vesselName: string;
  side: string;
  psv: string | null;
  edv: string | null;
  ri: string | null;
  pi: string | null;
  sdRatio: string | null;
  waveformLabel: string | null;
  waveformDescription: string | null;
  confidence: string;
  source: string;
  status: string;
  reviewedBy: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

const VESSEL_PRESETS = [
  "Portal Vein", "Hepatic Artery", "Hepatic Vein",
  "Renal Artery (Right)", "Renal Artery (Left)",
  "Renal Vein (Right)", "Renal Vein (Left)",
  "Splenic Artery", "Splenic Vein",
  "Superior Mesenteric Artery", "Superior Mesenteric Vein",
  "Uterine Artery (Right)", "Uterine Artery (Left)",
  "Umbilical Artery", "Middle Cerebral Artery",
  "Ductus Venosus", "Internal Carotid Artery",
  "Common Carotid Artery", "Other",
];

const CONF_BADGE: Record<string, string> = {
  high:   "bg-green-100 text-green-800 border-green-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low:    "bg-red-100 text-red-800 border-red-200",
};

const STATUS_BADGE: Record<string, string> = {
  pending_review: "bg-amber-100 text-amber-800",
  approved:       "bg-emerald-100 text-emerald-800",
  rejected:       "bg-red-100 text-red-800",
};

const emptyForm = {
  studyInstanceUID: "",
  vesselName: "Portal Vein",
  customVessel: "",
  side: "unknown",
  psv: "", edv: "", ri: "", pi: "", sdRatio: "",
  waveformLabel: "",
  waveformDescription: "",
  confidence: "medium",
};

export default function UsgDopplerReporting() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = readStaffSession();

  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

  // Print / PDF
  const [printSettings, setPrintSettings] = useState<PrintSettings>(loadPrintSettings);
  const [printSettingsOpen, setPrintSettingsOpen] = useState(false);
  const { data: clinicSettings } = useQuery<{ name?: string; tagline?: string; address?: string; phone?: string; email?: string; website?: string; logoDataUrl?: string | null }>({
    queryKey: ["clinic-settings"],
    queryFn: () => fetchApi("/api/clinic-settings/branding"),
    staleTime: 5 * 60_000,
  });

  const { data: measurements = [], isLoading } = useQuery<DopplerMeasurement[]>({
    queryKey: ["usg-doppler"],
    queryFn: () => fetchApi("/api/usg-doppler"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchApi("/api/usg-doppler", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast({ title: "Doppler measurement saved" });
      setShowCreate(false);
      setForm(emptyForm);
      void qc.invalidateQueries({ queryKey: ["usg-doppler"] });
      void qc.invalidateQueries({ queryKey: ["usg-stats"] });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, action, notes }: { id: number; action: "approve" | "reject"; notes?: string }) =>
      fetchApi(`/api/usg-doppler/${id}/${action}`, { method: "PATCH", body: JSON.stringify({
        reviewedBy: session?.user.name ?? "staff",
        reviewNotes: notes,
      }) }),
    onSuccess: () => {
      toast({ title: "Status updated" });
      void qc.invalidateQueries({ queryKey: ["usg-doppler"] });
      void qc.invalidateQueries({ queryKey: ["usg-stats"] });
    },
  });

  const handleCreate = () => {
    const vesselName = form.vesselName === "Other" ? form.customVessel : form.vesselName;
    if (!vesselName) { toast({ title: "Vessel name required", variant: "destructive" }); return; }
    createMutation.mutate({
      vesselName,
      side: form.side,
      studyInstanceUID: form.studyInstanceUID || null,
      psv: form.psv || null,
      edv: form.edv || null,
      ri: form.ri || null,
      pi: form.pi || null,
      sdRatio: form.sdRatio || null,
      waveformLabel: form.waveformLabel || null,
      waveformDescription: form.waveformDescription || null,
      confidence: form.confidence,
      source: "manual",
    });
  };

  const upd = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const pending = measurements.filter((m) => m.status === "pending_review").length;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="Doppler Reporting"
        subtitle="Structured Doppler velocimetry — PSV, EDV, RI, PI, S/D ratio per vessel"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/usg")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add Vessel
            </Button>
            <Button size="sm" variant="outline" onClick={() => {
              if (measurements.length === 0) { toast({ title: "No measurements to print" }); return; }
              const meas = measurements.map((m) => ({
                label: `${m.vesselName} ${m.side !== "unknown" ? `(${m.side})` : ""}`,
                value: [`PSV: ${m.psv ?? "—"}`, `EDV: ${m.edv ?? "—"}`, `RI: ${m.ri ?? "—"}`, `PI: ${m.pi ?? "—"}`, `S/D: ${m.sdRatio ?? "—"}`].join(" | "),
              }));
              generateReportPDF({
                patientName: "Doppler Study",
                studyDate: new Date().toLocaleDateString(),
                modality: "USG Doppler",
                findings: `Reviewed: ${measurements.filter((m) => m.status === "approved").length} / Pending: ${measurements.filter((m) => m.status === "pending_review").length}`,
                measurements: meas,
                impression: "Doppler velocimetry measurements as above. Correlate clinically.",
                recommendation: "Please correlate with clinical findings.",
                reportTitle: "Doppler Velocimetry Report",
                printedBy: session?.user.name ?? undefined,
              }, printSettings, clinicSettings ?? null);
              toast({ title: "PDF downloaded" });
            }}>
              <Download className="h-4 w-4 mr-1" /> PDF
            </Button>
            <Button size="sm" variant="ghost" className="px-2" onClick={() => setPrintSettingsOpen(true)} title="Print settings">
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {pending > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
          <Clock className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {pending} vessel{pending !== 1 ? "s" : ""} awaiting review
          </span>
        </div>
      )}

      {showCreate && (
        <Card className="border-rose-200/60 bg-rose-50/30 dark:bg-rose-950/10">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-rose-500" /> Add Doppler Measurement
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Vessel</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.vesselName}
                  onChange={(e) => upd("vesselName", e.target.value)}
                >
                  {VESSEL_PRESETS.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                {form.vesselName === "Other" && (
                  <Input placeholder="Enter vessel name" value={form.customVessel} onChange={(e) => upd("customVessel", e.target.value)} />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Side</Label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.side} onChange={(e) => upd("side", e.target.value)}>
                  <option value="unknown">—</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="bilateral">Bilateral</option>
                  <option value="midline">Midline</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {(["psv","edv","ri","pi","sdRatio"] as const).map((field) => (
                <div key={field} className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide">{field === "sdRatio" ? "S/D" : field.toUpperCase()}</Label>
                  <Input
                    placeholder={field === "psv" || field === "edv" ? "cm/s" : "0.00"}
                    value={form[field]}
                    onChange={(e) => upd(field, e.target.value)}
                    className="text-sm"
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Study UID (optional)</Label>
                <Input placeholder="1.2.840…" value={form.studyInstanceUID} onChange={(e) => upd("studyInstanceUID", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Waveform Label (optional)</Label>
                <Input placeholder="e.g. Triphasic, Monophasic" value={form.waveformLabel} onChange={(e) => upd("waveformLabel", e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Notes / Waveform Description (optional)</Label>
                <VoiceDictationButton
                  targetField="waveformDescription"
                  onInsert={(text) => upd("waveformDescription", (form.waveformDescription ? form.waveformDescription + " " : "") + text)}
                />
              </div>
              <Textarea rows={2} value={form.waveformDescription} onChange={(e) => upd("waveformDescription", e.target.value)} placeholder="Describe waveform pattern, clinical impression…" />
            </div>

            <div className="space-y-1.5">
              <Label>Confidence</Label>
              <div className="flex gap-2">
                {(["high","medium","low"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => upd("confidence", c)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all capitalize ${
                      form.confidence === c ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Saving…" : "Save Measurement"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
        </div>
      )}

      {!isLoading && measurements.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <Waves className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground font-medium">No Doppler measurements recorded yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Doppler data extracted from DICOM SR or added manually will appear here.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {measurements.map((m) => {
          const isExp = expandedId === m.id;
          return (
            <Card key={m.id} className="overflow-hidden">
              <CardContent className="p-0">
                <button
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedId(isExp ? null : m.id)}
                >
                  <div className="w-9 h-9 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center flex-shrink-0">
                    <Activity className="h-4 w-4 text-rose-600 dark:text-rose-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{m.vesselName}</span>
                      {m.side !== "unknown" && (
                        <span className="text-xs text-muted-foreground capitalize">({m.side})</span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${CONF_BADGE[m.confidence] ?? CONF_BADGE.low}`}>
                        {m.confidence}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE[m.status] ?? STATUS_BADGE.pending_review}`}>
                        {m.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="flex gap-3 mt-1 flex-wrap">
                      {m.psv && <span className="text-xs text-muted-foreground">PSV: <strong>{m.psv}</strong></span>}
                      {m.edv && <span className="text-xs text-muted-foreground">EDV: <strong>{m.edv}</strong></span>}
                      {m.ri  && <span className="text-xs text-muted-foreground">RI: <strong>{m.ri}</strong></span>}
                      {m.pi  && <span className="text-xs text-muted-foreground">PI: <strong>{m.pi}</strong></span>}
                      {m.sdRatio && <span className="text-xs text-muted-foreground">S/D: <strong>{m.sdRatio}</strong></span>}
                    </div>
                  </div>
                  {isExp ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>

                {isExp && (
                  <div className="px-4 pb-4 pt-3 border-t border-border/50 space-y-3">
                    {m.waveformLabel && (
                      <p className="text-sm"><span className="text-muted-foreground">Waveform:</span> {m.waveformLabel}</p>
                    )}
                    {m.waveformDescription && (
                      <p className="text-sm text-muted-foreground">{m.waveformDescription}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Source: <strong>{m.source.replace(/_/g, " ")}</strong> · Added: {new Date(m.createdAt).toLocaleString()}
                    </p>
                    {m.status === "pending_review" && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => approveMutation.mutate({ id: m.id, action: "approve" })}
                          disabled={approveMutation.isPending}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Approve
                        </Button>
                        <Button
                          size="sm" variant="destructive"
                          onClick={() => approveMutation.mutate({ id: m.id, action: "reject" })}
                          disabled={approveMutation.isPending}
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1.5" /> Reject
                        </Button>
                      </div>
                    )}
                    {m.reviewedBy && (
                      <p className="text-xs text-muted-foreground">
                        Reviewed by {m.reviewedBy}
                        {m.reviewNotes ? ` — "${m.reviewNotes}"` : ""}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ReportPrintSettingsDialog
        open={printSettingsOpen}
        onClose={() => setPrintSettingsOpen(false)}
        settings={printSettings}
        onChange={(s) => { setPrintSettings(s); savePrintSettings(s); }}
      />
    </div>
  );
}
