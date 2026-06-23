/**
 * Phase 10C: Image Annotation Toolbar
 * Overlay toolbar for annotating DICOM key images.
 * Annotations are metadata records (not pixel edits).
 * AI Draft – Requires Radiologist Review
 */
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/fetchApi";
import {
  ArrowRight, Circle, Ruler, Type, MessageSquare, Plus, Trash2,
  ChevronDown, ChevronUp, Save, Pencil, BookOpen,
} from "lucide-react";

interface Annotation {
  id: number;
  annotationType: string;
  labelText: string | null;
  color: string | null;
  coordinates: unknown;
  isKeyAnnotation: boolean;
  linkedTeachingCaseId: number | null;
  createdByName: string | null;
  createdAt: string;
}

interface Props {
  studyInstanceUid?: string | null;
  seriesInstanceUid?: string | null;
  sopInstanceUid?: string | null;
  orderId?: number;
  patientId?: number;
  studyId?: number;
}

const ANNOTATION_TYPES = [
  { id: "arrow", label: "Arrow", icon: ArrowRight },
  { id: "circle", label: "Circle", icon: Circle },
  { id: "measurement", label: "Measurement", icon: Ruler },
  { id: "label", label: "Label", icon: Type },
  { id: "teaching_note", label: "Teaching Note", icon: MessageSquare },
];

const ANNOTATION_COLORS = ["#FFFF00", "#FF4444", "#44FF44", "#4488FF", "#FF8800", "#FF44FF"];

const TYPE_COLORS: Record<string, string> = {
  arrow: "text-yellow-600",
  circle: "text-blue-600",
  measurement: "text-green-600",
  label: "text-purple-600",
  teaching_note: "text-orange-600",
};

