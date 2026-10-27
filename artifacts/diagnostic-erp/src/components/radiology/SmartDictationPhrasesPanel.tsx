import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Mic, Plus, Trash2, Pencil, X, Save, FlaskConical, ShieldAlert } from "lucide-react";

/**
 * Smart Dictation findings — the radiologist's own dictation vocabulary.
 *
 * A finding added here is recognised by the SAME deterministic composer that
 * recognises the built-in six-exam catalogue: dictating one of its synonyms
 * prints exactly the Findings sentence stored here — no model rewrites it, no
 * wording is invented, and the optional "baseline normal to retire" field goes
 * through the same normal-retirement engine a Quick Select tile uses.
 *
 * Writes are admin/super-admin only (enforced server-side); dictators read.
 */

export type SmartDictationPhrase = {
  id: number;
  concept: string;
  label: string;
  families: string;
  synonyms: string;
  findingsText: string;
  impressionText: string;
  anatomicalSection: string;
  conflictGroup: string;
  baselineReplaces: string;
  enabled: boolean;
};

const FAMILY_OPTIONS = [
  { key: "brain", label: "Brain" },
  { key: "lumbar", label: "LS Spine" },
  { key: "cervical", label: "Cervical" },
  { key: "dorsal", label: "Dorsal (whole-spine)" },
] as const;

const EMPTY_FORM = {
  label: "",
  families: "lumbar" as string,
  synonyms: "",
  findingsText: "",
  impressionText: "",
  anatomicalSection: "",
  conflictGroup: "",
  baselineReplaces: "",
};

type FormState = typeof EMPTY_FORM;

function familyChips(families: string): string[] {
  return families.split(",").map((s) => s.trim()).filter(Boolean);
}

