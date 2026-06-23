/**
 * Phase 10A: Lesion Tracker Panel
 * Longitudinal lesion monitoring — create lesions, add timeline entries, view trend.
 * AI Draft – Requires Radiologist Review
 */
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Target, Plus, ChevronDown, ChevronUp, Clock, TrendingUp, TrendingDown,
  Minus, AlertTriangle, CheckCircle, X, Calendar, User,
} from "lucide-react";

interface Lesion {
  id: number;
  patientId: number;
  lesionLabel: string;
  location: string;
  organ: string | null;
  modality: string;
  bodyPart: string | null;
  lesionType: string | null;
  classification: string | null;
  classificationValue: string | null;
  status: string;
  isResolved: boolean;
  notes: string | null;
  firstDetectedAt: string | null;
  firstDetectedBy: string | null;
  createdAt: string;
}

interface TimelineEntry {
  id: number;
  lesionId: number;
  measurementMm: number | null;
  measurementMm2: number | null;
  measurementMm3: number | null;
  changeStatus: string | null;
  changePercent: number | null;
  signalCharacteristics: string | null;
  enhancement: string | null;
  reportedBy: string | null;
  reportedAt: string | null;
  notes: string | null;
  seriesNumber: string | null;
  imageNumber: string | null;
}

interface Props {
  patientId?: number;
  studyId?: number;
  orderId?: number;
  modality?: string;
  bodyPart?: string;
}

const CHANGE_STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof TrendingUp }> = {
  improved: { label: "Improved", color: "text-green-700 bg-green-100", icon: TrendingDown },
  stable: { label: "Stable", color: "text-blue-700 bg-blue-100", icon: Minus },
  progressed: { label: "Progressed", color: "text-red-700 bg-red-100", icon: TrendingUp },
  new: { label: "New", color: "text-orange-700 bg-orange-100", icon: Plus },
  resolved: { label: "Resolved", color: "text-purple-700 bg-purple-100", icon: CheckCircle },
};

