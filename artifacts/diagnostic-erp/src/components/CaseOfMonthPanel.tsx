/**
 * Phase 10C: Case of the Month Panel
 * Select teaching cases and generate a monthly collection with quiz + slides stub.
 * AI Draft – Requires Radiologist Review
 */
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/fetchApi";
import { BookOpen, Plus, Trash2, Sparkles, Calendar, CheckSquare, Square } from "lucide-react";

interface TeachingCase {
  id: number;
  title: string;
  diagnosis: string | null;
  category: string;
  difficulty: string;
  modality: string | null;
}

interface Collection {
  id: number;
  name: string;
  description: string | null;
  caseIdsJson: string | null;
  createdAt: string;
}

export default function CaseOfMonthPanel() {
  const { toast } = useToast();
  const [cases, setCases] = useState<TeachingCase[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [name, setName] = useState(`Case of the Month — ${new Date().toLocaleString("en-IN", { month: "long", year: "numeric" })}`);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"select" | "history">("select");

  useEffect(() => {
    api.get<{ cases: TeachingCase[] }>("/api/teaching-cases?status=published&limit=50")
      .then((d) => setCases(d.cases ?? []))
      .catch(() => {});
    api.get<{ collections: Collection[] }>("/api/teaching-cases/collections")
      .then((d) => setCollections(d.collections ?? []))
      .catch(() => {});
  }, []);

  const toggleCase = (id: number) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const handleCreate = async () => {
    if (!name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    if (selectedIds.length === 0) { toast({ title: "Select at least one case", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await api.post("/api/teaching-cases/collections", {
        name: name.trim(),
        description: description.trim() || null,
        caseIds: selectedIds,
        isShared: true,
      });
      toast({ title: "Collection created!", description: "AI Draft — Requires Radiologist Review" });
      setSelectedIds([]);
      const d = await api.get<{ collections: Collection[] }>("/api/teaching-cases/collections");
      setCollections(d.collections ?? []);
      setTab("history");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Failed to create", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Calendar size={16} className="text-primary" />
        <span className="font-semibold text-sm">Case of the Month</span>
        <Badge variant="outline" className="text-[10px]">Phase 10C</Badge>
        <div className="flex-1" />
        <button onClick={() => setTab("select")} className={`text-xs px-2.5 py-1 rounded-lg transition ${tab === "select" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>New</button>
        <button onClick={() => setTab("history")} className={`text-xs px-2.5 py-1 rounded-lg transition ${tab === "history" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>Collections ({collections.length})</button>
      </div>

      {tab === "select" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[10px]">Collection Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-7 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px]">Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="h-7 text-xs" placeholder="Monthly collection for residents..." />
          </div>

          <div className="text-[10px] font-semibold text-muted-foreground uppercase">
            Select Cases ({selectedIds.length} selected)
          </div>

          <div className="max-h-64 overflow-y-auto space-y-1 border border-card-border rounded-lg p-2">
            {cases.length === 0 ? (
              <div className="text-[11px] text-muted-foreground text-center py-4">No published teaching cases yet.</div>
            ) : (
              cases.map((c) => (
                <button
                  key={c.id}
                  onClick={() => toggleCase(c.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition ${
                    selectedIds.includes(c.id) ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/50"
                  }`}
                >
                  {selectedIds.includes(c.id) ? <CheckSquare size={12} className="text-primary flex-none" /> : <Square size={12} className="text-muted-foreground flex-none" />}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{c.title}</div>
                    <div className="text-[10px] text-muted-foreground">{c.category} · {c.modality ?? "—"} · {c.difficulty}</div>
                  </div>
                  {c.diagnosis && <Badge variant="outline" className="text-[9px] flex-none">{c.diagnosis}</Badge>}
                </button>
              ))
            )}
          </div>

          <Button onClick={handleCreate} disabled={saving || selectedIds.length === 0} className="w-full" size="sm">
            <BookOpen size={14} className="mr-1.5" /> {saving ? "Creating..." : `Create Collection (${selectedIds.length} cases)`}
          </Button>
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-2">
          {collections.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No collections yet.</div>
          ) : (
            collections.map((col) => {
              const ids: number[] = (() => { try { return JSON.parse(col.caseIdsJson ?? "[]"); } catch { return []; } })();
              return (
                <div key={col.id} className="border border-card-border rounded-lg p-3 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <Calendar size={12} className="text-primary" />
                    <span className="font-semibold">{col.name}</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">{ids.length} case{ids.length !== 1 ? "s" : ""}</Badge>
                  </div>
                  {col.description && <p className="text-muted-foreground">{col.description}</p>}
                  <div className="text-[10px] text-muted-foreground">Created {new Date(col.createdAt).toLocaleDateString("en-IN")}</div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
