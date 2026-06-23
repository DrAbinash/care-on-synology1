/**
 * Phase 10B: Spine Intelligence Panel
 * Structured per-level spine assessment with longitudinal comparison.
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
import {
  Plus, ChevronDown, ChevronUp, Save, RotateCcw, AlertTriangle, CheckCircle,
  Layers, GitCompare, Clock,
} from "lucide-react";

interface SpineLevel {
  level: string;
  discStatus: string;
  discHeight: string;
  canalDiameter: string;
  canalStenosis: string;
  foraminalStenosis: string;
  cordCompression: boolean;
  cordSignalChange: boolean;
  nerveRootCompression: string;
  vertebralCollapse: boolean;
  compressionFracture: boolean;
  modicChange: string;
  schmorlNode: boolean;
  spondylolisthesis: string;
  facetArthrosis: string;
  notes: string;
}

interface SpineSession {
  id: number;
  region: string | null;
  overallImpression: string | null;
  studyDate: string | null;
  createdAt: string;
  recordedByName: string | null;
}

interface Props {
  patientId?: number;
  orderId?: number;
  studyId?: number;
  modality?: string;
}

const DISC_STATUSES = ["normal", "bulge", "protrusion", "extrusion", "sequestration"];
const DISC_HEIGHTS = ["maintained", "reduced_mild", "reduced_moderate", "reduced_severe", "collapsed"];
const STENOSIS_LEVELS = ["none", "mild", "moderate", "severe"];
const MODIC_TYPES = ["none", "type_1", "type_2", "type_3"];
const SPONDYLO_GRADES = ["none", "grade_1", "grade_2", "grade_3", "grade_4"];
const FORAMINAL_OPTS = ["none", "mild_left", "mild_right", "mild_bilateral", "moderate_left", "moderate_right", "moderate_bilateral", "severe_left", "severe_right", "severe_bilateral"];
const NERVE_ROOT_OPTS = ["none", "left", "right", "bilateral"];

const COMMON_LEVELS_LUMBAR = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"];
const COMMON_LEVELS_CERVICAL = ["C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1"];
const COMMON_LEVELS_THORACIC = ["T6-T7", "T7-T8", "T8-T9", "T9-T10", "T10-T11", "T11-T12", "T12-L1"];

function defaultLevel(level: string): SpineLevel {
  return {
    level, discStatus: "normal", discHeight: "maintained", canalDiameter: "",
    canalStenosis: "none", foraminalStenosis: "none", cordCompression: false,
    cordSignalChange: false, nerveRootCompression: "none", vertebralCollapse: false,
    compressionFracture: false, modicChange: "none", schmorlNode: false,
    spondylolisthesis: "none", facetArthrosis: "none", notes: "",
  };
}

const SEVERITY_COLOR: Record<string, string> = {
  none: "bg-green-100 text-green-700",
  mild: "bg-yellow-100 text-yellow-700",
  mild_left: "bg-yellow-100 text-yellow-700",
  mild_right: "bg-yellow-100 text-yellow-700",
  mild_bilateral: "bg-yellow-100 text-yellow-700",
  moderate: "bg-orange-100 text-orange-700",
  moderate_left: "bg-orange-100 text-orange-700",
  moderate_right: "bg-orange-100 text-orange-700",
  moderate_bilateral: "bg-orange-100 text-orange-700",
  severe: "bg-red-100 text-red-700",
  severe_left: "bg-red-100 text-red-700",
  severe_right: "bg-red-100 text-red-700",
  severe_bilateral: "bg-red-100 text-red-700",
  normal: "bg-green-100 text-green-700",
  bulge: "bg-yellow-100 text-yellow-700",
  protrusion: "bg-orange-100 text-orange-700",
  extrusion: "bg-red-100 text-red-700",
  sequestration: "bg-rose-100 text-rose-800",
};

export default function SpineIntelligencePanel({ patientId, orderId, studyId, modality }: Props) {
  const { toast } = useToast();
  const [region, setRegion] = useState("lumbar");
  const [levels, setLevels] = useState<SpineLevel[]>(COMMON_LEVELS_LUMBAR.map(defaultLevel));
  const [overallImpression, setOverallImpression] = useState("");
  const [expandedLevel, setExpandedLevel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sessions, setSessions] = useState<SpineSession[]>([]);
  const [tab, setTab] = useState<"entry" | "history">("entry");

  const loadHistory = useCallback(async () => {
    if (!patientId) return;
    try {
      const data = await api.get<{ sessions: SpineSession[] }>(`/api/radiology-spine/sessions?patientId=${patientId}`);
      setSessions(data.sessions);
    } catch { /* ignore */ }
  }, [patientId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleRegionChange = (r: string) => {
    setRegion(r);
    const levelList = r === "cervical" ? COMMON_LEVELS_CERVICAL : r === "thoracic" ? COMMON_LEVELS_THORACIC : COMMON_LEVELS_LUMBAR;
    setLevels(levelList.map(defaultLevel));
  };

  const updateLevel = (idx: number, field: keyof SpineLevel, value: string | boolean) => {
    setLevels((prev) => prev.map((lv, i) => i === idx ? { ...lv, [field]: value } : lv));
  };

  const addCustomLevel = () => {
    const lv = prompt("Enter level (e.g. L3-L4):");
    if (lv?.trim()) setLevels((prev) => [...prev, defaultLevel(lv.trim())]);
  };

  const removeLevel = (idx: number) => {
    setLevels((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!patientId) { toast({ title: "No patient selected", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await api.post("/api/radiology-spine/sessions", {
        patientId, orderId, studyId, modality,
        region, overallImpression,
        levels: levels.map((lv) => ({ ...lv, canalDiameter: lv.canalDiameter || null })),
      });
      toast({ title: "Spine session saved", description: "AI Draft — Requires Radiologist Review" });
      loadHistory();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Layers size={16} className="text-primary" />
        <span className="font-semibold text-sm">Spine Intelligence</span>
        <Badge variant="outline" className="text-[10px]">Phase 10B</Badge>
        <div className="flex-1" />
        <button
          onClick={() => setTab("entry")}
          className={`text-xs px-2.5 py-1 rounded-lg transition ${tab === "entry" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}
        >Entry</button>
        <button
          onClick={() => setTab("history")}
          className={`text-xs px-2.5 py-1 rounded-lg transition ${tab === "history" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}
        >History ({sessions.length})</button>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-[11px] text-yellow-800">
        AI Draft — Requires Radiologist Review
      </div>

      {tab === "entry" && (
        <div className="space-y-3">
          {/* Region selector */}
          <div className="flex gap-2">
            {["cervical", "thoracic", "lumbar"].map((r) => (
              <button
                key={r}
                onClick={() => handleRegionChange(r)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition capitalize ${region === r ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
              >{r}</button>
            ))}
          </div>

          {/* Level entries */}
          <div className="space-y-1.5">
            {levels.map((lv, idx) => {
              const isExpanded = expandedLevel === lv.level;
              const hasFlag = lv.cordCompression || lv.nerveRootCompression !== "none" || lv.canalStenosis === "severe" || lv.discStatus === "extrusion" || lv.discStatus === "sequestration";

              return (
                <div key={lv.level} className={`border rounded-lg overflow-hidden ${hasFlag ? "border-orange-200" : "border-card-border"}`}>
                  <div
                    className="flex items-center gap-2 px-3 py-2 bg-muted/30 cursor-pointer hover:bg-muted/50 transition"
                    onClick={() => setExpandedLevel(isExpanded ? null : lv.level)}
                  >
                    <span className="font-mono font-bold text-xs w-14">{lv.level}</span>
                    <div className="flex flex-wrap gap-1 flex-1">
                      {lv.discStatus !== "normal" && (
                        <Badge className={`text-[9px] px-1.5 py-0 ${SEVERITY_COLOR[lv.discStatus] ?? "bg-gray-100"}`}>{lv.discStatus}</Badge>
                      )}
                      {lv.canalStenosis !== "none" && (
                        <Badge className={`text-[9px] px-1.5 py-0 ${SEVERITY_COLOR[lv.canalStenosis] ?? "bg-gray-100"}`}>canal {lv.canalStenosis}</Badge>
                      )}
                      {lv.cordCompression && <Badge className="text-[9px] px-1.5 py-0 bg-red-100 text-red-700">cord compress</Badge>}
                      {lv.spondylolisthesis !== "none" && <Badge className="text-[9px] px-1.5 py-0 bg-orange-100 text-orange-700">spondylo {lv.spondylolisthesis}</Badge>}
                    </div>
                    {hasFlag && <AlertTriangle size={12} className="text-orange-500" />}
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    <button className="ml-1 text-muted-foreground hover:text-destructive text-[10px]" onClick={(e) => { e.stopPropagation(); removeLevel(idx); }}>✕</button>
                  </div>

                  {isExpanded && (
                    <div className="p-3 grid grid-cols-2 gap-2.5 text-xs">
                      {/* Disc */}
                      <div>
                        <Label className="text-[10px]">Disc Status</Label>
                        <select value={lv.discStatus} onChange={(e) => updateLevel(idx, "discStatus", e.target.value)}
                          className="w-full border rounded px-1.5 py-1 text-xs mt-0.5 bg-background">
                          {DISC_STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <Label className="text-[10px]">Disc Height</Label>
                        <select value={lv.discHeight} onChange={(e) => updateLevel(idx, "discHeight", e.target.value)}
                          className="w-full border rounded px-1.5 py-1 text-xs mt-0.5 bg-background">
                          {DISC_HEIGHTS.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                      {/* Canal */}
                      <div>
                        <Label className="text-[10px]">Canal Diameter (mm)</Label>
                        <Input value={lv.canalDiameter} onChange={(e) => updateLevel(idx, "canalDiameter", e.target.value)}
                          placeholder="e.g. 12.5" className="h-7 text-xs mt-0.5" type="number" step="0.1" />
                      </div>
                      <div>
                        <Label className="text-[10px]">Canal Stenosis</Label>
                        <select value={lv.canalStenosis} onChange={(e) => updateLevel(idx, "canalStenosis", e.target.value)}
                          className="w-full border rounded px-1.5 py-1 text-xs mt-0.5 bg-background">
                          {STENOSIS_LEVELS.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                      {/* Foraminal */}
                      <div>
                        <Label className="text-[10px]">Foraminal Stenosis</Label>
                        <select value={lv.foraminalStenosis} onChange={(e) => updateLevel(idx, "foraminalStenosis", e.target.value)}
                          className="w-full border rounded px-1.5 py-1 text-xs mt-0.5 bg-background">
                          {FORAMINAL_OPTS.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <Label className="text-[10px]">Nerve Root</Label>
                        <select value={lv.nerveRootCompression} onChange={(e) => updateLevel(idx, "nerveRootCompression", e.target.value)}
                          className="w-full border rounded px-1.5 py-1 text-xs mt-0.5 bg-background">
                          {NERVE_ROOT_OPTS.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                      {/* Modic */}
                      <div>
                        <Label className="text-[10px]">Modic Change</Label>
                        <select value={lv.modicChange} onChange={(e) => updateLevel(idx, "modicChange", e.target.value)}
                          className="w-full border rounded px-1.5 py-1 text-xs mt-0.5 bg-background">
                          {MODIC_TYPES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <Label className="text-[10px]">Spondylolisthesis</Label>
                        <select value={lv.spondylolisthesis} onChange={(e) => updateLevel(idx, "spondylolisthesis", e.target.value)}
                          className="w-full border rounded px-1.5 py-1 text-xs mt-0.5 bg-background">
                          {SPONDYLO_GRADES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                      {/* Checkboxes */}
                      <div className="col-span-2 flex flex-wrap gap-3">
                        {([
                          ["cordCompression", "Cord Compression"],
                          ["cordSignalChange", "Cord Signal Change"],
                          ["vertebralCollapse", "Vertebral Collapse"],
                          ["compressionFracture", "Compression Fracture"],
                          ["schmorlNode", "Schmorl Node"],
                        ] as [keyof SpineLevel, string][]).map(([field, label]) => (
                          <label key={field} className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={Boolean(lv[field])} onChange={(e) => updateLevel(idx, field, e.target.checked)} className="h-3.5 w-3.5" />
                            <span className="text-[11px]">{label}</span>
                          </label>
                        ))}
                      </div>
                      {/* Notes */}
                      <div className="col-span-2">
                        <Label className="text-[10px]">Notes</Label>
                        <Textarea value={lv.notes} onChange={(e) => updateLevel(idx, "notes", e.target.value)}
                          rows={2} className="text-xs mt-0.5" placeholder="Any additional findings..." />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addCustomLevel} className="text-xs">
              <Plus size={12} className="mr-1" /> Add Level
            </Button>
          </div>

          {/* Overall impression */}
          <div>
            <Label className="text-xs">Overall Impression</Label>
            <Textarea value={overallImpression} onChange={(e) => setOverallImpression(e.target.value)}
              rows={3} className="text-xs mt-1" placeholder="Overall spinal canal status, significant findings..." />
          </div>

          <Button onClick={handleSave} disabled={saving || !patientId} className="w-full" size="sm">
            <Save size={14} className="mr-1.5" /> {saving ? "Saving..." : "Save Spine Session"}
          </Button>
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-2">
          {sessions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No spine sessions recorded yet.</div>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="border border-card-border rounded-lg p-3 text-xs space-y-1">
                <div className="flex items-center gap-2">
                  <Clock size={12} className="text-muted-foreground" />
                  <span className="font-medium">{s.studyDate ? new Date(s.studyDate).toLocaleDateString("en-IN") : new Date(s.createdAt).toLocaleDateString("en-IN")}</span>
                  {s.region && <Badge variant="outline" className="text-[10px] capitalize">{s.region}</Badge>}
                  {s.recordedByName && <span className="text-muted-foreground">by {s.recordedByName}</span>}
                </div>
                {s.overallImpression && (
                  <p className="text-muted-foreground leading-relaxed">{s.overallImpression}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
