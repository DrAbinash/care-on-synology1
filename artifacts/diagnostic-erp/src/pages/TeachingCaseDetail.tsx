// Phase 8: Teaching Case Detail View
// Full view of a teaching case with images, notes, AI content, and PACS links.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useRoute } from "wouter";
import {
  Heart, Star, Eye, ArrowLeft, Stethoscope, Brain, Microscope,
  FlaskConical, AlertTriangle, FileText, Ruler, Tag, Clock,
  User, GraduationCap, Check, Bookmark, Share2,
} from "lucide-react";

interface TeachingCase {
  id: number;
  title: string;
  diagnosis: string | null;
  category: string;
  difficulty: string;
  modality: string | null;
  bodyPart: string | null;
  studyDescription: string | null;
  findings: string | null;
  impression: string | null;
  measurements: string | null;
  learningPoints: string | null;
  pearls: string | null;
  pitfalls: string | null;
  aiNotes: string | null;
  aiSummary: string | null;
  classification: string | null;
  classificationValue: string | null;
  tagsJson: string;
  isResearchCandidate: boolean;
  researchStatus: string | null;
  isAnonymized: boolean;
  viewCount: number;
  createdByName: string | null;
  createdAt: string;
  patientAge: string | null;
  patientGender: string | null;
}

interface TeachingCaseImage {
  id: number;
  imageUrl: string | null;
  imageData: string | null;
  thumbnailUrl: string | null;
  isKeyImage: boolean;
  description: string | null;
  sortOrder: number;
}

interface Note {
  id: number;
  userName: string | null;
  note: string;
  createdAt: string;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-green-100 text-green-700",
  intermediate: "bg-blue-100 text-blue-700",
  advanced: "bg-orange-100 text-orange-700",
  expert: "bg-red-100 text-red-700",
};

