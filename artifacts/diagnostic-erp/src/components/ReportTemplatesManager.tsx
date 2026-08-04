/**
 * Lab & general diagnostic report templates (report_templates table).
 * Used by Report Generator — NOT radiology structured/normal templates.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Pencil, FileCode } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type ReportTemplate = {
  id: number;
  testId: number;
  name: string;
  format: string;
  content: string;
  isDefault: boolean;
  tags: string | null;
  modality: string | null;
};

type LiteTest = { id: number; code: string; name: string; category: string };

type FormState = {
  testId: string;
  name: string;
  format: string;
  content: string;
  isDefault: boolean;
  tags: string;
  modality: string;
};

const EMPTY_FORM: FormState = {
  testId: "",
  name: "",
  format: "text",
  content: "",
  isDefault: false,
  tags: "",
  modality: "",
};

export default function ReportTemplatesManager({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: templates = [], isLoading } = useQuery<ReportTemplate[]>({
    queryKey: ["report-templates"],
    queryFn: () => api.get("/api/report-templates"),
  });
  const { data: tests = [] } = useQuery<LiteTest[]>({
    queryKey: ["report-templates-tests"],
    queryFn: async () => {
      const r = await api.get<{ tests: LiteTest[]; total: number } | LiteTest[]>("/api/tests");
      return Array.isArray(r) ? r : (r?.tests ?? []);
    },
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ReportTemplate | null>(null);
  const [search, setSearch] = useState("");
  const [filterTest, setFilterTest] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const testMap = new Map(tests.map((t) => [t.id, t]));
  const reset = () => { setEditing(null); setForm(EMPTY_FORM); };

  const create = useMutation({
    mutationFn: (b: FormState) => api.post("/api/report-templates", { ...b, testId: Number(b.testId) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["report-templates"] });
      setOpen(false);
      reset();
      toast({ title: "Template created" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const update = useMutation({
    mutationFn: ({ id, b }: { id: number; b: FormState }) =>
      api.patch(`/api/report-templates/${id}`, { ...b, testId: Number(b.testId) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["report-templates"] });
      setOpen(false);
      reset();
      toast({ title: "Template updated" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/report-templates/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["report-templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const onEdit = (t: ReportTemplate) => {
    setEditing(t);
    setForm({
      testId: String(t.testId),
      name: t.name,
      format: t.format,
      content: t.content,
      isDefault: t.isDefault,
      tags: t.tags || "",
      modality: t.modality || "",
    });
    setOpen(true);
  };

  const onSubmit = () => {
    if (!form.testId || !form.name.trim() || !form.content.trim()) {
      toast({ title: "Test, name and content are required", variant: "destructive" });
      return;
    }
    if (editing) update.mutate({ id: editing.id, b: form });
    else create.mutate(form);
  };

  const filtered = templates.filter((t) => {
    if (filterTest && String(t.testId) !== filterTest) return false;
    if (search) {
      const q = search.toLowerCase();
      const test = testMap.get(t.testId);
      if (!t.name.toLowerCase().includes(q)
        && !(test?.name.toLowerCase().includes(q))
        && !(t.tags || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-3">
      <div className={`bg-card border border-border rounded-xl p-4 flex items-center justify-between flex-wrap gap-3 ${embedded ? "" : ""}`}>
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <FileCode size={16} /> Report Templates
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Per-test templates for Lab &amp; Report Generator. Mark one default per test for auto-load.
            Radiology uses separate templates under Radiology Settings.
          </p>
        </div>
        <Button onClick={() => { reset(); setOpen(true); }}>
          <Plus size={14} className="mr-1" /> New Template
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <Label className="text-xs">Search</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Template name, test or tag" className="h-9" />
        </div>
        <div className="min-w-[200px]">
          <Label className="text-xs">Filter by Test</Label>
          <Select value={filterTest || "__all__"} onValueChange={(v) => setFilterTest(v === "__all__" ? "" : v)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__all__">All tests</SelectItem>
              {tests.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>{t.code} — {t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium text-xs">Test</th>
              <th className="px-3 py-2 font-medium text-xs">Template Name</th>
              <th className="px-3 py-2 font-medium text-xs">Format</th>
              <th className="px-3 py-2 font-medium text-xs">Modality</th>
              <th className="px-3 py-2 font-medium text-xs">Tags</th>
              <th className="px-3 py-2 font-medium text-xs text-center">Default</th>
              <th className="px-3 py-2 font-medium text-xs text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {templates.length > 0 ? "No templates matching filters" : "No templates yet — create your first template"}
                </td>
              </tr>
            ) : filtered.map((t) => {
              const test = testMap.get(t.testId);
              return (
                <tr key={t.id} className="border-t border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2 text-xs">
                    {test ? <span><span className="font-mono">{test.code}</span> — {test.name}</span> : `Test #${t.testId}`}
                  </td>
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className="px-3 py-2"><Badge variant="outline">{t.format}</Badge></td>
                  <td className="px-3 py-2 text-xs">{t.modality || "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-xs truncate" title={t.tags || ""}>{t.tags || "—"}</td>
                  <td className="px-3 py-2 text-center">
                    {t.isDefault
                      ? <Badge className="bg-violet-100 text-violet-700">Default</Badge>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => onEdit(t)}><Pencil size={13} /></Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { if (confirm(`Delete "${t.name}"?`)) remove.mutate(t.id); }}
                      >
                        <Trash2 size={13} className="text-rose-500" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Template" : "New Report Template"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Test *</Label>
              <Select value={form.testId} onValueChange={(v) => setForm({ ...form, testId: v })}>
                <SelectTrigger><SelectValue placeholder="Select test" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {tests.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.code} — {t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Standard PA View" />
            </div>
            <div>
              <Label className="text-xs">Format</Label>
              <Select value={form.format} onValueChange={(v) => setForm({ ...form, format: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">text</SelectItem>
                  <SelectItem value="html">html</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Modality</Label>
              <Input value={form.modality} onChange={(e) => setForm({ ...form, modality: e.target.value })} placeholder="USG, CT, LAB, ECG…" />
            </div>
            <div>
              <Label className="text-xs">Tags (comma-separated)</Label>
              <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="fatty liver, hepatomegaly" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Content (use [PLACEHOLDERS]) *</Label>
              <Textarea
                rows={10}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                className="font-mono text-xs"
                placeholder={"Patient: [PATIENT_NAME]\nAge: [AGE]\n..."}
              />
            </div>
            <label className="flex items-center gap-2 col-span-2 text-sm">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              Mark as default for this test (auto-loaded by Report Generator)
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
            <Button onClick={onSubmit}>{editing ? "Save" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
