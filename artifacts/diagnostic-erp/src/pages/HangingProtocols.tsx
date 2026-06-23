import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Plus, Pencil, Trash2, LayoutGrid, Monitor,
} from "lucide-react";

type Protocol = {
  id: number;
  name: string;
  modality: string | null;
  bodyPart: string | null;
  layoutType: string;
  seriesCount: number;
  layoutConfig: string | Record<string, unknown>;
  templateSuggestion: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
};

const LAYOUT_TYPES = [
  { value: "1x1", label: "1×1 (Single)" },
  { value: "1x2", label: "1×2 (Stacked)" },
  { value: "2x2", label: "2×2 (Quad)" },
  { value: "2x3", label: "2×3 (Six)" },
  { value: "3x3", label: "3×3 (Grid)" },
  { value: "mpr", label: "MPR (Axial/Sag/Cor)" },
  { value: "cine", label: "Cine (4-up)" },
  { value: "custom", label: "Custom" },
];

export default function HangingProtocols() {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Protocol | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<Partial<Protocol>>({ layoutType: "2x2", isDefault: false, isActive: true });

  const { data, isLoading } = useQuery({
    queryKey: ["hanging-protocols"],
    queryFn: () => api.get<{ protocols: Protocol[] }>("/api/dicom-studies/hanging-protocols"),
  });

  const saveMut = useMutation({
    mutationFn: () => {
      if (isNew) return api.post<Protocol>("/api/dicom-studies/hanging-protocols", form);
      return api.patch<Protocol>(`/api/dicom-studies/hanging-protocols/${dialog!.id}`, form);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hanging-protocols"] }); setDialog(null); setIsNew(false); },
  });

  const delMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/dicom-studies/hanging-protocols/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hanging-protocols"] }),
  });

  const protocols = data?.protocols ?? [];

  const openNew = () => {
    setIsNew(true);
    setDialog({ id: 0, name: "", layoutType: "2x2", seriesCount: 1, layoutConfig: "{}", isDefault: false, isActive: true, createdAt: "" } as Protocol);
    setForm({ layoutType: "2x2", isDefault: false, isActive: true });
  };

  const openEdit = (p: Protocol) => {
    setIsNew(false);
    setDialog(p);
    setForm({ ...p });
  };

  return (
    <div>
      <PageHeader
        title="Hanging Protocols"
        subtitle="Configure viewer layouts per modality and body part"
        actions={
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> New Protocol</Button>
        }
      />

      <div className="px-4 sm:px-6 py-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="animate-spin h-5 w-5" /> Loading...</div>
        ) : protocols.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No hanging protocols configured yet.</div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Modality</TableHead>
                  <TableHead>Body Part</TableHead>
                  <TableHead>Layout</TableHead>
                  <TableHead>Series</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {protocols.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.modality || "—"}</TableCell>
                    <TableCell>{p.bodyPart || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="gap-1"><LayoutGrid className="h-3 w-3" /> {p.layoutType.toUpperCase()}</Badge></TableCell>
                    <TableCell>{p.seriesCount}</TableCell>
                    <TableCell className="text-xs">{p.templateSuggestion || "—"}</TableCell>
                    <TableCell>{p.isDefault ? <Badge variant="default">Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
                    <TableCell>{p.isActive ? <Badge variant="default">Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => delMut.mutate(p.id)} disabled={delMut.isPending}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{isNew ? "New Hanging Protocol" : "Edit Hanging Protocol"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name || ""} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Modality</Label><Input placeholder="e.g. CT" value={form.modality || ""} onChange={(e) => setForm((p) => ({ ...p, modality: e.target.value }))} /></div>
              <div><Label>Body Part</Label><Input placeholder="e.g. Chest" value={form.bodyPart || ""} onChange={(e) => setForm((p) => ({ ...p, bodyPart: e.target.value }))} /></div>
            </div>
            <div><Label>Layout Type</Label>
              <Select value={form.layoutType || "2x2"} onValueChange={(v) => setForm((p) => ({ ...p, layoutType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LAYOUT_TYPES.map((lt) => (<SelectItem key={lt.value} value={lt.value}>{lt.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Series Count</Label><Input type="number" value={form.seriesCount ?? 1} onChange={(e) => setForm((p) => ({ ...p, seriesCount: Number(e.target.value) }))} /></div>
            <div><Label>Template Suggestion</Label><Input placeholder="e.g. CHEST_CT" value={form.templateSuggestion || ""} onChange={(e) => setForm((p) => ({ ...p, templateSuggestion: e.target.value }))} /></div>
            <div className="flex items-center gap-3">
              <Switch id="default" checked={form.isDefault ?? false} onCheckedChange={(v) => setForm((p) => ({ ...p, isDefault: v }))} />
              <Label htmlFor="default">Set as default for this modality + body part</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="active" checked={form.isActive ?? true} onCheckedChange={(v) => setForm((p) => ({ ...p, isActive: v }))} />
              <Label htmlFor="active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.name}>
              <Monitor className="h-4 w-4 mr-1" /> {saveMut.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
