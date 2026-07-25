/**
 * RadiologyFindingsManager — add / modify / delete the abnormal (and normal)
 * findings that power the Report Builder, organised by modality + organ.
 *
 * Every modality (CT / USG / MRI / X-RAY) has its own Liver, Gall Bladder,
 * Pancreas, etc. The catalogue is seeded once from the mined house library and
 * is then fully editable — missed findings, new ones, or Dr Sugandha's
 * new-style phrasing can be added and later edited or removed.
 */
import { useMemo, useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFindingsLibrary, FINDING_LIBRARY_KEYS, type Finding } from "@/hooks/useFindingsLibrary";
import {
  Search, Plus, Pencil, Trash2, Check, X, Database, AlertTriangle, Loader2, Save,
} from "lucide-react";

const MODALITIES = ["CT", "USG", "MRI", "XRAY"];
const MODALITY_LABEL: Record<string, string> = { CT: "CT", USG: "USG", MRI: "MRI", XRAY: "X-Ray" };

export default function RadiologyFindingsManager() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { findings, seeded, starterFindings, metaCount, isLoading } = useFindingsLibrary();

  const [modality, setModality] = useState("CT");
  const [organ, setOrgan] = useState<string>("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string; abnormal: boolean } | null>(null);
  const [newText, setNewText] = useState("");
  const [newAbnormal, setNewAbnormal] = useState(true);
  const [newOrgan, setNewOrgan] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: FINDING_LIBRARY_KEYS.db });
    qc.invalidateQueries({ queryKey: FINDING_LIBRARY_KEYS.meta });
  };

  // organs (sections) for the active modality, with counts
  const organs = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of findings) if (f.modality === modality) m.set(f.section, (m.get(f.section) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [findings, modality]);

  const activeOrgan = organ || organs[0]?.[0] || "";

  const rows = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return findings
      .filter((f) => f.modality === modality && f.section === activeOrgan)
      .filter((f) => !terms.length || terms.every((t) => f.text.toLowerCase().includes(t)))
      .sort((a, b) => Number(b.abnormal) - Number(a.abnormal) || b.frequency - a.frequency);
  }, [findings, modality, activeOrgan, q]);

  // ── mutations ──────────────────────────────────────────────────────────────
  const seed = useMutation({
    mutationFn: (force?: boolean) =>
      api.post<{ inserted: number; alreadySeeded?: boolean; replaced?: number }>("/api/radiology/finding-library/seed", {
        force: force === true,
        findings: starterFindings.map((f) => ({
          modality: f.modality, section: f.section, region: f.region,
          text: f.text, abnormal: f.abnormal, impression: f.impression, frequency: f.frequency,
        })),
      }),
    onSuccess: (r) => {
      invalidate();
      toast({
        title: r.alreadySeeded ? "Already loaded" : r.replaced ? "Starter library reloaded" : "Starter library loaded",
        description: r.replaced
          ? `${r.replaced} old starter findings replaced with ${r.inserted} regrouped ones. Custom findings kept.`
          : `${r.inserted} findings now editable.`,
      });
    },
    onError: (e) => toast({ title: "Seed failed", description: msg(e), variant: "destructive" }),
  });

  const add = useMutation({
    mutationFn: (body: { modality: string; section: string; text: string; abnormal: boolean }) =>
      api.post<{ finding: Finding }>("/api/radiology/finding-library", body),
    onSuccess: () => { invalidate(); setNewText(""); setNewOrgan(""); toast({ title: "Finding added" }); },
    onError: (e) => toast({ title: "Add failed", description: msg(e), variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: (v: { id: string; text: string; abnormal: boolean }) =>
      api.patch<{ finding: Finding }>(`/api/radiology/finding-library/${v.id}`, { text: v.text, abnormal: v.abnormal }),
    onSuccess: () => { invalidate(); setEditing(null); toast({ title: "Saved" }); },
    onError: (e) => toast({ title: "Save failed", description: msg(e), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/radiology/finding-library/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Finding removed" }); },
    onError: (e) => toast({ title: "Delete failed", description: msg(e), variant: "destructive" }),
  });

  function submitAdd() {
    const section = (newOrgan.trim() || activeOrgan).trim();
    if (!section) { toast({ title: "Pick or type an organ first", variant: "destructive" }); return; }
    if (newText.trim().length < 3) { toast({ title: "Enter the finding text", variant: "destructive" }); return; }
    add.mutate({ modality, section, text: newText.trim(), abnormal: newAbnormal });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader
        title="Findings Library Manager"
        subtitle="Add, edit or remove findings by modality and organ — powers the Report Builder"
      />

      {/* seed prompt (pre-seed) */}
      {!seeded && !isLoading && (
        <Card className="border-amber-300 bg-amber-50/60 dark:bg-amber-950/20">
          <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
            <Database className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="flex-1 text-sm">
              <div className="font-medium">Load the editable findings library</div>
              <div className="text-muted-foreground">
                The Report Builder is currently using the read-only starter set ({starterFindings.length.toLocaleString()} findings).
                Load it into the database once to start adding, editing and deleting findings.
              </div>
            </div>
            <Button onClick={() => seed.mutate(undefined)} disabled={seed.isPending} className="shrink-0">
              {seed.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Database className="mr-1 h-4 w-4" />}
              Load starter library
            </Button>
          </CardContent>
        </Card>
      )}
      {seeded && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            <Check className="mr-1 inline h-3 w-3 text-emerald-600" />
            Editable library active · {metaCount.toLocaleString()} findings
          </span>
          <button
            onClick={() => {
              if (confirm("Reload the starter set? Old starter findings are replaced with the latest regrouped version. Your custom findings are kept.")) seed.mutate(true);
            }}
            disabled={seed.isPending}
            className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-muted"
            title="Replace starter findings with the latest regrouped set (custom findings are preserved)"
          >
            {seed.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
            Reload starter (keeps custom)
          </button>
        </div>
      )}

      {/* modality tabs */}
      <div className="flex flex-wrap gap-1.5">
        {MODALITIES.map((m) => (
          <button key={m} onClick={() => { setModality(m); setOrgan(""); }}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${modality === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
            {MODALITY_LABEL[m]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
        {/* organ list */}
        <Card className="overflow-hidden">
          <CardContent className="p-2">
            <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Organs / sections</div>
            <div className="max-h-[60vh] overflow-y-auto">
              {organs.length === 0 && <div className="p-3 text-xs text-muted-foreground">No findings yet for {MODALITY_LABEL[modality]}.</div>}
              {organs.map(([sec, n]) => (
                <button key={sec} onClick={() => setOrgan(sec)}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${sec === activeOrgan ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted/60"}`}>
                  <span className="truncate">{sec}</span>
                  <Badge variant="secondary" className="ml-2 h-5 shrink-0">{n}</Badge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* findings for modality + organ */}
        <Card className="overflow-hidden">
          <CardContent className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold">{MODALITY_LABEL[modality]} · {activeOrgan || "—"}</div>
              <div className="relative ml-auto w-56 max-w-full">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="h-8 pl-8 text-xs" />
              </div>
            </div>

            {/* add new */}
            <div className="flex flex-col gap-2 rounded-md border border-dashed p-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Plus className="h-3.5 w-3.5" /> Add a finding</div>
              <div className="flex flex-wrap items-center gap-2">
                <Input value={newOrgan} onChange={(e) => setNewOrgan(e.target.value)} placeholder={activeOrgan ? `Organ (default: ${activeOrgan})` : "Organ (e.g. Liver)"} className="h-8 w-40 text-xs" list="organ-options" />
                <datalist id="organ-options">{organs.map(([s]) => <option key={s} value={s} />)}</datalist>
                <Input value={newText} onChange={(e) => setNewText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }}
                  placeholder="Finding text — e.g. Cholelithiasis with multiple calculi." className="h-8 min-w-[220px] flex-1 text-xs" disabled={!seeded} />
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={newAbnormal} onChange={(e) => setNewAbnormal(e.target.checked)} /> abnormal
                </label>
                <Button size="sm" className="h-8" onClick={submitAdd} disabled={!seeded || add.isPending}>
                  {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
                </Button>
              </div>
              {!seeded && <div className="text-[11px] text-amber-600">Load the starter library above to enable editing.</div>}
            </div>

            {/* list */}
            <div className="flex flex-col gap-1">
              {rows.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">No findings{q ? " match your filter" : ""}.</div>}
              {rows.map((f) => (
                <div key={f.id} className="flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                  {editing?.id === f.id ? (
                    <>
                      <Input value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") update.mutate(editing); if (e.key === "Escape") setEditing(null); }}
                        autoFocus className="h-8 flex-1 text-sm" />
                      <label className="flex items-center gap-1 whitespace-nowrap text-xs">
                        <input type="checkbox" checked={editing.abnormal} onChange={(e) => setEditing({ ...editing, abnormal: e.target.checked })} /> abn
                      </label>
                      <Button size="sm" className="h-8" onClick={() => update.mutate(editing)} disabled={update.isPending}><Save className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(null)}><X className="h-4 w-4" /></Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1">
                        {f.text}
                        {f.abnormal
                          ? <AlertTriangle className="ml-1 inline h-3 w-3 align-text-top text-rose-500" />
                          : <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500 dark:bg-slate-800">normal</span>}
                        {f.source === "custom" && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">custom</span>}
                      </span>
                      <button title="Edit" onClick={() => setEditing({ id: f.id, text: f.text, abnormal: f.abnormal })} className="shrink-0 text-muted-foreground hover:text-foreground" disabled={!seeded}><Pencil className="h-3.5 w-3.5" /></button>
                      <button title="Delete" onClick={() => { if (confirm("Remove this finding?")) remove.mutate(f.id); }} className="shrink-0 text-muted-foreground hover:text-destructive" disabled={!seeded}><Trash2 className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
