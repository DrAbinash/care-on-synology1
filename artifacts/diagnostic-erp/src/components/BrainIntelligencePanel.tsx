/**
 * Phase 10B: Brain Intelligence Panel
 * Structured brain assessment with longitudinal trend sparklines.
 * AI Draft – Requires Radiologist Review
 */
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/fetchApi";
import { Badge } from "@/components/ui/badge";
import { Brain, Save, Clock, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

interface BrainSession {
  id: number;
  studyDate: string | null;
  createdAt: string;
  midlineShift: string | null;
  midlineShiftDirection: string | null;
  ventricleSizeStatus: string | null;
  hydrocephalus: string | null;
  infarctPresent: boolean;
  infarctSizeMm: string | null;
  hemorrhagePresent: boolean;
  hemorrhageSizeMm: string | null;
  massPresent: boolean;
  massVolumeCc: string | null;
  massEffect: string | null;
  edemaPresent: boolean;
  edemaSeverity: string | null;
  wmChanges: string | null;
  corticalAtrophy: string | null;
  overallImpression: string | null;
  recordedByName: string | null;
}

interface Props {
  patientId?: number;
  orderId?: number;
  studyId?: number;
  modality?: string;
}

const VENTRICLE_OPTS = ["normal", "mildly_enlarged", "moderately_enlarged", "severely_enlarged", "collapsed"];
const HYDRO_OPTS = ["none", "communicating", "obstructive", "ex_vacuo"];
const EFFECT_OPTS = ["none", "mild", "moderate", "severe"];
const ENHANCEMENT_OPTS = ["none", "peripheral", "solid", "heterogeneous", "ring"];
const INFARCT_TERRITORY_OPTS = ["MCA_left", "MCA_right", "PCA_left", "PCA_right", "ACA_left", "ACA_right", "posterior_fossa", "watershed", "lacunar"];
const INFARCT_PHASE_OPTS = ["hyperacute", "acute", "subacute", "chronic"];
const HEMORRHAGE_TYPE_OPTS = ["EDH", "SDH", "SAH", "IPH", "IVH", "mixed"];
const WM_OPTS = ["none", "mild_periventricular", "moderate_periventricular", "deep_wm", "confluent"];
const ATROPHY_OPTS = ["none", "mild", "moderate", "severe"];

type BoolField = "infarctPresent" | "hemorrhagePresent" | "massPresent" | "edemaPresent" | "cerebellumNormal" | "brainstemNormal";
type StringField = "midlineShift" | "midlineShiftDirection" | "ventricleSizeStatus" | "hydrocephalus" | "infarctSizeMm" | "infarctTerritory" | "infarctPhase" | "hemorrhageSizeMm" | "hemorrhageType" | "hemorrhageLocation" | "massVolumeCc" | "massLocation" | "massEnhancement" | "edemaSeverity" | "edemaType" | "massEffect" | "sulcalEfacement" | "corticalAtrophy" | "wmChanges" | "overallImpression";

type FormState = Record<BoolField, boolean> & Record<StringField, string>;

const initialForm = (): FormState => ({
  infarctPresent: false, hemorrhagePresent: false, massPresent: false,
  edemaPresent: false, cerebellumNormal: true, brainstemNormal: true,
  midlineShift: "", midlineShiftDirection: "none", ventricleSizeStatus: "normal",
  hydrocephalus: "none", infarctSizeMm: "", infarctTerritory: "",
  infarctPhase: "acute", hemorrhageSizeMm: "", hemorrhageType: "",
  hemorrhageLocation: "", massVolumeCc: "", massLocation: "",
  massEnhancement: "none", edemaSeverity: "mild", edemaType: "vasogenic",
  massEffect: "none", sulcalEfacement: "none", corticalAtrophy: "none",
  wmChanges: "none", overallImpression: "",
});

function TrendSparkline({ sessions, field, label }: { sessions: BrainSession[]; field: keyof BrainSession; label: string }) {
  const data = sessions
    .filter((s) => s[field] != null)
    .map((s) => ({
      date: s.studyDate ? new Date(s.studyDate).toLocaleDateString("en-IN", { month: "short", day: "numeric" }) : new Date(s.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
      value: Number(s[field]),
    }))
    .filter((d) => !isNaN(d.value));

  if (data.length < 2) return null;

  const last = data[data.length - 1]?.value ?? 0;
  const prev = data[data.length - 2]?.value ?? 0;
  const trend = last > prev ? "up" : last < prev ? "down" : "stable";

  return (
    <div className="border border-card-border rounded p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium">{label}</span>
        {trend === "up" && <TrendingUp size={12} className="text-red-500" />}
        {trend === "down" && <TrendingDown size={12} className="text-green-500" />}
        {trend === "stable" && <Minus size={12} className="text-gray-400" />}
      </div>
      <ResponsiveContainer width="100%" height={50}>
        <LineChart data={data}>
          <Line type="monotone" dataKey="value" stroke="#3b82f6" dot={true} strokeWidth={1.5} />
          <XAxis dataKey="date" tick={{ fontSize: 8 }} />
          <YAxis tick={{ fontSize: 8 }} width={20} />
          <Tooltip contentStyle={{ fontSize: 10 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function BrainIntelligencePanel({ patientId, orderId, studyId, modality }: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(initialForm());
  const [saving, setSaving] = useState(false);
  const [sessions, setSessions] = useState<BrainSession[]>([]);
  const [tab, setTab] = useState<"entry" | "trends">("entry");

  const loadHistory = useCallback(async () => {
    if (!patientId) return;
    try {
      const data = await api.get<{ sessions: BrainSession[] }>(`/api/radiology-brain/sessions?patientId=${patientId}&limit=10`);
      setSessions(data.sessions);
    } catch { /* ignore */ }
  }, [patientId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const set = (field: StringField, value: string) => setForm((f) => ({ ...f, [field]: value }));
  const setBool = (field: BoolField, value: boolean) => setForm((f) => ({ ...f, [field]: value }));

  const handleSave = async () => {
    if (!patientId) { toast({ title: "No patient selected", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await api.post("/api/radiology-brain/sessions", { patientId, orderId, studyId, modality, ...form });
      toast({ title: "Brain session saved", description: "AI Draft — Requires Radiologist Review" });
      setForm(initialForm());
      loadHistory();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const SField = ({ label, field, options }: { label: string; field: StringField; options: string[] }) => (
    <div>
      <Label className="text-[10px]">{label}</Label>
      <select value={form[field]} onChange={(e) => set(field, e.target.value)}
        className="w-full border rounded px-1.5 py-1 text-xs mt-0.5 bg-background">
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );

  const NumField = ({ label, field, unit }: { label: string; field: StringField; unit?: string }) => (
    <div>
      <Label className="text-[10px]">{label}{unit ? ` (${unit})` : ""}</Label>
      <input type="number" step="0.01" value={form[field]} onChange={(e) => set(field, e.target.value)}
        className="w-full border rounded px-1.5 py-1 text-xs mt-0.5 bg-background" placeholder="—" />
    </div>
  );

  const BoolCheck = ({ label, field }: { label: string; field: BoolField }) => (
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input type="checkbox" checked={form[field]} onChange={(e) => setBool(field, e.target.checked)} className="h-3.5 w-3.5" />
      <span className="text-[11px]">{label}</span>
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Brain size={16} className="text-primary" />
        <span className="font-semibold text-sm">Brain Intelligence</span>
        <Badge variant="outline" className="text-[10px]">Phase 10B</Badge>
        <div className="flex-1" />
        <button onClick={() => setTab("entry")} className={`text-xs px-2.5 py-1 rounded-lg transition ${tab === "entry" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>Entry</button>
        <button onClick={() => setTab("trends")} className={`text-xs px-2.5 py-1 rounded-lg transition ${tab === "trends" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>Trends ({sessions.length})</button>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-[11px] text-yellow-800">
        AI Draft — Requires Radiologist Review
      </div>

      {tab === "entry" && (
        <div className="space-y-3">
          {/* Midline + Ventricles */}
          <div className="border border-card-border rounded-lg p-3 space-y-2">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">Global Parameters</span>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Midline Shift" field="midlineShift" unit="mm" />
              <SField label="Direction" field="midlineShiftDirection" options={["none", "left", "right"]} />
              <SField label="Ventricle Size" field="ventricleSizeStatus" options={VENTRICLE_OPTS} />
              <SField label="Hydrocephalus" field="hydrocephalus" options={HYDRO_OPTS} />
              <SField label="Cortical Atrophy" field="corticalAtrophy" options={ATROPHY_OPTS} />
              <SField label="WM Changes" field="wmChanges" options={WM_OPTS} />
            </div>
          </div>

          {/* Infarct */}
          <div className="border border-card-border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={form.infarctPresent} onChange={(e) => setBool("infarctPresent", e.target.checked)} className="h-3.5 w-3.5" />
              <span className="text-[11px] font-semibold uppercase text-muted-foreground">Infarct</span>
            </div>
            {form.infarctPresent && (
              <div className="grid grid-cols-2 gap-2">
                <NumField label="Size" field="infarctSizeMm" unit="mm" />
                <SField label="Phase" field="infarctPhase" options={INFARCT_PHASE_OPTS} />
                <SField label="Territory" field="infarctTerritory" options={INFARCT_TERRITORY_OPTS} />
              </div>
            )}
          </div>

          {/* Hemorrhage */}
          <div className="border border-card-border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={form.hemorrhagePresent} onChange={(e) => setBool("hemorrhagePresent", e.target.checked)} className="h-3.5 w-3.5" />
              <span className="text-[11px] font-semibold uppercase text-muted-foreground">Hemorrhage</span>
            </div>
            {form.hemorrhagePresent && (
              <div className="grid grid-cols-2 gap-2">
                <NumField label="Size" field="hemorrhageSizeMm" unit="mm" />
                <SField label="Type" field="hemorrhageType" options={HEMORRHAGE_TYPE_OPTS} />
              </div>
            )}
          </div>

          {/* Mass */}
          <div className="border border-card-border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={form.massPresent} onChange={(e) => setBool("massPresent", e.target.checked)} className="h-3.5 w-3.5" />
              <span className="text-[11px] font-semibold uppercase text-muted-foreground">Mass / Tumor</span>
            </div>
            {form.massPresent && (
              <div className="grid grid-cols-2 gap-2">
                <NumField label="Volume" field="massVolumeCc" unit="cc" />
                <SField label="Enhancement" field="massEnhancement" options={ENHANCEMENT_OPTS} />
                <SField label="Mass Effect" field="massEffect" options={EFFECT_OPTS} />
              </div>
            )}
          </div>

          {/* Edema */}
          <div className="border border-card-border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={form.edemaPresent} onChange={(e) => setBool("edemaPresent", e.target.checked)} className="h-3.5 w-3.5" />
              <span className="text-[11px] font-semibold uppercase text-muted-foreground">Edema</span>
            </div>
            {form.edemaPresent && (
              <div className="grid grid-cols-2 gap-2">
                <SField label="Severity" field="edemaSeverity" options={EFFECT_OPTS} />
                <SField label="Type" field="edemaType" options={["vasogenic", "cytotoxic", "mixed"]} />
              </div>
            )}
          </div>

          {/* Posterior fossa */}
          <div className="flex flex-wrap gap-3">
            <BoolCheck label="Cerebellum Normal" field="cerebellumNormal" />
            <BoolCheck label="Brainstem Normal" field="brainstemNormal" />
          </div>

          {/* Overall */}
          <div>
            <Label className="text-xs">Overall Impression</Label>
            <Textarea value={form.overallImpression} onChange={(e) => set("overallImpression", e.target.value)}
              rows={3} className="text-xs mt-1" placeholder="Summarise key findings..." />
          </div>

          <Button onClick={handleSave} disabled={saving || !patientId} className="w-full" size="sm">
            <Save size={14} className="mr-1.5" /> {saving ? "Saving..." : "Save Brain Session"}
          </Button>
        </div>
      )}

      {tab === "trends" && (
        <div className="space-y-3">
          {sessions.length < 2 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {sessions.length === 0 ? "No brain sessions recorded yet." : "Need ≥ 2 sessions to show trends."}
            </div>
          ) : (
            <>
              <TrendSparkline sessions={sessions} field="midlineShift" label="Midline Shift (mm)" />
              <TrendSparkline sessions={sessions} field="infarctSizeMm" label="Infarct Size (mm)" />
              <TrendSparkline sessions={sessions} field="hemorrhageSizeMm" label="Hemorrhage Size (mm)" />
              <TrendSparkline sessions={sessions} field="massVolumeCc" label="Mass Volume (cc)" />

              <div className="text-xs font-semibold text-muted-foreground uppercase mt-2">Recent Sessions</div>
              {sessions.slice(0, 5).map((s) => (
                <div key={s.id} className="border border-card-border rounded p-2.5 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <Clock size={11} className="text-muted-foreground" />
                    <span className="font-medium">{s.studyDate ? new Date(s.studyDate).toLocaleDateString("en-IN") : new Date(s.createdAt).toLocaleDateString("en-IN")}</span>
                    {s.recordedByName && <span className="text-muted-foreground">· {s.recordedByName}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.midlineShift && Number(s.midlineShift) > 0 && <Badge className="text-[9px] bg-orange-100 text-orange-700">MLS {s.midlineShift}mm {s.midlineShiftDirection}</Badge>}
                    {s.infarctPresent && <Badge className="text-[9px] bg-red-100 text-red-700">Infarct {s.infarctSizeMm}mm</Badge>}
                    {s.hemorrhagePresent && <Badge className="text-[9px] bg-rose-100 text-rose-800">Hemorrhage {s.hemorrhageSizeMm}mm</Badge>}
                    {s.massPresent && <Badge className="text-[9px] bg-purple-100 text-purple-700">Mass {s.massVolumeCc}cc</Badge>}
                    {s.hydrocephalus && s.hydrocephalus !== "none" && <Badge className="text-[9px] bg-blue-100 text-blue-700">Hydrocephalus</Badge>}
                  </div>
                  {s.overallImpression && <p className="text-muted-foreground leading-relaxed">{s.overallImpression}</p>}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