export default function SmartDictationPhrasesPanel({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [sample, setSample] = useState("");
  const [preview, setPreview] = useState<{ matches: Array<{ concept: string; findingsText: string }>; builtInMatches: Array<{ concept: string; findingsText: string }> } | null>(null);

  const { data: rows = [], error: listError } = useQuery<SmartDictationPhrase[]>({
    queryKey: ["smart-dictation-phrases"],
    queryFn: async () => {
      const res = await api.get<{ ok: boolean; rows: SmartDictationPhrase[] }>(
        "/api/radiology/voice-report-composer/phrases",
      );
      return res.rows ?? [];
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["smart-dictation-phrases"] });
  };

  const save = useMutation({
    mutationFn: async (payload: Partial<FormState>) => {
      if (editingId) {
        return api.patch(`/api/radiology/voice-report-composer/phrases/${editingId}`, payload);
      }
      return api.post("/api/radiology/voice-report-composer/phrases", payload);
    },
    onSuccess: () => {
      toast({ title: editingId ? "Finding updated" : "Finding added", description: "Dictation recognises it on the next turn." });
      setForm(EMPTY_FORM);
      setEditingId(null);
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Could not save the finding", description: err.message, variant: "destructive" });
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.patch(`/api/radiology/voice-report-composer/phrases/${id}`, { enabled }),
    onSuccess: invalidate,
    onError: (err: Error) => toast({ title: "Could not toggle", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`/api/radiology/voice-report-composer/phrases/${id}`),
    onSuccess: invalidate,
    onError: (err: Error) => toast({ title: "Could not delete", description: err.message, variant: "destructive" }),
  });

  const previewMutation = useMutation({
    mutationFn: async (body: { sample: string; families: string }) =>
      api.post<{ ok: boolean; matches: Array<{ concept: string; findingsText: string }>; builtInMatches: Array<{ concept: string; findingsText: string }> }>(
        "/api/radiology/voice-report-composer/phrases/preview",
        body,
      ),
    onSuccess: (res) => setPreview(res),
    onError: (err: Error) => toast({ title: "Preview failed", description: err.message, variant: "destructive" }),
  });

  const setField = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const toggleFamily = (key: string, on: boolean) => {
    const current = familyChips(form.families);
    const next = on
      ? [...new Set([...current, key])]
      : current.filter((f) => f !== key);
    setField("families", next.join(","));
  };

  const draftSynonyms = useMemo(
    () => form.synonyms.split(",").map((s) => s.trim()).filter(Boolean),
    [form.synonyms],
  );

  function submit() {
    if (!form.label.trim() || !form.findingsText.trim() || !draftSynonyms.length) {
      toast({ title: "Label, at least one synonym and the Findings sentence are required", variant: "destructive" });
      return;
    }
    save.mutate(form);
  }

  function startEdit(row: SmartDictationPhrase) {
    setEditingId(row.id);
    setForm({
      label: row.label,
      families: row.families,
      synonyms: row.synonyms,
      findingsText: row.findingsText,
      impressionText: row.impressionText,
      anatomicalSection: row.anatomicalSection,
      conflictGroup: row.conflictGroup,
      baselineReplaces: row.baselineReplaces,
    });
  }

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Mic size={16} className="text-primary" /> Smart Dictation findings
        </h3>
        <p className="text-xs text-muted-foreground">
          Teach Smart Dictation a NEW finding. Dictating any synonym prints exactly the sentence below —
          through the same composer, ledger and normal-retirement engine as a built-in finding. Built-in
          findings cannot be overridden here.
        </p>
      </div>

      {listError && (
        <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          Could not read the custom findings: {(listError as Error).message}. Dictation keeps working with
          the built-in catalogue.
        </div>
      )}

      {/* ── List ─────────────────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border bg-background p-3 space-y-1.5" data-testid={`smart-dictation-phrase-${row.concept}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium text-sm">{row.label}</span>
                  <code className="ml-2 text-[10px] text-muted-foreground">{row.concept}</code>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={row.enabled}
                    disabled={!isAdmin}
                    onCheckedChange={(v) => toggle.mutate({ id: row.id, enabled: v })}
                    aria-label={`Toggle ${row.label}`}
                  />
                  {isAdmin && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => startEdit(row)} aria-label={`Edit ${row.label}`}>
                        <Pencil size={13} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (window.confirm(`Delete the dictation finding "${row.label}"?`)) remove.mutate(row.id);
                        }}
                        aria-label={`Delete ${row.label}`}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <p className="text-xs">{row.findingsText}</p>
              <div className="flex flex-wrap gap-1">
                {familyChips(row.families).map((f) => (
                  <span key={f} className="rounded-full border bg-muted/50 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{f}</span>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">Synonyms: {row.synonyms}</p>
              {row.baselineReplaces && (
                <p className="text-[10px] text-muted-foreground">Retires: “{row.baselineReplaces}”</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Add / edit form ───────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide">
              {editingId ? "Edit finding" : "Add a finding"}
            </h4>
            {editingId && (
              <Button variant="ghost" size="sm" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}>
                <X size={13} className="mr-1" /> Cancel
              </Button>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Finding name</Label>
              <Input
                value={form.label}
                onChange={(e) => setField("label", e.target.value)}
                placeholder="Tarlov cyst"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Dictated words to match (comma-separated)</Label>
              <Input
                value={form.synonyms}
                onChange={(e) => setField("synonyms", e.target.value)}
                placeholder="tarlov cyst, perineural cyst"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Findings sentence (dictation writes exactly this)</Label>
            <Textarea
              value={form.findingsText}
              onChange={(e) => setField("findingsText", e.target.value)}
              placeholder="Well-defined T2 hyperintense Tarlov cyst at S1."
              rows={2}
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Impression sentence (optional)</Label>
              <Input
                value={form.impressionText}
                onChange={(e) => setField("impressionText", e.target.value)}
                placeholder="Tarlov cyst at S1."
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Baseline normal to retire (optional, exact sentence)</Label>
              <Input
                value={form.baselineReplaces}
                onChange={(e) => setField("baselineReplaces", e.target.value)}
                placeholder="Sacrum is normal."
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Anatomical section (optional)</Label>
              <Input
                value={form.anatomicalSection}
                onChange={(e) => setField("anatomicalSection", e.target.value)}
                placeholder="sacrum"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Conflict group (optional)</Label>
              <Input
                value={form.conflictGroup}
                onChange={(e) => setField("conflictGroup", e.target.value)}
                placeholder="sacral_lesion"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Applies to</Label>
            <div className="flex flex-wrap gap-3">
              {FAMILY_OPTIONS.map((f) => (
                <label key={f.key} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={familyChips(form.families).includes(f.key)}
                    onChange={(e) => toggleFamily(f.key, e.target.checked)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </div>

          <Button onClick={submit} disabled={save.isPending} size="sm">
            {save.isPending ? "Saving…" : editingId ? <><Save size={13} className="mr-1" /> Save</> : <><Plus size={13} className="mr-1" /> Add finding</>}
          </Button>
        </div>
      )}

      {/* ── Offline test box ─────────────────────────────────────────────── */}
      <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <FlaskConical size={14} className="text-primary" />
          <h4 className="text-xs font-semibold uppercase tracking-wide">Test the vocabulary</h4>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Type a sample dictation to see what it would print — the same literal matching the composer
          runs, no model involved.
        </p>
        <div className="flex gap-2">
          <Input
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder="there is a tarlov cyst at S1"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => sample.trim() && previewMutation.mutate({ sample, families: form.families || "lumbar" })}
            disabled={previewMutation.isPending}
          >
            Test
          </Button>
        </div>
        {preview && (
          <div className="space-y-1 text-[11px]">
            {preview.matches.length === 0 && preview.builtInMatches.length === 0 && (
              <p className="text-muted-foreground">
                No match yet — add the finding above with the synonyms you just typed.
              </p>
            )}
            {preview.matches.map((m) => (
              <p key={`c-${m.concept}`} className="text-emerald-700">
                ✓ Custom “{m.concept}” will write: {m.findingsText}
              </p>
            ))}
            {preview.builtInMatches.map((m) => (
              <p key={`b-${m.concept}`} className="text-muted-foreground">
                Built-in “{m.concept}” also matches: {m.findingsText}
              </p>
            ))}
          </div>
        )}
      </div>

      {!isAdmin && (
        <p className="text-xs text-amber-700 flex items-center gap-1.5">
          <ShieldAlert size={13} /> Only administrators can add or edit dictation findings.
        </p>
      )}
    </div>
  );
}
