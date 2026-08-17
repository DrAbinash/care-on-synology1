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
import { Plus, Trash2, Pencil, X, Save, Copy, RotateCcw, ArrowUp, ArrowDown, Search } from "lucide-react";
import type { QuickFinding, QuickStudyTab, QuickMeasurement, QuickProtocol, QuickClinicalHistoryChip } from "@/components/radiology/QuickFindingsPanel";
import StructuredQuestionsEditor from "@/components/radiology/StructuredQuestionsEditor";
import { ChocolateBoxSettingsPanel } from "@/components/radiology/zai-workspace/chocolate-box-macros";

/**
 * Radiology Quick Select — admin configuration page.
 * Manages the study tabs and one-click finding buttons shown in the
 * Reporting Workspace "Quick" panel. Admin/super_admin only (mutations are
 * enforced server-side via requireAdminRole; non-admins get a readable
 * 403 toast rather than a blank page).
 */

type QuickSelectData = { tabs: QuickStudyTab[]; findings: QuickFinding[]; measurements: QuickMeasurement[]; protocols: QuickProtocol[]; clinicalHistory: QuickClinicalHistoryChip[] };


const EMPTY_FINDING = {
  studyType: "", label: "", findingText: "", impressionText: "",
  techniqueText: "", recommendationText: "", icdCode: "", tags: "", suggests: "", properties: "",
  category: "", anatomicalSection: "", conflictGroup: "", baselineReplaces: "",
  questionsJson: "[]",
  sortOrder: 0, isActive: true,
};

const EMPTY_MEASUREMENT = {
  studyType: "", label: "", templateText: "", unit: "mm", sortOrder: 0, isActive: true,
};

const EMPTY_PROTOCOL = {
  name: "", studyType: "", modality: "", checklistJson: "[]", techniqueText: "",
  normalText: "", recommendationText: "", requiredMeasurements: "",
  isGoldStandard: false, isDefault: false, sortOrder: 0, isActive: true,
};

const EMPTY_CHIP = {
  studyType: "", displayLabel: "", insertedText: "", sortOrder: 0, isActive: true,
};

