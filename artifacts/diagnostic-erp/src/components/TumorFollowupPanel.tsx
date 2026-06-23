/**
 * Phase 10B: Tumor Follow-up Panel
 * RECIST-like longitudinal tumor tracking with timeline view.
 * AI Draft – Requires Radiologist Review
 */
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/fetchApi";
import { Badge } from "@/components/ui/badge";
import { Plus, Save, TrendingUp, TrendingDown, Minus, Target, Clock } from "lucide-react";

interface TumorEntry {
  id: number;
  tumorLabel: string;
  tumorLocation: string | null;
  histologyType: string | null;
  sizeMmAxis1: string | null;
  sizeMmAxis2: string | null;
  sizeMmAxis3: string | null;
  volumeCc: string | null;
  changePct: string | null;
  changeStatus: string | null;
  responseStatus: string | null;
  enhancementStatus: string | null;
  treatmentPhase: string | null;
  studyDate: string | null;
  createdAt: string;
  isBaseline: boolean;
  recordedByName: string | null;
  notes: string | null;
  calculatedChangePct?: string;
}

interface TimelineData {
  timeline: TumorEntry[];
  byLabel: Record<string, TumorEntry[]>;
}

interface Props {
  patientId?: number;
  orderId?: number;
  studyId?: number;
  modality?: string;
}

const RESPONSE_STATUS_OPTIONS = ["NE", "CR", "PR", "SD", "PD"];
const CHANGE_STATUS_OPTIONS = ["stable", "decreased", "increased", "resolved", "new_lesion"];
const ENHANCEMENT_OPTIONS = ["none", "peripheral", "solid", "heterogeneous", "ring"];
const TREATMENT_PHASE_OPTIONS = ["pre_treatment", "post_op", "adjuvant", "surveillance"];

const RESPONSE_COLORS: Record<string, string> = {
  CR: "bg-green-500 text-white",
  PR: "bg-blue-500 text-white",
  SD: "bg-gray-400 text-white",
  PD: "bg-red-500 text-white",
  NE: "bg-gray-200 text-gray-700",
};

const CHANGE_ICONS: Record<string, React.ReactNode> = {
  increased: <TrendingUp size={12} className="text-red-500" />,
  decreased: <TrendingDown size={12} className="text-green-500" />,
  stable: <Minus size={12} className="text-gray-400" />,
  resolved: <Target size={12} className="text-green-600" />,
};