export default function LesionTrackerPanel({ patientId, studyId, orderId, modality, bodyPart }: Props) {
  const { toast } = useToast();
  const [lesions, setLesions] = useState<Lesion[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedLesion, setExpandedLesion] = useState<number | null>(null);
  const [timelines, setTimelines] = useState<Record<number, TimelineEntry[]>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState<number | null>(null);

  // Add lesion form state
  const [newLabel, setNewLabel] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newOrgan, setNewOrgan] = useState("");
  const [newLesionType, setNewLesionType] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Add timeline entry form state
  const [entryMm, setEntryMm] = useState("");
  const [entryMm2, setEntryMm2] = useState("");
  const [entryChangeStatus, setEntryChangeStatus] = useState<string>("");
  const [entrySeries, setEntrySeries] = useState("");
  const [entryImage, setEntryImage] = useState("");
  const [entryNotes, setEntryNotes] = useState("");
  const [savingEntry, setSavingEntry] = useState(false);

  const fetchLesions = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/radiology-lesions?patientId=${patientId}`);
      const data = await r.json();
      setLesions(data.lesions ?? []);
    } catch {
      toast({ title: "Could not load lesions", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [patientId, toast]);

  useEffect(() => { fetchLesions(); }, [fetchLesions]);

  const fetchTimeline = useCallback(async (lesionId: number) => {
    if (timelines[lesionId]) return;
    try {
      const r = await fetch(`/api/radiology-lesions/${lesionId}/timeline`);
      const data = await r.json();
      setTimelines((prev) => ({ ...prev, [lesionId]: data.entries ?? [] }));
    } catch { /* ignore */ }
  }, [timelines]);

  const handleExpandLesion = (id: number) => {
    if (expandedLesion === id) {
      setExpandedLesion(null);
    } else {
      setExpandedLesion(id);
      fetchTimeline(id);
    }
  };

  const handleAddLesion = async () => {
    if (!newLabel.trim() || !newLocation.trim() || !patientId) return;
    setSaving(true);
    try {
      const r = await fetch("/api/radiology-lesions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          lesionLabel: newLabel.trim(),
          location: newLocation.trim(),
          organ: newOrgan.trim() || undefined,
          modality: modality || "Unknown",
          bodyPart: bodyPart || undefined,
          firstStudyId: studyId,
          firstOrderId: orderId,
          lesionType: newLesionType.trim() || undefined,
          notes: newNotes.trim() || undefined,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      toast({ title: "Lesion added to tracker" });
      setShowAddForm(false);
      setNewLabel(""); setNewLocation(""); setNewOrgan(""); setNewLesionType(""); setNewNotes("");
      fetchLesions();
    } catch {
      toast({ title: "Could not add lesion", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddTimelineEntry = async (lesionId: number) => {
    setSavingEntry(true);
    try {
      const r = await fetch(`/api/radiology-lesions/${lesionId}/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyId,
          orderId,
          measurementMm: entryMm ? Number(entryMm) : undefined,
          measurementMm2: entryMm2 ? Number(entryMm2) : undefined,
          changeStatus: entryChangeStatus || undefined,
          seriesNumber: entrySeries || undefined,
          imageNumber: entryImage || undefined,
          notes: entryNotes || undefined,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      toast({ title: "Timeline entry added" });
      setShowAddEntry(null);
      setEntryMm(""); setEntryMm2(""); setEntryChangeStatus(""); setEntrySeries(""); setEntryImage(""); setEntryNotes("");
      // Invalidate cached timeline so it re-fetches
      setTimelines((prev) => { const next = { ...prev }; delete next[lesionId]; return next; });
      fetchTimeline(lesionId);
    } catch {
      toast({ title: "Could not add entry", variant: "destructive" });
    } finally {
      setSavingEntry(false);
    }
  };

  if (!patientId) {
    return (
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center gap-2">
          <Target size={14} className="text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lesion Tracker</span>
        </div>
        <div className="p-4 text-center text-xs text-muted-foreground">Select a patient to track lesions.</div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target size={14} className="text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lesion Tracker</span>
          {lesions.length > 0 && (
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{lesions.length}</span>
          )}
        </div>
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowAddForm(!showAddForm)}>
          <Plus size={11} className="mr-1" /> Add Lesion
        </Button>
      </div>

      {/* Add lesion form */}
      {showAddForm && (
        <div className="p-3 border-b border-border bg-muted/10 space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground">New Lesion Entry</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Label *</Label>
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className="h-7 text-xs mt-0.5" placeholder="e.g. Right temporal lesion" />
            </div>
            <div>
              <Label className="text-[10px]">Location *</Label>
              <Input value={newLocation} onChange={(e) => setNewLocation(e.target.value)} className="h-7 text-xs mt-0.5" placeholder="e.g. Right temporal lobe" />
            </div>
            <div>
              <Label className="text-[10px]">Organ / Region</Label>
              <Input value={newOrgan} onChange={(e) => setNewOrgan(e.target.value)} className="h-7 text-xs mt-0.5" placeholder="e.g. Brain" />
            </div>
            <div>
              <Label className="text-[10px]">Type</Label>
              <Input value={newLesionType} onChange={(e) => setNewLesionType(e.target.value)} className="h-7 text-xs mt-0.5" placeholder="e.g. Cystic, Solid, Mixed" />
            </div>
          </div>
          <div>
            <Label className="text-[10px]">Notes</Label>
            <Textarea value={newNotes} onChange={(e) => setNewNotes(e.target.value)} className="text-xs h-12 mt-0.5 resize-none" placeholder="Optional notes..." />
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="text-xs h-7" onClick={handleAddLesion} disabled={saving || !newLabel.trim() || !newLocation.trim()}>
              {saving ? "Saving..." : "Save Lesion"}
            </Button>
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setShowAddForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">Loading lesions...</div>
        ) : lesions.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            No tracked lesions yet. Click "Add Lesion" to start tracking.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {lesions.map((lesion) => (
              <div key={lesion.id}>
                <button
                  className="w-full px-3 py-2.5 text-left hover:bg-muted/20 transition-colors"
                  onClick={() => handleExpandLesion(lesion.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${lesion.isResolved ? "bg-gray-400" : "bg-orange-400"}`} />
                      <span className="text-xs font-medium truncate">{lesion.lesionLabel}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      <span className="text-[10px] text-muted-foreground">{lesion.modality}</span>
                      {expandedLesion === lesion.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 ml-4">{lesion.location}</div>
                </button>

                {expandedLesion === lesion.id && (
                  <div className="px-3 pb-3 pt-1 bg-muted/10 space-y-2.5">
                    {/* Lesion details */}
                    <div className="text-[11px] space-y-0.5">
                      {lesion.organ && <div><span className="text-muted-foreground">Organ:</span> {lesion.organ}</div>}
                      {lesion.lesionType && <div><span className="text-muted-foreground">Type:</span> {lesion.lesionType}</div>}
                      {lesion.classification && <div><span className="text-muted-foreground">Classification:</span> {lesion.classification} {lesion.classificationValue && `(${lesion.classificationValue})`}</div>}
                      {lesion.firstDetectedAt && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Calendar size={9} /> First detected: {new Date(lesion.firstDetectedAt).toLocaleDateString()}
                          {lesion.firstDetectedBy && <span className="flex items-center gap-0.5"><User size={9} />{lesion.firstDetectedBy}</span>}
                        </div>
                      )}
                      {lesion.notes && <div className="italic text-muted-foreground">{lesion.notes}</div>}
                    </div>

                    {/* Timeline */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-semibold uppercase text-muted-foreground flex items-center gap-1"><Clock size={9} /> Timeline</span>
                        <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5"
                          onClick={() => setShowAddEntry(showAddEntry === lesion.id ? null : lesion.id)}>
                          <Plus size={9} className="mr-0.5" /> Add Entry
                        </Button>
                      </div>

                      {/* Add entry form */}
                      {showAddEntry === lesion.id && (
                        <div className="mb-2 p-2 border border-border rounded-lg bg-card space-y-1.5">
                          <div className="grid grid-cols-2 gap-1.5">
                            <div>
                              <Label className="text-[9px]">Size (mm)</Label>
                              <Input value={entryMm} onChange={(e) => setEntryMm(e.target.value)} className="h-6 text-xs mt-0.5" type="number" placeholder="mm" />
                            </div>
                            <div>
                              <Label className="text-[9px]">Size 2nd axis (mm)</Label>
                              <Input value={entryMm2} onChange={(e) => setEntryMm2(e.target.value)} className="h-6 text-xs mt-0.5" type="number" placeholder="mm" />
                            </div>
                            <div>
                              <Label className="text-[9px]">Change Status</Label>
                              <select value={entryChangeStatus} onChange={(e) => setEntryChangeStatus(e.target.value)}
                                className="w-full h-6 text-xs mt-0.5 rounded border border-input bg-background px-1">
                                <option value="">— select —</option>
                                <option value="improved">Improved</option>
                                <option value="stable">Stable</option>
                                <option value="progressed">Progressed</option>
                                <option value="new">New</option>
                                <option value="resolved">Resolved</option>
                              </select>
                            </div>
                            <div>
                              <Label className="text-[9px]">Series / Image</Label>
                              <div className="flex gap-1 mt-0.5">
                                <Input value={entrySeries} onChange={(e) => setEntrySeries(e.target.value)} className="h-6 text-xs" placeholder="S" />
                                <Input value={entryImage} onChange={(e) => setEntryImage(e.target.value)} className="h-6 text-xs" placeholder="I" />
                              </div>
                            </div>
                          </div>
                          <Input value={entryNotes} onChange={(e) => setEntryNotes(e.target.value)} className="h-6 text-xs" placeholder="Notes..." />
                          <div className="flex gap-1.5">
                            <Button size="sm" className="h-5 text-[10px]" onClick={() => handleAddTimelineEntry(lesion.id)} disabled={savingEntry}>
                              {savingEntry ? "Saving..." : "Save"}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-5 text-[10px]" onClick={() => setShowAddEntry(null)}>Cancel</Button>
                          </div>
                        </div>
                      )}

                      {/* Timeline entries */}
                      {timelines[lesion.id] ? (
                        timelines[lesion.id].length === 0 ? (
                          <div className="text-[10px] text-muted-foreground text-center py-2">No timeline entries yet.</div>
                        ) : (
                          <div className="space-y-1.5">
                            {timelines[lesion.id].map((entry) => {
                              const cfg = entry.changeStatus ? CHANGE_STATUS_CONFIG[entry.changeStatus] : null;
                              const Icon = cfg?.icon ?? Minus;
                              return (
                                <div key={entry.id} className="flex gap-2 text-[11px] border border-border rounded p-1.5">
                                  <div className="flex-shrink-0 pt-0.5">
                                    {cfg ? (
                                      <span className={`inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded font-medium ${cfg.color}`}>
                                        <Icon size={9} /> {cfg.label}
                                      </span>
                                    ) : (
                                      <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/40 mt-1" />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    {(entry.measurementMm != null) && (
                                      <div className="font-mono text-xs font-medium">
                                        {entry.measurementMm}mm
                                        {entry.measurementMm2 != null && ` × ${entry.measurementMm2}mm`}
                                      </div>
                                    )}
                                    {entry.notes && <div className="text-muted-foreground truncate">{entry.notes}</div>}
                                    {entry.reportedAt && (
                                      <div className="text-[9px] text-muted-foreground flex items-center gap-1">
                                        <Calendar size={8} /> {new Date(entry.reportedAt).toLocaleDateString()}
                                        {entry.reportedBy && <span className="flex items-center gap-0.5"><User size={8} />{entry.reportedBy}</span>}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )
                      ) : (
                        <div className="text-[10px] text-muted-foreground text-center py-1">Loading...</div>
                      )}
                    </div>

                    <div className="text-[9px] text-amber-600 flex items-center gap-1 pt-1">
                      <AlertTriangle size={9} /> AI Draft – Requires Radiologist Review
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