export default function RadiologyQuickSelectSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newTabName, setNewTabName] = useState("");
  const [editingFinding, setEditingFinding] = useState<(typeof EMPTY_FINDING & { id?: number }) | null>(null);
  const [editingMeasurement, setEditingMeasurement] = useState<(typeof EMPTY_MEASUREMENT & { id?: number }) | null>(null);
  const [editingTab, setEditingTab] = useState<{ id: number; name: string; techniqueText: string; normalText: string } | null>(null);
  const [editingProtocol, setEditingProtocol] = useState<(typeof EMPTY_PROTOCOL & { id?: number; checklistText?: string }) | null>(null);
  const [editingChip, setEditingChip] = useState<(typeof EMPTY_CHIP & { id?: number }) | null>(null);
  const [filterTab, setFilterTab] = useState<string>("");
  const [protocolSearch, setProtocolSearch] = useState<string>("");

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
    mutationFn: ({ id, ...body }: { id: number; isActive?: boolean; sortOrder?: number; techniqueText?: string; normalText?: string }) =>
      api.patch(`/api/radiology/quick-select/tabs/${id}`, body),
    onSettled: () => setEditingTab(null),
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

  // ── Protocol mutations (Phase 5) ──────────────────────────────────────────
  const saveProtocol = useMutation({
    mutationFn: (p: typeof EMPTY_PROTOCOL & { id?: number }) =>
      p.id
        ? api.patch(`/api/radiology/quick-select/protocols/${p.id}`, p)
        : api.post("/api/radiology/quick-select/protocols", p),
    onSuccess: () => { invalidate(); setEditingProtocol(null); toast({ title: "Protocol saved" }); },
    onError: onErr,
  });
  const deleteProtocol = useMutation({
    mutationFn: (id: number) => api.delete(`/api/radiology/quick-select/protocols/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Protocol deleted" }); },
    onError: onErr,
  });
  const toggleProtocol = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.patch(`/api/radiology/quick-select/protocols/${id}`, { isActive }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const setDefaultProtocol = useMutation({
    mutationFn: ({ id, isDefault }: { id: number; isDefault: boolean }) =>
      api.patch(`/api/radiology/quick-select/protocols/${id}`, { isDefault }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const duplicateProtocol = useMutation({
    mutationFn: (id: number) => api.post(`/api/radiology/quick-select/protocols/${id}/duplicate`, {}),
    onSuccess: () => { invalidate(); toast({ title: "Protocol duplicated" }); },
    onError: onErr,
  });
  const restoreProtocolDefaults = useMutation({
    mutationFn: (studyType?: string) => api.post("/api/radiology/quick-select/protocols/restore-defaults", studyType ? { studyType } : {}),
    onSuccess: () => { invalidate(); toast({ title: "System default protocols restored" }); },
    onError: onErr,
  });

  // ── Clinical History chip mutations ─────────────────────────────────────────
  const saveChip = useMutation({
    mutationFn: (c: typeof EMPTY_CHIP & { id?: number }) =>
      c.id
        ? api.patch(`/api/radiology/quick-select/clinical-history/${c.id}`, c)
        : api.post("/api/radiology/quick-select/clinical-history", c),
    onSuccess: () => { invalidate(); setEditingChip(null); toast({ title: "Clinical history chip saved" }); },
    onError: onErr,
  });
  const deleteChip = useMutation({
    mutationFn: (id: number) => api.delete(`/api/radiology/quick-select/clinical-history/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Chip deleted" }); },
    onError: onErr,
  });
  const toggleChip = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.patch(`/api/radiology/quick-select/clinical-history/${id}`, { isActive }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const restoreChipDefaults = useMutation({
    mutationFn: (studyType?: string) => api.post("/api/radiology/quick-select/clinical-history/restore-defaults", studyType ? { studyType } : {}),
    onSuccess: () => { invalidate(); toast({ title: "Default clinical-history chips restored" }); },
    onError: onErr,
  });

  // Move an item up/down within its own study group. Renumbers only that
  // study's contiguous run to a clean 10,20,30… sequence in the new order, so
  // reordering is correct even when several rows share the same sort_order
  // (new rows default to 0) and never touches other studies' rows. PATCHes only
  // the rows whose order actually changes.
  function moveItem<T extends { id: number; sortOrder: number; studyType: string }>(
    list: T[],
    index: number,
    dir: -1 | 1,
    patch: (id: number, sortOrder: number) => Promise<unknown>,
  ) {
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const study = list[index].studyType;
    if (list[j].studyType !== study) return; // stay within the study
    // Bound the contiguous same-study run around this item.
    let lo = index, hi = index;
    while (lo > 0 && list[lo - 1].studyType === study) lo--;
    while (hi < list.length - 1 && list[hi + 1].studyType === study) hi++;
    const group = list.slice(lo, hi + 1);
    [group[index - lo], group[j - lo]] = [group[j - lo], group[index - lo]];
    const writes = group
      .map((item, i) => ({ id: item.id, sortOrder: (i + 1) * 10, prev: item.sortOrder }))
      .filter((w) => w.sortOrder !== w.prev);
    if (writes.length === 0) return;
    Promise.all(writes.map((w) => patch(w.id, w.sortOrder))).then(invalidate).catch(onErr);
  }
  const patchProtocolOrder = (id: number, sortOrder: number) => api.patch(`/api/radiology/quick-select/protocols/${id}`, { sortOrder });
  const patchChipOrder = (id: number, sortOrder: number) => api.patch(`/api/radiology/quick-select/clinical-history/${id}`, { sortOrder });

  const tabs = data?.tabs ?? [];
  const findings = (data?.findings ?? []).filter((f) => !filterTab || f.studyType === filterTab);
  // Protocols in the current study filter, matching the search. Grouped by
  // study (like chips) so same-study rows are contiguous and the reorder arrows
  // stay within a study.
  const protocols = (data?.protocols ?? [])
    .filter((p) => !filterTab || p.studyType === filterTab)
    .filter((p) => { const q = protocolSearch.trim().toLowerCase(); return !q || p.name.toLowerCase().includes(q) || p.studyType.toLowerCase().includes(q) || p.techniqueText.toLowerCase().includes(q); })
    .sort((a, b) => a.studyType.localeCompare(b.studyType) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  // Clinical-history chips in the current study filter, in display order.
  const chips = (data?.clinicalHistory ?? [])
    .filter((c) => !filterTab || c.studyType === filterTab)
    .sort((a, b) => a.studyType.localeCompare(b.studyType) || a.sortOrder - b.sortOrder || a.displayLabel.localeCompare(b.displayLabel));

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="Radiology Quick Select"
        subtitle="Configure study tabs and one-click finding buttons for the reporting workspace"
      />

      <ChocolateBoxSettingsPanel />

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
                onClick={() => setEditingTab({ id: t.id, name: t.name, techniqueText: (t as QuickStudyTab).techniqueText ?? "", normalText: (t as QuickStudyTab).normalText ?? "" })}
                className="text-muted-foreground hover:text-primary"
                title="Edit auto-technique and baseline normals"
              >
                <Pencil size={12} />
              </button>
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
        {editingTab && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-semibold">Edit "{editingTab.name}" — Abnormality Engine texts</p>
            <div>
              <Label className="text-[11px]">Auto technique (fills Technique when this tab is selected and Technique is empty)</Label>
              <Textarea value={editingTab.techniqueText} onChange={(e) => setEditingTab({ ...editingTab, techniqueText: e.target.value })} className="text-sm min-h-[40px]" />
            </div>
            <div>
              <Label className="text-[11px]">Baseline normals (one-click "+ baseline normals" button text)</Label>
              <Textarea value={editingTab.normalText} onChange={(e) => setEditingTab({ ...editingTab, normalText: e.target.value })} className="text-sm min-h-[52px]" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" className="h-7" onClick={() => setEditingTab(null)}>
                <X size={12} /> Cancel
              </Button>
              <Button size="sm" className="h-7" disabled={updateTab.isPending}
                onClick={() => updateTab.mutate({ id: editingTab.id, techniqueText: editingTab.techniqueText, normalText: editingTab.normalText })}>
                <Save size={12} /> Save
              </Button>
            </div>
          </div>
        )}
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
            <div>
              <Label className="text-[11px]">Property chips (comma list of: side, severity, chronicity, level, measurement)</Label>
              <Input value={editingFinding.properties} onChange={(e) => setEditingFinding({ ...editingFinding, properties: e.target.value })} className="h-8 text-sm" placeholder="severity, level" />
            </div>
            {/* ── Smart Findings engine fields ────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 rounded-md border border-dashed p-2 bg-muted/10">
              <div>
                <Label className="text-[11px]">Anatomical section (structured template section it flips)</Label>
                <Input value={editingFinding.anatomicalSection} onChange={(e) => setEditingFinding({ ...editingFinding, anatomicalSection: e.target.value })} className="h-8 text-sm" placeholder="L4-L5 / White Matter / Spinal Cord" />
              </div>
              <div>
                <Label className="text-[11px]">Conflict group (same group = mutually exclusive)</Label>
                <Input value={editingFinding.conflictGroup} onChange={(e) => setEditingFinding({ ...editingFinding, conflictGroup: e.target.value })} className="h-8 text-sm" placeholder="fazekas" />
              </div>
              <div>
                <Label className="text-[11px]">Baseline sentence replaced (free-text mode)</Label>
                <Input value={editingFinding.baselineReplaces} onChange={(e) => setEditingFinding({ ...editingFinding, baselineReplaces: e.target.value })} className="h-8 text-sm" placeholder="No disc bulge." />
              </div>
              <p className="md:col-span-3 text-[10px] text-muted-foreground">
                In structured mode, selecting this finding replaces the matching template section's normal text with the finding text (anatomical order + conflict resolution are automatic). Leave the section blank to append to free-text findings instead. Use <span className="font-mono">{"{key}"}</span> to pull in a question&rsquo;s value, and <span className="font-mono">[ &hellip; {"{key}"} &hellip; ]</span> for a clause that drops when the value is Normal/None. Set the Anatomical section to <span className="font-mono">{"{level}"}</span> to map one finding to the chosen level&rsquo;s section.
              </p>
            </div>
            {/* ── Structured Finding Assistant — configurable questions ─────── */}
            <StructuredQuestionsEditor
              key={editingFinding.id ?? "new-finding"}
              initial={editingFinding.questionsJson}
              referenceText={`${editingFinding.findingText} ${editingFinding.impressionText} ${editingFinding.anatomicalSection}`}
              onChange={(json) => setEditingFinding((prev) => (prev ? { ...prev, questionsJson: json } : prev))}
            />
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
              {f.anatomicalSection ? <span className="text-[9px] rounded-full border border-primary/40 text-primary px-1.5 py-0.5 shrink-0" title="Structured section this finding flips">§ {f.anatomicalSection}</span> : null}
              <span className="text-xs text-muted-foreground truncate flex-1">{f.findingText || f.impressionText}</span>
              <Switch checked={f.isActive} onCheckedChange={(v) => toggleFinding.mutate({ id: f.id, isActive: v })} className="scale-75" />
              <button onClick={() => setEditingFinding({ ...f, category: f.category ?? "", icdCode: f.icdCode ?? "", techniqueText: f.techniqueText ?? "", recommendationText: f.recommendationText ?? "", tags: f.tags ?? "", suggests: f.suggests ?? "", properties: f.properties ?? "", anatomicalSection: f.anatomicalSection ?? "", conflictGroup: f.conflictGroup ?? "", baselineReplaces: f.baselineReplaces ?? "", questionsJson: f.questionsJson ?? "[]" })} className="text-muted-foreground hover:text-primary">
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
      {/* ── Protocol Editor (Phase 5) ────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold">Protocols</h3>
            <p className="text-xs text-muted-foreground">Indication-specific presets within a region (e.g. "MRI Brain Trauma"). The protocol name appears in the workspace dropdown; its Technique text is inserted into the Technique field. Changes here apply only to new reports — existing finalized reports keep the exact text they were saved with.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={filterTab} onChange={(e) => setFilterTab(e.target.value)} className="h-8 text-sm border rounded-md px-2 bg-background" title="Filter by study / body region">
              <option value="">All study types</option>
              {tabs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={protocolSearch} onChange={(e) => setProtocolSearch(e.target.value)} placeholder="Search protocols…" className="h-8 text-sm pl-7 w-44" />
            </div>
            <Button
              size="sm" variant="outline" className="h-8"
              disabled={restoreProtocolDefaults.isPending}
              onClick={() => { if (window.confirm(`Restore system default protocols${filterTab ? ` for ${filterTab}` : ""}? This re-adds and refreshes the factory protocols; your custom protocols are left untouched.`)) restoreProtocolDefaults.mutate(filterTab || undefined); }}
              title="Re-add / refresh the factory protocols. Custom protocols are not touched."
            >
              <RotateCcw size={13} /> Restore defaults
            </Button>
            <Button size="sm" className="h-8" onClick={() => setEditingProtocol({ ...EMPTY_PROTOCOL, studyType: filterTab || tabs[0]?.name || "", checklistText: "" })}>
              <Plus size={13} /> New Protocol
            </Button>
          </div>
        </div>

        {editingProtocol && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div>
                <Label className="text-[11px]">Protocol name</Label>
                <Input value={editingProtocol.name} onChange={(e) => setEditingProtocol({ ...editingProtocol, name: e.target.value })} className="h-8 text-sm" placeholder="MRI Brain Trauma" />
              </div>
              <div>
                <Label className="text-[11px]">Region (study tab)</Label>
                <select
                  value={editingProtocol.studyType}
                  onChange={(e) => setEditingProtocol({ ...editingProtocol, studyType: e.target.value })}
                  className="h-8 w-full text-sm border rounded-md px-2 bg-background"
                >
                  <option value="">Select…</option>
                  {tabs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[11px]">Modality</Label>
                <Input value={editingProtocol.modality} onChange={(e) => setEditingProtocol({ ...editingProtocol, modality: e.target.value })} className="h-8 text-sm" placeholder="MRI / CT / USG / XR" />
              </div>
              <div className="flex flex-col justify-end gap-1 pb-1">
                <div className="flex items-center gap-2">
                  <Switch checked={editingProtocol.isGoldStandard} onCheckedChange={(v) => setEditingProtocol({ ...editingProtocol, isGoldStandard: v })} />
                  <Label className="text-[11px]">★ Gold Standard</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={editingProtocol.isDefault} onCheckedChange={(v) => setEditingProtocol({ ...editingProtocol, isDefault: v })} />
                  <Label className="text-[11px]">◉ Default for this study</Label>
                </div>
              </div>
            </div>
            {editingProtocol.isDefault && (
              <p className="text-[10px] text-amber-600">Only one protocol can be the default per study — saving this will clear the default flag on any other protocol in {editingProtocol.studyType || "this study"}.</p>
            )}
            <div>
              <Label className="text-[11px]">Checklist items (one per line — the radiologist confirms each by selecting a matching finding)</Label>
              <Textarea
                value={editingProtocol.checklistText ?? (() => { try { return (JSON.parse(editingProtocol.checklistJson) as string[]).join("\n"); } catch { return ""; } })()}
                onChange={(e) => setEditingProtocol({ ...editingProtocol, checklistText: e.target.value, checklistJson: JSON.stringify(e.target.value.split("\n").map((l) => l.trim()).filter(Boolean)) })}
                className="text-sm min-h-[80px]"
                placeholder={"Skull\nExtra-axial hemorrhage\nSubdural\nEpidural\nSAH"}
              />
            </div>
            <div>
              <Label className="text-[11px]">Technique (auto-fills Technique if empty)</Label>
              <Textarea value={editingProtocol.techniqueText} onChange={(e) => setEditingProtocol({ ...editingProtocol, techniqueText: e.target.value })} className="text-sm min-h-[44px]" />
            </div>
            <div>
              <Label className="text-[11px]">Normal paragraph ("+ normals" one-click button text)</Label>
              <Textarea value={editingProtocol.normalText} onChange={(e) => setEditingProtocol({ ...editingProtocol, normalText: e.target.value })} className="text-sm min-h-[52px]" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px]">Recommendation (auto-merged into Recommendation)</Label>
                <Textarea value={editingProtocol.recommendationText} onChange={(e) => setEditingProtocol({ ...editingProtocol, recommendationText: e.target.value })} className="text-sm min-h-[40px]" />
              </div>
              <div>
                <Label className="text-[11px]">Required measurements (comma list, checked against Findings text)</Label>
                <Input value={editingProtocol.requiredMeasurements} onChange={(e) => setEditingProtocol({ ...editingProtocol, requiredMeasurements: e.target.value })} className="h-8 text-sm" placeholder="Canal diameter, Disc height" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" className="h-7" onClick={() => setEditingProtocol(null)}>
                <X size={12} /> Cancel
              </Button>
              <Button size="sm" className="h-7"
                disabled={!editingProtocol.name.trim() || !editingProtocol.studyType || saveProtocol.isPending}
                onClick={() => { const { checklistText: _drop, ...rest } = editingProtocol; void _drop; saveProtocol.mutate(rest); }}>
                <Save size={12} /> Save
              </Button>
            </div>
          </div>
        )}

        <div className="divide-y rounded-lg border overflow-hidden">
          {protocols.map((p, i) => (
            <div key={p.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${p.isActive ? "" : "opacity-50"}`}>
              <div className="flex flex-col shrink-0">
                <button disabled={i === 0 || protocols[i - 1]?.studyType !== p.studyType} onClick={() => moveItem(protocols, i, -1, patchProtocolOrder)} className="text-muted-foreground hover:text-primary disabled:opacity-20" title="Move up"><ArrowUp size={11} /></button>
                <button disabled={i === protocols.length - 1 || protocols[i + 1]?.studyType !== p.studyType} onClick={() => moveItem(protocols, i, 1, patchProtocolOrder)} className="text-muted-foreground hover:text-primary disabled:opacity-20" title="Move down"><ArrowDown size={11} /></button>
              </div>
              <span className="text-[10px] font-mono bg-muted rounded px-1.5 py-0.5 shrink-0">{p.studyType}</span>
              <button
                onClick={() => setDefaultProtocol.mutate({ id: p.id, isDefault: !p.isDefault })}
                className={`shrink-0 text-sm leading-none ${p.isDefault ? "text-amber-500" : "text-muted-foreground/30 hover:text-amber-500"}`}
                title={p.isDefault ? "Default protocol for this study — click to unset" : "Set as the default protocol for this study"}
              >◉</button>
              <span className="font-medium shrink-0">{p.isGoldStandard ? "★ " : ""}{p.name}{p.isDefault ? <span className="ml-1 text-[9px] font-normal text-amber-600">(default)</span> : null}</span>
              <span className="text-xs text-muted-foreground truncate flex-1">
                {(() => { try { return (JSON.parse(p.checklistJson) as string[]).length; } catch { return 0; } })()} checklist items
              </span>
              <Switch checked={p.isActive} onCheckedChange={(v) => toggleProtocol.mutate({ id: p.id, isActive: v })} className="scale-75" />
              <button onClick={() => setEditingProtocol({ ...p, checklistText: undefined })} className="text-muted-foreground hover:text-primary" title="Edit"><Pencil size={13} /></button>
              <button onClick={() => duplicateProtocol.mutate(p.id)} className="text-muted-foreground hover:text-primary" title="Duplicate"><Copy size={13} /></button>
              <button
                onClick={() => { if (window.confirm(`Delete protocol "${p.name}"?\n\nExisting finalized reports keep the exact Technique text they were saved with and are NOT affected — this only removes the protocol from future selection.`)) deleteProtocol.mutate(p.id); }}
                className="text-muted-foreground hover:text-destructive"
                title="Delete"
              ><Trash2 size={13} /></button>
            </div>
          ))}
          {protocols.length === 0 && (
            <p className="text-sm text-muted-foreground p-4">No protocols {filterTab ? `for ${filterTab}` : (protocolSearch ? "match your search" : "configured")} yet.</p>
          )}
        </div>
      </div>

      {/* ── Clinical History Quick Select ────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold">Clinical History Quick Select</h3>
            <p className="text-xs text-muted-foreground">Study-specific chips shown beside the Clinical History heading in the reporting workspace. The short label appears on the chip; the full text is inserted into Clinical History. Add as many as you like per study — the strip wraps and scrolls. Changes appear in the workspace immediately — no code change.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={filterTab} onChange={(e) => setFilterTab(e.target.value)} className="h-8 text-sm border rounded-md px-2 bg-background" title="Filter by study / body region">
              <option value="">All study types</option>
              {tabs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
            <Button
              size="sm" variant="outline" className="h-8"
              disabled={restoreChipDefaults.isPending}
              onClick={() => { if (window.confirm(`Restore the default clinical-history chips${filterTab ? ` for ${filterTab}` : ""}? This re-adds and refreshes the factory chips; custom chips are left untouched.`)) restoreChipDefaults.mutate(filterTab || undefined); }}
              title="Re-add / refresh the factory chips. Custom chips are not touched."
            >
              <RotateCcw size={13} /> Restore defaults
            </Button>
            <Button size="sm" className="h-8" onClick={() => setEditingChip({ ...EMPTY_CHIP, studyType: filterTab || tabs[0]?.name || "" })}>
              <Plus size={13} /> New Chip
            </Button>
          </div>
        </div>

        {editingChip && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div>
                <Label className="text-[11px]">Study / region</Label>
                <select
                  value={editingChip.studyType}
                  onChange={(e) => setEditingChip({ ...editingChip, studyType: e.target.value })}
                  className="h-8 w-full text-sm border rounded-md px-2 bg-background"
                >
                  <option value="">Select…</option>
                  {tabs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[11px]">Display label (chip)</Label>
                <Input value={editingChip.displayLabel} onChange={(e) => setEditingChip({ ...editingChip, displayLabel: e.target.value })} className="h-8 text-sm" placeholder="Headache" />
              </div>
              <div>
                <Label className="text-[11px]">Sort order</Label>
                <Input type="number" value={editingChip.sortOrder} onChange={(e) => setEditingChip({ ...editingChip, sortOrder: Number(e.target.value) || 0 })} className="h-8 text-sm" />
              </div>
              <div className="flex items-end gap-2 pb-1.5">
                <Switch checked={editingChip.isActive} onCheckedChange={(v) => setEditingChip({ ...editingChip, isActive: v })} />
                <Label className="text-[11px]">Active</Label>
              </div>
            </div>
            <div>
              <Label className="text-[11px]">Inserted text (full phrase added to Clinical History)</Label>
              <Textarea value={editingChip.insertedText} onChange={(e) => setEditingChip({ ...editingChip, insertedText: e.target.value })} className="text-sm min-h-[40px]" placeholder="Sudden onset weakness with suspected cerebrovascular event." />
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" className="h-7" onClick={() => setEditingChip(null)}>
                <X size={12} /> Cancel
              </Button>
              <Button size="sm" className="h-7"
                disabled={!editingChip.studyType || !editingChip.displayLabel.trim() || saveChip.isPending}
                onClick={() => saveChip.mutate(editingChip)}>
                <Save size={12} /> Save
              </Button>
            </div>
          </div>
        )}

        <div className="divide-y rounded-lg border overflow-hidden">
          {chips.map((c, i) => (
            <div key={c.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${c.isActive ? "" : "opacity-50"}`}>
              <div className="flex flex-col shrink-0">
                <button disabled={i === 0 || chips[i - 1]?.studyType !== c.studyType} onClick={() => moveItem(chips, i, -1, patchChipOrder)} className="text-muted-foreground hover:text-primary disabled:opacity-20" title="Move up"><ArrowUp size={11} /></button>
                <button disabled={i === chips.length - 1 || chips[i + 1]?.studyType !== c.studyType} onClick={() => moveItem(chips, i, 1, patchChipOrder)} className="text-muted-foreground hover:text-primary disabled:opacity-20" title="Move down"><ArrowDown size={11} /></button>
              </div>
              <span className="text-[10px] font-mono bg-muted rounded px-1.5 py-0.5 shrink-0">{c.studyType}</span>
              <span className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 text-[10px] font-medium shrink-0">{c.displayLabel}</span>
              <span className="text-xs text-muted-foreground truncate flex-1">{c.insertedText}</span>
              <Switch checked={c.isActive} onCheckedChange={(v) => toggleChip.mutate({ id: c.id, isActive: v })} className="scale-75" />
              <button onClick={() => setEditingChip({ studyType: c.studyType, displayLabel: c.displayLabel, insertedText: c.insertedText, sortOrder: c.sortOrder, isActive: c.isActive, id: c.id })} className="text-muted-foreground hover:text-primary" title="Edit"><Pencil size={13} /></button>
              <button onClick={() => { if (window.confirm(`Delete clinical-history chip "${c.displayLabel}"?`)) deleteChip.mutate(c.id); }} className="text-muted-foreground hover:text-destructive" title="Delete"><Trash2 size={13} /></button>
            </div>
          ))}
          {chips.length === 0 && (
            <p className="text-sm text-muted-foreground p-4">No clinical-history chips {filterTab ? `for ${filterTab}` : "configured"} yet. Use “Restore defaults” to load the factory set.</p>
          )}
        </div>
      </div>
    </div>
  );
}