export default function TumorFollowupPanel({ patientId, orderId, studyId, modality }: Props) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"add" | "timeline">("timeline");
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    tumorLabel: "", tumorLocation: "", histologyType: "",
    sizeMmAxis1: "", sizeMmAxis2: "", sizeMmAxis3: "",
    volumeCc: "", changeStatus: "stable", responseStatus: "NE",
    enhancementStatus: "none", treatmentPhase: "surveillance",
    studyDate: new Date().toISOString().split("T")[0],
    isBaseline: false, notes: "",
  });

  const loadTimeline = useCallback(async () => {
    if (!patientId) return;
    try {
      const data = await api.get<TimelineData>(`/api/radiology-tumor/timeline?patientId=${patientId}`);
      setTimeline(data);
    } catch { /* ignore */ }
  }, [patientId]);

  useEffect(() => { loadTimeline(); }, [loadTimeline]);

  const set = (field: string, value: string | boolean) => setForm((f) => ({ ...f, [field]: value }));

  const handleSave = async () => {
    if (!patientId) { toast({ title: "No patient selected", variant: "destructive" }); return; }
    if (!form.tumorLabel.trim()) { toast({ title: "Tumor label required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await api.post("/api/radiology-tumor", {
        patientId, orderId, studyId, modality,
        ...form,
        sizeMmAxis1: form.sizeMmAxis1 || null,
        sizeMmAxis2: form.sizeMmAxis2 || null,
        sizeMmAxis3: form.sizeMmAxis3 || null,
        volumeCc: form.volumeCc || null,
        studyDate: form.studyDate || null,
      });
      toast({ title: "Tumor follow-up saved", description: "AI Draft — Requires Radiologist Review" });
      setForm({ ...form, sizeMmAxis1: "", sizeMmAxis2: "", sizeMmAxis3: "", volumeCc: "", notes: "", isBaseline: false });
      loadTimeline();
      setTab("timeline");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const tumorLabels = timeline ? Object.keys(timeline.byLabel) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Target size={16} className="text-primary" />
        <span className="font-semibold text-sm">Tumor Follow-up</span>
        <Badge variant="outline" className="text-[10px]">RECIST</Badge>
        <div className="flex-1" />
        <button onClick={() => setTab("timeline")} className={`text-xs px-2.5 py-1 rounded-lg transition ${tab === "timeline" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>Timeline</button>
        <button onClick={() => setTab("add")} className={`text-xs px-2.5 py-1 rounded-lg transition ${tab === "add" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
          <Plus size={12} className="inline mr-0.5" /> Add
        </button>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-[11px] text-yellow-800">
        AI Draft — Requires Radiologist Review
      </div>

      {tab === "add" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="col-span-2">
              <Label className="text-[10px]">Tumor Label *</Label>
              <Input value={form.tumorLabel} onChange={(e) => set("tumorLabel", e.target.value)}
                placeholder="e.g. Right frontal GBM" className="h-7 text-xs mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px]">Location</Label>
              <Input value={form.tumorLocation} onChange={(e) => set("tumorLocation", e.target.value)}
                placeholder="e.g. right frontal lobe" className="h-7 text-xs mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px]">Histology</Label>
              <Input value={form.histologyType} onChange={(e) => set("histologyType", e.target.value)}
                placeholder="e.g. GBM, metastasis" className="h-7 text-xs mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px]">Axis 1 (mm)</Label>
              <Input type="number" step="0.1" value={form.sizeMmAxis1} onChange={(e) => set("sizeMmAxis1", e.target.value)}
                placeholder="longest axis" className="h-7 text-xs mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px]">Axis 2 (mm)</Label>
              <Input type="number" step="0.1" value={form.sizeMmAxis2} onChange={(e) => set("sizeMmAxis2", e.target.value)}
                placeholder="perpendicular" className="h-7 text-xs mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px]">Axis 3 (mm)</Label>
              <Input type="number" step="0.1" value={form.sizeMmAxis3} onChange={(e) => set("sizeMmAxis3", e.target.value)}
                placeholder="craniocaudal" className="h-7 text-xs mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px]">Volume (cc)</Label>
              <Input type="number" step="0.001" value={form.volumeCc} onChange={(e) => set("volumeCc", e.target.value)}
                placeholder="optional" className="h-7 text-xs mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px]">Change</Label>
              <select value={form.changeStatus} onChange={(e) => set("changeStatus", e.target.value)}
                className="w-full border rounded px-1.5 py-1 text-xs mt-0.5 bg-background">
                {CHANGE_STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px]">Response (RECIST)</Label>
              <select value={form.responseStatus} onChange={(e) => set("responseStatus", e.target.value)}
                className="w-full border rounded px-1.5 py-1 text-xs mt-0.5 bg-background">
                {RESPONSE_STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px]">Enhancement</Label>
              <select value={form.enhancementStatus} onChange={(e) => set("enhancementStatus", e.target.value)}
                className="w-full border rounded px-1.5 py-1 text-xs mt-0.5 bg-background">
                {ENHANCEMENT_OPTIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px]">Treatment Phase</Label>
              <select value={form.treatmentPhase} onChange={(e) => set("treatmentPhase", e.target.value)}
                className="w-full border rounded px-1.5 py-1 text-xs mt-0.5 bg-background">
                {TREATMENT_PHASE_OPTIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px]">Study Date</Label>
              <Input type="date" value={form.studyDate} onChange={(e) => set("studyDate", e.target.value)}
                className="h-7 text-xs mt-0.5" />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input type="checkbox" checked={form.isBaseline} onChange={(e) => set("isBaseline", e.target.checked)} className="h-3.5 w-3.5" />
              <Label className="text-[10px] cursor-pointer">Mark as Baseline</Label>
            </div>
            <div className="col-span-2">
              <Label className="text-[10px]">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)}
                rows={2} className="text-xs mt-0.5" placeholder="Any comments..." />
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving || !patientId} className="w-full" size="sm">
            <Save size={14} className="mr-1.5" /> {saving ? "Saving..." : "Save Tumor Entry"}
          </Button>
        </div>
      )}

      {tab === "timeline" && (
        <div className="space-y-4">
          {!timeline || timeline.timeline.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No tumor follow-up entries yet.
              <br />
              <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={() => setTab("add")}>
                <Plus size={12} className="mr-1" /> Add First Entry
              </Button>
            </div>
          ) : (
            tumorLabels.map((label) => {
              const entries = timeline.byLabel[label];
              const latest = entries[entries.length - 1];
              return (
                <div key={label} className="border border-card-border rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b">
                    <Target size={13} className="text-primary" />
                    <span className="font-semibold text-xs">{label}</span>
                    {latest?.histologyType && <Badge variant="outline" className="text-[10px]">{latest.histologyType}</Badge>}
                    {latest?.responseStatus && (
                      <Badge className={`text-[10px] px-1.5 ml-auto ${RESPONSE_COLORS[latest.responseStatus] ?? "bg-gray-100"}`}>
                        {latest.responseStatus}
                      </Badge>
                    )}
                  </div>
                  <div className="divide-y divide-card-border">
                    {entries.map((e) => {
                      const size = e.sizeMmAxis1 ? `${e.sizeMmAxis1}${e.sizeMmAxis2 ? ` × ${e.sizeMmAxis2}` : ""}${e.sizeMmAxis3 ? ` × ${e.sizeMmAxis3}` : ""} mm` : null;
                      const change = e.changePct ?? e.calculatedChangePct;
                      return (
                        <div key={e.id} className="px-3 py-2 text-xs flex items-start gap-3">
                          <div className="flex-none w-24 text-muted-foreground">
                            {e.studyDate ? new Date(e.studyDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : new Date(e.createdAt).toLocaleDateString("en-IN")}
                          </div>
                          <div className="flex-1 space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              {e.isBaseline && <Badge className="text-[9px] bg-blue-100 text-blue-700">Baseline</Badge>}
                              {size && <span className="font-medium">{size}</span>}
                              {e.volumeCc && <span className="text-muted-foreground">{e.volumeCc} cc</span>}
                              {e.changeStatus && CHANGE_ICONS[e.changeStatus]}
                              {change && <span className={`font-medium ${Number(change) > 0 ? "text-red-600" : "text-green-600"}`}>{Number(change) > 0 ? "+" : ""}{change}%</span>}
                              {e.responseStatus && e.responseStatus !== "NE" && (
                                <Badge className={`text-[9px] px-1.5 ${RESPONSE_COLORS[e.responseStatus] ?? "bg-gray-100"}`}>{e.responseStatus}</Badge>
                              )}
                            </div>
                            {e.notes && <p className="text-muted-foreground">{e.notes}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