export default function ImageAnnotationToolbar({
  studyInstanceUid, seriesInstanceUid, sopInstanceUid, orderId, patientId, studyId,
}: Props) {
  const { toast } = useToast();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedType, setSelectedType] = useState("arrow");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#FFFF00");
  const [isKey, setIsKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [coordX, setCoordX] = useState("");
  const [coordY, setCoordY] = useState("")
  const [coordW, setCoordW] = useState("");
  const [coordH, setCoordH] = useState("");

  const loadAnnotations = useCallback(async () => {
    if (!studyInstanceUid && !orderId) return;
    try {
      const params = studyInstanceUid
        ? `?studyInstanceUid=${encodeURIComponent(studyInstanceUid)}`
        : `?orderId=${orderId}`;
      const data = await api.get<{ annotations: Annotation[] }>(`/api/radiology-annotations${params}`);
      setAnnotations(data.annotations);
    } catch { /* ignore */ }
  }, [studyInstanceUid, orderId]);

  useEffect(() => { loadAnnotations(); }, [loadAnnotations]);

  const handleSave = async () => {
    if (!studyInstanceUid) { toast({ title: "No study UID available", variant: "destructive" }); return; }
    if (!label.trim() && selectedType !== "arrow" && selectedType !== "circle") {
      toast({ title: "Enter a label for this annotation", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const x = coordX !== "" ? parseFloat(coordX) : undefined;
      const y = coordY !== "" ? parseFloat(coordY) : undefined;
      const w = coordW !== "" ? parseFloat(coordW) : undefined;
      const h = coordH !== "" ? parseFloat(coordH) : undefined;
      const coordinates = (x !== undefined || y !== undefined)
        ? { x: x ?? 0, y: y ?? 0, width: w, height: h, normalized: true }
        : null;
      await api.post("/api/radiology-annotations", {
        studyInstanceUid,
        seriesInstanceUid: seriesInstanceUid ?? null,
        sopInstanceUid: sopInstanceUid ?? null,
        annotationType: selectedType,
        labelText: label.trim() || null,
        color,
        isKeyAnnotation: isKey,
        coordinates,
        orderId: orderId ?? null,
        patientId: patientId ?? null,
        studyId: studyId ?? null,
      });
      toast({ title: "Annotation saved" });
      setLabel("");
      setIsKey(false);
      setCoordX(""); setCoordY(""); setCoordW(""); setCoordH("");
      setShowForm(false);
      loadAnnotations();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this annotation?")) return;
    try {
      await api.delete(`/api/radiology-annotations/${id}`);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      toast({ title: "Annotation deleted" });
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  };

  if (!studyInstanceUid) {
    return (
      <div className="text-[11px] text-muted-foreground text-center py-4 border border-dashed border-card-border rounded-lg">
        No DICOM study loaded. Open a study to annotate images.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Pencil size={14} className="text-primary" />
        <span className="font-semibold text-xs">Image Annotations</span>
        <Badge variant="outline" className="text-[10px]">{annotations.length}</Badge>
        <div className="flex-1" />
        <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1 text-xs text-primary hover:underline">
          <Plus size={12} /> Add
        </button>
        <button onClick={() => setExpanded((v) => !v)} className="text-muted-foreground">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {expanded && (
        <>
          {/* Add annotation form */}
          {showForm && (
            <div className="border border-primary/20 bg-primary/5 rounded-lg p-3 space-y-3">
              {/* Type selector */}
              <div className="flex flex-wrap gap-1.5">
                {ANNOTATION_TYPES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedType(t.id)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition ${
                      selectedType === t.id ? "bg-primary text-white border-transparent" : "bg-muted border-card-border text-muted-foreground"
                    }`}
                  >
                    <t.icon size={11} /> {t.label}
                  </button>
                ))}
              </div>

              {/* Label input */}
              <div>
                <Label className="text-[10px]">Label / Note</Label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={selectedType === "teaching_note" ? "Teaching note text..." : selectedType === "measurement" ? "e.g. 14.5 mm" : "Annotation label..."}
                  className="h-7 text-xs mt-0.5"
                />
              </div>

              {/* Color picker */}
              <div>
                <Label className="text-[10px]">Color</Label>
                <div className="flex gap-1.5 mt-1">
                  {ANNOTATION_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-5 h-5 rounded-full border-2 transition ${color === c ? "border-foreground scale-110" : "border-transparent"}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Image coordinates (normalized 0–1 relative to image size) */}
              <div>
                <Label className="text-[10px]">Image Coordinates (0–1, optional)</Label>
                <div className="grid grid-cols-4 gap-1 mt-1">
                  <div>
                    <span className="text-[9px] text-muted-foreground">X</span>
                    <Input type="number" min="0" max="1" step="0.01" value={coordX} onChange={(e) => setCoordX(e.target.value)} placeholder="0.5" className="h-6 text-[11px] px-1" />
                  </div>
                  <div>
                    <span className="text-[9px] text-muted-foreground">Y</span>
                    <Input type="number" min="0" max="1" step="0.01" value={coordY} onChange={(e) => setCoordY(e.target.value)} placeholder="0.5" className="h-6 text-[11px] px-1" />
                  </div>
                  <div>
                    <span className="text-[9px] text-muted-foreground">W</span>
                    <Input type="number" min="0" max="1" step="0.01" value={coordW} onChange={(e) => setCoordW(e.target.value)} placeholder="0.1" className="h-6 text-[11px] px-1" />
                  </div>
                  <div>
                    <span className="text-[9px] text-muted-foreground">H</span>
                    <Input type="number" min="0" max="1" step="0.01" value={coordH} onChange={(e) => setCoordH(e.target.value)} placeholder="0.1" className="h-6 text-[11px] px-1" />
                  </div>
                </div>
                <p className="text-[9px] text-muted-foreground mt-0.5">Normalized coordinates relative to image dimensions (0 = left/top, 1 = right/bottom)</p>
              </div>

              {/* Key annotation */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isKey} onChange={(e) => setIsKey(e.target.checked)} className="h-3.5 w-3.5" />
                <BookOpen size={11} className="text-muted-foreground" />
                <span className="text-[11px]">Mark as key teaching image</span>
              </label>

              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving} className="text-xs h-7">
                  <Save size={12} className="mr-1" /> {saving ? "Saving..." : "Save Annotation"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowForm(false)} className="text-xs h-7">Cancel</Button>
              </div>
            </div>
          )}

          {/* Annotations list */}
          {annotations.length === 0 ? (
            <div className="text-[11px] text-muted-foreground text-center py-3">
              No annotations yet. Click Add to annotate this study.
            </div>
          ) : (
            <div className="space-y-1">
              {annotations.map((a) => (
                <div key={a.id} className="flex items-start gap-2 px-2 py-1.5 rounded border border-card-border text-[11px] group hover:bg-muted/20">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-none mt-0.5 border"
                    style={{ backgroundColor: a.color ?? "#FFFF00" }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-medium capitalize ${TYPE_COLORS[a.annotationType] ?? ""}`}>{a.annotationType.replace("_", " ")}</span>
                      {a.isKeyAnnotation && <Badge className="text-[9px] bg-orange-100 text-orange-700 px-1">Key</Badge>}
                    </div>
                    {a.labelText && <div className="text-muted-foreground truncate">{a.labelText}</div>}
                    <div className="text-[10px] text-muted-foreground">
                      {a.createdByName && `${a.createdByName} · `}
                      {new Date(a.createdAt).toLocaleDateString("en-IN")}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(a.id)}
                    className="opacity-0 group-hover:opacity-100 text-destructive transition"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
