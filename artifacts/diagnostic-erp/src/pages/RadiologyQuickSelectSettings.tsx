import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Pencil, X, Save } from "lucide-react";
import type { QuickFinding, QuickStudyTab, QuickMeasurement } from "@/components/radiology/QuickFindingsPanel";

/**
 * Radiology Quick Select — admin configuration page.
 * Manages the study tabs and one-click finding buttons shown in the
 * Reporting Workspace "Quick" panel. Admin/super_admin only (mutations are
 * enforced server-side via requireAdminRole; non-admins get a readable
 * 403 toast rather than a blank page).
 */

type QuickSelectData = { tabs: QuickStudyTab[]; findings: QuickFinding[]; measurements: QuickMeasurement[] };

const EMPTY_FINDING = {
  studyType: "", label: "", findingText: "", impressionText: "",
  techniqueText: "", recommendationText: "", icdCode: "", tags: "", suggests: "",
  category: "", sortOrder: 0, isActive: true,
};

const EMPTY_MEASUREMENT = {
  studyType: "", label: "", templateText: "", unit: "mm", sortOrder: 0, isActive: true,
};

export default function RadiologyQuickSelectSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newTabName, setNewTabName] = useState("");
  const [editingFinding, setEditingFinding] = useState<(typeof EMPTY_FINDING & { id?: number }) | null>(null);
  const [editingMeasurement, setEditingMeasurement] = useState<(typeof EMPTY_MEASUREMENT & { id?: number }) | null>(null);
  const [filterTab, setFilterTab] = useState<string>("");

  const { data, isLoading } = useQuery<QuickSelectData>({
    queryKey: ["radiology-quick-select"],
    queryFn: () => api.get("/api/radiology/quick-select"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["radiology-quick-select"] });
  const onErr = (err: unknown) =>
    toast({ title: "Failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });

  // ── Tab mutations ──────────────────────────────────────────────────────────
  const createTab = useMutation({
    mutationFn: (name: string) => api.post("/api/radiology/quick-select/tabs", { name }),
    onSuccess: () => { invalidate(); setNewTabName(""); toast({ title: "Study tab added" }); },
    onError: onErr,
  });
  const updateTab = useMutation({
    mutationFn: ({ id, ...body }: { id: number; isActive?: boolean; sortOrder?: number }) =>
      api.patch(`/api/radiology/quick-select/tabs/${id}`, body),
    onSuccess: invalidate,
    onError: onErr,
  });
  const deleteTab = useMutation({
    mutationFn: (id: number) => api.delete(`/api/radiology/quick-select/tabs/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Study tab deleted" }); },
    onError: onErr,
  });

  // ── Finding mutations ─────────────────────────────────────────────────────
  const saveFinding = useMutation({
    mutationFn: (f: typeof EMPTY_FINDING & { id?: number }) =>
      f.id
        ? api.patch(`/api/radiology/quick-select/findings/${f.id}`, f)
        : api.post("/api/radiology/quick-select/findings", f),
    onSuccess: () => { invalidate(); setEditingFinding(null); toast({ title: "Quick finding saved" }); },
    onError: onErr,
  });
  const deleteFinding = useMutation({
    mutationFn: (id: number) => api.delete(`/api/radiology/quick-select/findings/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Quick finding deleted" }); },
    onError: onErr,
  });
  const toggleFinding = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.patch(`/api/radiology/quick-select/findings/${id}`, { isActive }),
    onSuccess: invalidate,
    onError: onErr,
  });

  // ── Measurement mutations ─────────────────────────────────────────────────
  const saveMeasurement = useMutation({
    mutationFn: (m: typeof EMPTY_MEASUREMENT & { id?: number }) =>
      m.id
        ? api.patch(`/api/radiology/quick-select/measurements/${m.id}`, m)
        : api.post("/api/radiology/quick-select/measurements", m),
    onSuccess: () => { invalidate(); setEditingMeasurement(null); toast({ title: "Measurement saved" }); },
    onError: onErr,
  });
  const deleteMeasurement = useMutation({
    mutationFn: (id: number) => api.delete(`/api/radiology/quick-select/measurements/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Measurement deleted" }); },
    onError: onErr,
  });

  const tabs = data?.tabs ?? [];
  const findings = (data?.findings ?? []).filter((f) => !filterTab || f.studyType === filterTab);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="Radiology Quick Select"
        subtitle="Configure study tabs and one-click finding buttons for the reporting workspace"
      />

      {/* ── Study tabs ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm p-4 space-y-3">
        <h3 className="text-sm font-semibold">Study Tabs</h3>
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <div key={t.id} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${t.isActive ? "" : "opacity-50"}`}>
              <span className="font-medium">{t.name}</span>
              <Switch
                checked={t.isActive}
                onCheckedChange={(v) => updateTab.mutate({ id: t.id, isActive: v })}
                className="scale-75"
              />
              <button
                onClick={() => { if (window.confirm(`Delete study tab "${t.name}"? Its buttons stay in the list below but won't show until reassigned.`)) deleteTab.mutate(t.id); }}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {tabs.length === 0 && !isLoading && <p className="text-xs text-muted-foreground">No study tabs yet.</p>}
        </div>
        <div className="flex gap-2 max-w-sm">
          <Input
            placeholder="New study tab (e.g. Shoulder)"
            value={newTabName}
            onChange={(e) => setNewTabName(e.target.value)}
            className="h-8 text-sm"
          />
          <Button size="sm" className="h-8" disabled={!newTabName.trim() || createTab.isPending}
            onClick={() => createTab.mutate(newTabName.trim())}>
            <Plus size={13} /> Add
          </Button>
        </div>
      </div>

      {/* ── Quick finding buttons ───────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold">Quick Finding Buttons</h3>
          <div className="flex items-center gap-2">
            <select
              value={filterTab}
              onChange={(e) => setFilterTab(e.target.value)}
              className="h-8 text-sm border rounded-md px-2 bg-background"
            >
              <option value="">All study types</option>
              {tabs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
            <Button size="sm" className="h-8" onClick={() => setEditingFinding({ ...EMPTY_FINDING, studyType: filterTab || tabs[0]?.name || "" })}>
              <Plus size={13} /> New Button
            </Button>
          </div>
        </div>

        {/* Edit/create form */}
        {editingFinding && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div>
                <Label className="text-[11px]">Study type</Label>
                <select
                  value={editingFinding.studyType}
                  onChange={(e) => setEditingFinding({ ...editingFinding, studyType: e.target.value })}
                  className="h-8 w-full text-sm border rounded-md px-2 bg-background"
                >
                  <option value="">Select…</option>
                  {tabs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[11px]">Button label</Label>
                <Input value={editingFinding.label} onChange={(e) => setEditingFinding({ ...editingFinding, label: e.target.value })} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-[11px]">Category (optional)</Label>
                <Input value={editingFinding.category} onChange={(e) => setEditingFinding({ ...editingFinding, category: e.target.value })} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-[11px]">Sort order</Label>
                <Input type="number" value={editingFinding.sortOrder} onChange={(e) => setEditingFinding({ ...editingFinding, sortOrder: Number(e.target.value) || 0 })} className="h-8 text-sm" />
              </div>
            </div>
            <div>
              <Label className="text-[11px]">Finding text (inserted into Findings)</Label>
              <Textarea value={editingFinding.findingText} onChange={(e) => setEditingFinding({ ...editingFinding, findingText: e.target.value })} className="text-sm min-h-[60px]" />
            </div>
            <div>
              <Label className="text-[11px]">Impression text (inserted into Impression)</Label>
              <Textarea value={editingFinding.impressionText} onChange={(e) => setEditingFinding({ ...editingFinding, impressionText: e.target.value })} className="text-sm min-h-[44px]" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px]">Technique text (optional — inserted into Technique)</Label>
                <Textarea value={editingFinding.techniqueText} onChange={(e) => setEditingFinding({ ...editingFinding, techniqueText: e.target.value })} className="text-sm min-h-[40px]" />
              </div>
              <div>
                <Label className="text-[11px]">Recommendation text (optional)</Label>
                <Textarea value={editingFinding.recommendationText} onChange={(e) => setEditingFinding({ ...editingFinding, recommendationText: e.target.value })} className="text-sm min-h-[40px]" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <Label className="text-[11px]">ICD / diagnosis code (optional)</Label>
                <Input value={editingFinding.icdCode} onChange={(e) => setEditingFinding({ ...editingFinding, icdCode: e.target.value })} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-[11px]">Tags (comma-separated, for search)</Label>
                <Input value={editingFinding.tags} onChange={(e) => setEditingFinding({ ...editingFinding, tags: e.target.value })} className="h-8 text-sm" placeholder="ischemia, white matter" />
              </div>
              <div>
                <Label className="text-[11px]">Suggests (comma-separated button labels)</Label>
                <Input value={editingFinding.suggests} onChange={(e) => setEditingFinding({ ...editingFinding, suggests: e.target.value })} className="h-8 text-sm" placeholder="DWI restriction, MRA advised" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" className="h-7" onClick={() => setEditingFinding(null)}>
                <X size={12} /> Cancel
              </Button>
              <Button size="sm" className="h-7"
                disabled={!editingFinding.studyType || !editingFinding.label.trim() || saveFinding.isPending}
                onClick={() => saveFinding.mutate(editingFinding)}>
                <Save size={12} /> Save
              </Button>
            </div>
          </div>
        )}

        {/* Findings list */}
        <div className="divide-y rounded-lg border overflow-hidden">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-4">Loading…</p>
          ) : findings.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No quick finding buttons {filterTab ? `for ${filterTab}` : "configured"} yet.</p>
          ) : findings.map((f) => (
            <div key={f.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${f.isActive ? "" : "opacity-50"}`}>
              <span className="text-[10px] font-mono bg-muted rounded px-1.5 py-0.5 shrink-0">{f.studyType}</span>
              <span className="font-medium shrink-0">{f.label}</span>
              <span className="text-xs text-muted-foreground truncate flex-1">{f.findingText || f.impressionText}</span>
              <Switch checked={f.isActive} onCheckedChange={(v) => toggleFinding.mutate({ id: f.id, isActive: v })} className="scale-75" />
              <button onClick={() => setEditingFinding({ ...f, category: f.category ?? "", icdCode: f.icdCode ?? "", techniqueText: f.techniqueText ?? "", recommendationText: f.recommendationText ?? "", tags: f.tags ?? "", suggests: f.suggests ?? "" })} className="text-muted-foreground hover:text-primary">
                <Pencil size={13} />
              </button>
              <button onClick={() => { if (window.confirm(`Delete "${f.label}"?`)) deleteFinding.mutate(f.id); }} className="text-muted-foreground hover:text-destructive">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Measurement library ─────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold">Measurement Library</h3>
          <Button size="sm" className="h-8" onClick={() => setEditingMeasurement({ ...EMPTY_MEASUREMENT, studyType: filterTab || tabs[0]?.name || "" })}>
            <Plus size={13} /> New Measurement
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Use <code className="bg-muted px-1 rounded">{"{value}"}</code> in the template — the radiologist types the number at insert time.
        </p>

        {editingMeasurement && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div>
                <Label className="text-[11px]">Study type</Label>
                <select
                  value={editingMeasurement.studyType}
                  onChange={(e) => setEditingMeasurement({ ...editingMeasurement, studyType: e.target.value })}
                  className="h-8 w-full text-sm border rounded-md px-2 bg-background"
                >
                  <option value="">Select…</option>
                  {tabs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[11px]">Label</Label>
                <Input value={editingMeasurement.label} onChange={(e) => setEditingMeasurement({ ...editingMeasurement, label: e.target.value })} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-[11px]">Unit</Label>
                <Input value={editingMeasurement.unit} onChange={(e) => setEditingMeasurement({ ...editingMeasurement, unit: e.target.value })} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-[11px]">Sort order</Label>
                <Input type="number" value={editingMeasurement.sortOrder} onChange={(e) => setEditingMeasurement({ ...editingMeasurement, sortOrder: Number(e.target.value) || 0 })} className="h-8 text-sm" />
              </div>
            </div>
            <div>
              <Label className="text-[11px]">Template text (use {"{value}"})</Label>
              <Textarea value={editingMeasurement.templateText} onChange={(e) => setEditingMeasurement({ ...editingMeasurement, templateText: e.target.value })} className="text-sm min-h-[40px]" placeholder="Common bile duct measures {value} mm." />
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" className="h-7" onClick={() => setEditingMeasurement(null)}>
                <X size={12} /> Cancel
              </Button>
              <Button size="sm" className="h-7"
                disabled={!editingMeasurement.studyType || !editingMeasurement.label.trim() || !editingMeasurement.templateText.trim() || saveMeasurement.isPending}
                onClick={() => saveMeasurement.mutate(editingMeasurement)}>
                <Save size={12} /> Save
              </Button>
            </div>
          </div>
        )}

        <div className="divide-y rounded-lg border overflow-hidden">
          {(data?.measurements ?? []).filter((m) => !filterTab || m.studyType === filterTab).map((m) => (
            <div key={m.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${m.isActive ? "" : "opacity-50"}`}>
              <span className="text-[10px] font-mono bg-muted rounded px-1.5 py-0.5 shrink-0">{m.studyType}</span>
              <span className="font-medium shrink-0">{m.label}</span>
              <span className="text-xs text-muted-foreground truncate flex-1">{m.templateText}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">{m.unit}</span>
              <button onClick={() => setEditingMeasurement({ ...m })} className="text-muted-foreground hover:text-primary">
                <Pencil size={13} />
              </button>
              <button onClick={() => { if (window.confirm(`Delete "${m.label}"?`)) deleteMeasurement.mutate(m.id); }} className="text-muted-foreground hover:text-destructive">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {(data?.measurements ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground p-4">No measurements configured yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
