import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen, Plus, Pencil, Trash2, History, RotateCcw,
  AlertTriangle, ShieldAlert, X, Save, Filter,
} from "lucide-react";

// Types mirror artifacts/api-server/src/routes/knowledgeBase.ts exactly.

interface KbEntry {
  id: number;
  category: string;
  title: string;
  content: string;
  keywords: string;
  status: "draft" | "suggested" | "published" | "archived";
  version: number;
  isSensitive: boolean;
  suggestedFromQuestion: string | null;
  suggestedReason: string | null;
  createdBy: string;
  updatedBy: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface KbHistoryRow {
  id: number;
  entryId: number;
  version: number;
  title: string;
  content: string;
  keywords: string;
  changedBy: string;
  changeType: string;
  createdAt: string;
}

interface KbCategoryInfo {
  category: string;
  sensitive: boolean;
}

interface KbGapRow {
  query: string;
  count: number;
  lastSeenAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  suggested: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  archived: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

function formatCategory(c: string): string {
  return c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function errMsg(err: unknown): string {
  if (err && typeof err === "object" && "error" in err) return String((err as { error: unknown }).error);
  return err instanceof Error ? err.message : "Unknown error";
}

export default function KnowledgeBaseManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showGaps, setShowGaps] = useState(false);
  const [editing, setEditing] = useState<KbEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ category: string; title: string; content: string; keywords: string; status: string }>({ category: "faqs", title: "", content: "", keywords: "", status: "draft" });

  const categoriesQ = useQuery({
    queryKey: ["kb-categories"],
    queryFn: () => api.get<KbCategoryInfo[]>("/api/knowledge-base/categories"),
  });

  const entriesQ = useQuery({
    queryKey: ["kb-entries", categoryFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (categoryFilter) params.set("category", categoryFilter);
      if (statusFilter) params.set("status", statusFilter);
      const qs = params.toString();
      return api.get<KbEntry[]>(`/api/knowledge-base${qs ? `?${qs}` : ""}`);
    },
  });

  const gapsQ = useQuery({
    queryKey: ["kb-gaps"],
    queryFn: () => api.get<KbGapRow[]>("/api/knowledge-base/admin/gaps"),
    enabled: showGaps,
  });

  const historyQ = useQuery({
    queryKey: ["kb-history", historyFor],
    queryFn: () => api.get<KbEntry & { history: KbHistoryRow[] }>(`/api/knowledge-base/${historyFor}`),
    enabled: historyFor !== null,
  });

  const createMut = useMutation({
    mutationFn: (body: typeof draft) => api.post<KbEntry>("/api/knowledge-base", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kb-entries"] });
      setCreating(false);
      setDraft({ category: "faqs", title: "", content: "", keywords: "", status: "draft" });
      toast({ title: "Entry created" });
    },
    onError: (err: unknown) => toast({ title: "Could not create entry", description: errMsg(err), variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<KbEntry> }) => api.put<KbEntry>(`/api/knowledge-base/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kb-entries"] });
      setEditing(null);
      toast({ title: "Entry saved" });
    },
    onError: (err: unknown) => toast({ title: "Could not save entry", description: errMsg(err), variant: "destructive" }),
  });

  const archiveMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/knowledge-base/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kb-entries"] });
      toast({ title: "Entry archived" });
    },
    onError: (err: unknown) => toast({ title: "Could not archive entry", description: errMsg(err), variant: "destructive" }),
  });

  const rollbackMut = useMutation({
    mutationFn: ({ id, version }: { id: number; version: number }) => api.post(`/api/knowledge-base/${id}/rollback/${version}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kb-entries"] });
      qc.invalidateQueries({ queryKey: ["kb-history"] });
      toast({ title: "Rolled back to that version" });
    },
    onError: (err: unknown) => toast({ title: "Could not roll back", description: errMsg(err), variant: "destructive" }),
  });

