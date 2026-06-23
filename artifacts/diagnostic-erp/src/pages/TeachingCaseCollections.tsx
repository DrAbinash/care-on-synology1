// Phase 8: Teaching Case Collections
// Manage curated collections of teaching cases.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { isFeatureEnabled } from "@/lib/staffSession";
import CaseOfMonthPanel from "@/components/CaseOfMonthPanel";
import {
  Layers, BookOpen, Plus, Trash2, ArrowLeft, Lock, Unlock,
  GraduationCap, Star, Eye, Folder, Calendar,
} from "lucide-react";

interface Collection {
  id: number;
  name: string;
  description: string | null;
  isPublic: boolean;
  createdByName: string | null;
  caseCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function TeachingCaseCollections() {
  const { toast } = useToast();
  const [_, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  const { data } = useQuery({
    queryKey: ["teaching-collections"],
    queryFn: async () => {
      return api.get<{ collections: Collection[] }>("/teaching-cases/collections");
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: { name: string; description: string; isShared: boolean }) => {
      return api.post<{ collection: Collection }>("/teaching-cases/collections", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teaching-collections"] });
      setShowNew(false);
      setName("");
      setDesc("");
      setIsPublic(false);
      toast({ title: "Collection created", description: "Your teaching case collection has been created." });
    },
    onError: () => {
      toast({ title: "Failed", description: "Could not create collection.", variant: "destructive" });
    },
  });

  const collections = data?.collections ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teaching Collections"
        subtitle="Organize and share curated groups of teaching cases"
      />

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => navigate("/teaching-cases")}>
          <ArrowLeft size={16} className="mr-2" /> Back to Teaching Files
        </Button>
        <Button onClick={() => setShowNew(!showNew)}>
          <Plus size={16} className="mr-2" /> New Collection
        </Button>
      </div>

      {/* Case of the Month panel — gated by caseOfMonth feature flag */}
      {isFeatureEnabled("caseOfMonth") && (
        <div className="border border-orange-200 bg-orange-50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={16} className="text-orange-600" />
            <span className="font-semibold text-sm text-orange-800">Case of the Month</span>
            <Badge className="bg-orange-100 text-orange-700 text-[10px]">Editorial</Badge>
          </div>
          <CaseOfMonthPanel />
        </div>
      )}

      {showNew && (
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Folder size={16} /> New Collection
          </h3>
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., MRI Brain Tumors" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Brief description..." />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            Public (visible to all staff)
          </label>
          <div className="flex gap-2">
            <Button onClick={() => createMutation.mutate({ name, description: desc, isShared: isPublic })} disabled={!name.trim() || createMutation.isPending}>
              Create
            </Button>
            <Button variant="outline" onClick={() => setShowNew(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {collections.map((col: Collection) => (
          <CollectionCard key={col.id} col={col} onNavigate={() => navigate(`/teaching-collections/${col.id}`)} />
        ))}
        {collections.length === 0 && !showNew && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            <Layers size={48} className="mx-auto mb-3 opacity-50" />
            <p>No collections yet. Create one to organize teaching cases.</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface CollectionCardProps { col: Collection; onNavigate: () => void; }

function CollectionCard({ col, onNavigate }: CollectionCardProps) {
  const { toast } = useToast();
  const [quiz, setQuiz] = useState<Record<string, unknown> | null>(null);
  const [journalClub, setJournalClub] = useState<Record<string, unknown> | null>(null);
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [generatingJournal, setGeneratingJournal] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleGenerateQuiz = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setGeneratingQuiz(true);
    try {
      const r = await api.post<{ quiz: Record<string, unknown>; aiGenerated: boolean }>(`/api/teaching-cases/collections/${col.id}/generate-quiz`, {});
      setQuiz(r.quiz);
      setExpanded(true);
      toast({ title: "Quiz generated", description: "AI Draft — Requires Faculty Review" });
    } catch {
      toast({ title: "Quiz generation failed", variant: "destructive" });
    } finally {
      setGeneratingQuiz(false);
    }
  };

  const handleGenerateJournalClub = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setGeneratingJournal(true);
    try {
      const r = await api.post<{ journalClub: Record<string, unknown>; aiGenerated: boolean }>(`/api/teaching-cases/collections/${col.id}/generate-journal-club`, {});
      setJournalClub(r.journalClub);
      setExpanded(true);
      toast({ title: "Journal club guide generated", description: "AI Draft — Requires Faculty Review" });
    } catch {
      toast({ title: "Journal club generation failed", variant: "destructive" });
    } finally {
      setGeneratingJournal(false);
    }
  };

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden hover:shadow-md transition">
      <div className="p-5 cursor-pointer" onClick={onNavigate}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Folder size={20} className="text-primary" />
            <h3 className="font-semibold">{col.name}</h3>
          </div>
          {col.isPublic ? <Unlock size={14} className="text-muted-foreground" /> : <Lock size={14} className="text-muted-foreground" />}
        </div>
        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{col.description || "No description"}</p>
        <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><BookOpen size={12} /> {col.caseCount} cases</span>
          <span className="flex items-center gap-1"><Eye size={12} /> {col.createdByName}</span>
        </div>
      </div>

      {/* Case of Month AI Generation Buttons */}
      <div className="border-t border-border px-4 py-3 flex flex-wrap gap-2 bg-muted/20">
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7"
          disabled={generatingQuiz}
          onClick={handleGenerateQuiz}
        >
          <GraduationCap size={12} className="mr-1.5" />
          {generatingQuiz ? "Generating..." : "Generate Quiz"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7"
          disabled={generatingJournal}
          onClick={handleGenerateJournalClub}
        >
          <Star size={12} className="mr-1.5" />
          {generatingJournal ? "Generating..." : "Journal Club Guide"}
        </Button>
      </div>

      {/* Generated outputs */}
      {expanded && (quiz || journalClub) && (
        <div className="border-t border-border p-4 space-y-4 text-xs bg-muted/10">
          <div className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
            ⚠ AI Draft — Requires Faculty Review before use
          </div>
          {quiz && (
            <div className="space-y-2">
              <div className="font-semibold text-[11px] uppercase text-muted-foreground">Quiz</div>
              {(quiz.questions as Array<Record<string, unknown>> | undefined)?.map((q, i) => (
                <div key={i} className="border rounded p-2 space-y-1">
                  <p className="font-medium">{i + 1}. {String(q.question ?? "")}</p>
                  <ul className="space-y-0.5 ml-3">
                    {(q.options as string[] | undefined)?.map((opt, j) => (
                      <li key={j} className="text-muted-foreground">{opt}</li>
                    ))}
                  </ul>
                  {q.answer != null && <p className="text-green-700 font-medium">Answer: {String(q.answer)}</p>}
                </div>
              )) ?? <pre className="whitespace-pre-wrap text-[11px]">{JSON.stringify(quiz, null, 2)}</pre>}
            </div>
          )}
          {journalClub && (
            <div className="space-y-2">
              <div className="font-semibold text-[11px] uppercase text-muted-foreground">Journal Club Guide</div>
              {journalClub.overview != null && <p>{String(journalClub.overview)}</p>}
              {(journalClub.discussionPoints as string[] | undefined)?.length ? (
                <ul className="list-disc ml-4 space-y-0.5">
                  {(journalClub.discussionPoints as string[]).map((pt, i) => <li key={i}>{pt}</li>)}
                </ul>
              ) : null}
              {(journalClub.slideOutline as string[] | undefined)?.length ? (
                <div>
                  <div className="font-medium mb-0.5">Slide Outline</div>
                  <ol className="list-decimal ml-4 space-y-0.5">
                    {(journalClub.slideOutline as string[]).map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
              ) : null}
            </div>
          )}
          <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setExpanded(false)}>
            Collapse
          </Button>
        </div>
      )}
    </div>
  );
}