export default function TeachingCaseDetail() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [_, navigate] = useLocation();
  const [match, params] = useRoute("/teaching-cases/:id");
  const id = Number(params?.id ?? 0);
  const [newNote, setNewNote] = useState("");
  const [activeImage, setActiveImage] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["teaching-case", id],
    queryFn: () => api.get<{ case: TeachingCase; images: TeachingCaseImage[]; notes: Note[]; isFavorite: boolean }>(`/api/teaching-cases/${id}`),
    enabled: id > 0,
  });

  const caseData = data?.case;
  const images = data?.images ?? [];
  const notes = data?.notes ?? [];
  const isFavorite = data?.isFavorite ?? false;
  const tags = JSON.parse(caseData?.tagsJson ?? "[]") as string[];

  const toggleFavorite = useMutation({
    mutationFn: () => api.post(`/teaching-cases/${id}/favorite`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teaching-case", id] });
      qc.invalidateQueries({ queryKey: ["teaching-cases"] });
      toast({ title: isFavorite ? "Removed from favorites" : "Added to favorites" });
    },
  });

  const addNote = useMutation({
    mutationFn: () => api.post(`/teaching-cases/${id}/note`, { note: newNote }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teaching-case", id] });
      setNewNote("");
      toast({ title: "Note added" });
    },
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  if (!caseData) return <div className="p-6 text-sm text-muted-foreground">Case not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/teaching-cases")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      </div>

      <PageHeader title={caseData.title} subtitle={caseData.diagnosis ?? ""} />

      {/* Header info */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={DIFFICULTY_COLORS[caseData.difficulty]}>{caseData.difficulty}</Badge>
        <Badge variant="outline">{caseData.category}</Badge>
        {caseData.modality && <Badge variant="outline">{caseData.modality}</Badge>}
        {caseData.bodyPart && <Badge variant="outline">{caseData.bodyPart}</Badge>}
        {caseData.isResearchCandidate && <Badge className="bg-purple-100 text-purple-700">Research</Badge>}
        {caseData.isAnonymized && <Badge className="bg-green-100 text-green-700">Anonymized</Badge>}
        <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
          <Eye className="h-3 w-3" /> {caseData.viewCount} views
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => toggleFavorite.mutate()}>
          <Heart className={`h-4 w-4 mr-1 ${isFavorite ? "fill-red-500 text-red-500" : ""}`} />
          {isFavorite ? "Favorited" : "Favorite"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => toast({ title: "Share link copied" })}>
          <Share2 className="h-4 w-4 mr-1" /> Share
        </Button>
      </div>

      {/* Images */}
      {images.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Images</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {images.map((img) => (
              <div
                key={img.id}
                className={`border rounded-lg overflow-hidden cursor-pointer ${
                  img.isKeyImage ? "ring-2 ring-primary" : ""
                }`}
                onClick={() => setActiveImage(img.id)}
              >
                {img.imageData ? (
                  <img src={img.imageData} alt={img.description ?? ""} className="w-full h-32 object-cover" />
                ) : (
                  <div className="w-full h-32 bg-muted flex items-center justify-center text-xs text-muted-foreground">
                    {img.isKeyImage ? <Star className="h-4 w-4" /> : <Microscope className="h-4 w-4" />}
                  </div>
                )}
                {img.description && <div className="p-2 text-[11px] text-muted-foreground">{img.description}</div>}
                {img.isKeyImage && <div className="px-2 pb-1 text-[10px] text-primary font-medium">Key Image</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Case Data */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {caseData.studyDescription && (
          <div className="border rounded-lg p-3 bg-card space-y-1">
            <div className="text-sm font-medium flex items-center gap-2"><Stethoscope className="h-4 w-4" /> Study Description</div>
            <div className="text-sm text-muted-foreground">{caseData.studyDescription}</div>
          </div>
        )}
        {caseData.findings && (
          <div className="border rounded-lg p-3 bg-card space-y-1">
            <div className="text-sm font-medium flex items-center gap-2"><FileText className="h-4 w-4" /> Findings</div>
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">{caseData.findings}</div>
          </div>
        )}
        {caseData.impression && (
          <div className="border rounded-lg p-3 bg-card space-y-1">
            <div className="text-sm font-medium flex items-center gap-2"><Brain className="h-4 w-4" /> Impression</div>
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">{caseData.impression}</div>
          </div>
        )}
        {caseData.measurements && (
          <div className="border rounded-lg p-3 bg-card space-y-1">
            <div className="text-sm font-medium flex items-center gap-2"><Ruler className="h-4 w-4" /> Measurements</div>
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">{caseData.measurements}</div>
          </div>
        )}
        {caseData.learningPoints && (
          <div className="border rounded-lg p-3 bg-card space-y-1">
            <div className="text-sm font-medium flex items-center gap-2"><GraduationCap className="h-4 w-4" /> Learning Points</div>
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">{caseData.learningPoints}</div>
          </div>
        )}
        {caseData.pearls && (
          <div className="border rounded-lg p-3 bg-card space-y-1">
            <div className="text-sm font-medium flex items-center gap-2"><Star className="h-4 w-4" /> Pearls</div>
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">{caseData.pearls}</div>
          </div>
        )}
        {caseData.pitfalls && (
          <div className="border rounded-lg p-3 bg-card space-y-1">
            <div className="text-sm font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Pitfalls</div>
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">{caseData.pitfalls}</div>
          </div>
        )}
        {caseData.aiSummary && (
          <div className="border rounded-lg p-3 bg-card space-y-1 border-amber-200">
            <div className="text-sm font-medium flex items-center gap-2"><Brain className="h-4 w-4 text-amber-600" /> AI Summary</div>
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">{caseData.aiSummary}</div>
            <div className="text-[10px] text-amber-600">AI Generated Educational Content – Requires Radiologist Review</div>
          </div>
        )}
        {caseData.aiNotes && (
          <div className="border rounded-lg p-3 bg-card space-y-1 border-amber-200">
            <div className="text-sm font-medium flex items-center gap-2"><FlaskConical className="h-4 w-4 text-amber-600" /> AI Notes</div>
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">{caseData.aiNotes}</div>
            <div className="text-[10px] text-amber-600">AI Generated Educational Content – Requires Radiologist Review</div>
          </div>
        )}
        {caseData.classification && (
          <div className="border rounded-lg p-3 bg-card space-y-1">
            <div className="text-sm font-medium flex items-center gap-2"><Bookmark className="h-4 w-4" /> Classification</div>
            <div className="text-sm font-medium">{caseData.classification}: {caseData.classificationValue}</div>
          </div>
        )}
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => <Badge key={t} variant="outline" className="text-[10px]"><Tag className="h-3 w-3 mr-1" />{t}</Badge>)}
        </div>
      )}

      {/* Notes */}
      <div className="space-y-3">
        <div className="text-sm font-medium">Notes</div>
        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="border rounded-lg p-3 bg-card">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1">
                <User className="h-3 w-3" /> {n.userName} · <Clock className="h-3 w-3" /> {new Date(n.createdAt).toLocaleDateString()}
              </div>
              <div className="text-sm">{n.note}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note..."
            rows={2}
            className="text-sm flex-1"
          />
          <Button size="sm" onClick={() => addNote.mutate()} disabled={!newNote.trim()}>
            <Check className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Footer info */}
      <div className="text-[11px] text-muted-foreground flex items-center gap-2">
        <User className="h-3 w-3" /> Created by {caseData.createdByName} ·
        <Clock className="h-3 w-3" /> {new Date(caseData.createdAt).toLocaleDateString()} ·
        {caseData.patientAge && <span>Age: {caseData.patientAge}</span>} ·
        {caseData.patientGender && <span>Gender: {caseData.patientGender}</span>}
      </div>

      {/* AI Disclaimer */}
      <div className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded p-2 flex items-center gap-2">
        <AlertTriangle className="h-3 w-3" />
        This case is for educational purposes only. All patient identifiers have been removed. AI-generated content is educational and requires radiologist review.
      </div>
    </div>
  );
}