  const categories = categoriesQ.data ?? [];
  const entries = entriesQ.data ?? [];

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Knowledge Base"
        subtitle="Content the AI Receptionist (WhatsApp, and future channels) answers from. Nothing here reaches a patient until status is Published."
        actions={
          <>
            <Button variant={showGaps ? "default" : "outline"} size="sm" onClick={() => setShowGaps((v) => !v)}>
              <AlertTriangle className="h-4 w-4 mr-1.5" /> Knowledge Gaps
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> New Entry
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6">
        {showGaps && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-4">
            <h2 className="font-semibold text-sm flex items-center gap-2 mb-2 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" /> Questions the AI couldn't answer
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              These were asked via WhatsApp (or another connected channel) and matched no published Knowledge Base entry, so the AI handed the patient to staff instead of guessing. Each one is a real opportunity to add content.
            </p>
            {gapsQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (gapsQ.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No unanswered questions recorded yet.</p>
            ) : (
              <div className="space-y-1.5">
                {gapsQ.data!.map((g, i) => (
                  <div key={i} className="flex items-center justify-between bg-card rounded-md px-3 py-2 text-sm border border-border">
                    <span className="truncate">{g.query}</span>
                    <span className="text-xs text-muted-foreground ml-2 shrink-0">
                      asked {g.count}× · last {new Date(g.lastSeenAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.category} value={c.category}>
                {formatCategory(c.category)}{c.sensitive ? " (sensitive)" : ""}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="suggested">Suggested</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {creating && (
          <EntryForm
            value={draft}
            categories={categories}
            onChange={setDraft}
            onCancel={() => setCreating(false)}
            onSave={() => createMut.mutate(draft)}
            saving={createMut.isPending}
            title="New Knowledge Base Entry"
          />
        )}

        {entriesQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No entries match these filters yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((e) => (
              <div key={e.id} className="rounded-lg border border-border bg-card p-4">
                {editing?.id === e.id ? (
                  <EntryForm
                    value={editing}
                    categories={categories}
                    onChange={(v) => setEditing(v as KbEntry)}
                    onCancel={() => setEditing(null)}
                    onSave={() => updateMut.mutate({ id: e.id, body: { title: editing.title, content: editing.content, keywords: editing.keywords, status: editing.status } })}
                    saving={updateMut.isPending}
                    title={`Editing v${e.version}`}
                  />
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[e.status]}`}>{e.status}</span>
                          <span className="text-xs text-muted-foreground">{formatCategory(e.category)}</span>
                          {e.isSensitive && (
                            <span className="text-xs flex items-center gap-1 text-rose-600 dark:text-rose-400" title="Requires clinical authorization to edit">
                              <ShieldAlert className="h-3 w-3" /> Sensitive
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">v{e.version}</span>
                        </div>
                        <h3 className="font-semibold text-sm truncate">{e.title}</h3>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{e.content}</p>
                        {e.keywords && <p className="text-xs text-muted-foreground mt-1.5">Keywords: {e.keywords}</p>}
                        {e.status === "suggested" && e.suggestedFromQuestion && (
                          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1.5">
                            Suggested because a patient asked: "{e.suggestedFromQuestion}"
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(e)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setHistoryFor(historyFor === e.id ? null : e.id)} title="Version history">
                          <History className="h-4 w-4" />
                        </Button>
                        {e.status !== "archived" && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => archiveMut.mutate(e.id)} title="Archive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {historyFor === e.id && (
                      <div className="mt-3 pt-3 border-t border-border">
                        {historyQ.isLoading ? (
                          <p className="text-xs text-muted-foreground">Loading history…</p>
                        ) : (historyQ.data?.history.length ?? 0) === 0 ? (
                          <p className="text-xs text-muted-foreground">No prior versions — this is the first version.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {historyQ.data!.history.map((h) => (
                              <div key={h.id} className="flex items-center justify-between text-xs bg-muted/50 rounded px-2.5 py-1.5">
                                <span className="truncate">
                                  v{h.version} · {h.changeType} by {h.changedBy || "unknown"} · {new Date(h.createdAt).toLocaleString()}
                                </span>
                                <Button
                                  variant="ghost" size="sm" className="h-6 px-2 text-xs shrink-0"
                                  onClick={() => rollbackMut.mutate({ id: e.id, version: h.version })}
                                >
                                  <RotateCcw className="h-3 w-3 mr-1" /> Restore
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EntryForm({
  value, categories, onChange, onCancel, onSave, saving, title,
}: {
  value: { category: string; title: string; content: string; keywords: string; status: string };
  categories: KbCategoryInfo[];
  onChange: (v: typeof value) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><BookOpen className="h-4 w-4" /> {title}</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel}><X className="h-4 w-4" /></Button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Category</label>
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={value.category}
            onChange={(e) => onChange({ ...value, category: e.target.value })}
          >
            {categories.map((c) => (
              <option key={c.category} value={c.category}>
                {formatCategory(c.category)}{c.sensitive ? " (requires clinical authorization)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={value.status}
            onChange={(e) => onChange({ ...value, status: e.target.value })}
          >
            <option value="draft">Draft — not visible to AI</option>
            <option value="suggested">Suggested — awaiting review</option>
            <option value="published">Published — AI will use this</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Title</label>
        <Input value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} placeholder="e.g. MRI Preparation Instructions" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Content</label>
        <Textarea
          value={value.content}
          onChange={(e) => onChange({ ...value, content: e.target.value })}
          rows={5}
          placeholder="Write exactly what the AI should tell a patient who asks about this. The AI is instructed to answer only from this text."
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Keywords (comma-separated, helps the AI find this)</label>
        <Input value={value.keywords} onChange={(e) => onChange({ ...value, keywords: e.target.value })} placeholder="e.g. mri, fasting, prep, brain scan" />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={onSave} disabled={saving || !value.title.trim() || !value.content.trim()}>
          <Save className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
