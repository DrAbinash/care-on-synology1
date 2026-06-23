// Phase 8: Teaching Case Favorites
// Personal library of starred teaching cases.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  Heart, Star, ArrowLeft, BookOpen, Eye, Trash2,
  Brain, Microscope, FlaskConical, AlertTriangle,
  Stethoscope, HeartPulse, Baby, Bone, Activity,
} from "lucide-react";

interface TeachingCase {
  id: number;
  title: string;
  diagnosis: string | null;
  category: string;
  difficulty: string;
  modality: string | null;
  bodyPart: string | null;
  viewCount: number;
  tagsJson: string;
  createdByName: string | null;
  isResearchCandidate: boolean;
  classification: string | null;
  classificationValue: string | null;
  createdAt: string;
  favoriteId?: number;
  favoritedAt?: string;
}

const CATEGORY_ICONS: Record<string, typeof Brain> = {
  "MRI Brain": Brain, "MRI Spine": Bone, "CT Brain": Brain, "CT Chest": HeartPulse,
  "USG General": Eye, "USG Obstetric": Baby, "Breast Imaging": Heart, "Head & Neck": Eye,
  "Emergency": AlertTriangle, "Trauma": Bone, "Pediatric": Baby,
  "Rare Cases": Microscope, "Interesting Cases": Star, "Research Cases": FlaskConical,
  "Medico-Legal": AlertTriangle, "AI Learning Cases": Brain,
};

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-green-100 text-green-700",
  intermediate: "bg-blue-100 text-blue-700",
  advanced: "bg-orange-100 text-orange-700",
  expert: "bg-red-100 text-red-700",
};

export default function TeachingFavorites() {
  const { toast } = useToast();
  const [_, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["teaching-favorites"],
    queryFn: async () => {
      return api.get<{ cases: TeachingCase[] }>("/teaching-cases/favorites");
    },
  });

  const unfavoriteMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.post<{ success: boolean }>(`/teaching-cases/${id}/favorite`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teaching-favorites"] });
      toast({ title: "Removed from favorites" });
    },
  });

  const cases: TeachingCase[] = data?.cases ?? [];
  const categories: string[] = [...new Set(cases.map((c) => c.category))];
  const filtered = selectedCategory ? cases.filter((c) => c.category === selectedCategory) : cases;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Favorites"
        subtitle="Your personal library of starred teaching cases"
      />

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => navigate("/teaching-cases")}>
          <ArrowLeft size={16} className="mr-2" /> Teaching Files
        </Button>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        <button
          className={`px-3 py-1 rounded-full text-xs font-medium border transition ${selectedCategory === null ? "bg-primary text-white" : "bg-muted text-muted-foreground border-card-border hover:bg-muted/80"}`}
          onClick={() => setSelectedCategory(null)}
        >
          All
        </button>
        {categories.map((cat: string) => (
          <button
            key={cat}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition ${selectedCategory === cat ? "bg-primary text-white" : "bg-muted text-muted-foreground border-card-border hover:bg-muted/80"}`}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Case grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((tc) => {
          const tags = parseTags(tc.tagsJson);
          const Icon = CATEGORY_ICONS[tc.category] ?? Brain;
          return (
            <div key={tc.id} className="bg-card border border-card-border rounded-xl p-4 hover:shadow-md transition cursor-pointer group" onClick={() => navigate(`/teaching-cases/${tc.id}`)}>
              <div className="flex items-start gap-3 mb-2">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm truncate">{tc.title}</h3>
                  {tc.diagnosis && <p className="text-xs text-muted-foreground truncate">{tc.diagnosis}</p>}
                </div>
                <button className="opacity-0 group-hover:opacity-100 transition text-red-500 hover:text-red-700" onClick={(e) => { e.stopPropagation(); unfavoriteMutation.mutate(tc.id); }}>
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                <Badge className={DIFFICULTY_COLORS[tc.difficulty] || ""} variant="outline">
                  {tc.difficulty}
                </Badge>
                {tc.modality && <Badge variant="outline">{tc.modality}</Badge>}
                {tc.bodyPart && <Badge variant="outline">{tc.bodyPart}</Badge>}
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                {tags.slice(0, 4).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px] font-normal">{tag}</Badge>
                ))}
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><Eye size={10} /> {tc.viewCount}</span>
                <span className="flex items-center gap-1"><Star size={10} /> {tc.createdByName}</span>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            <Heart size={48} className="mx-auto mb-3 opacity-50" />
            <p>No favorites yet. Star cases from Teaching Files to see them here.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function parseTags(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}
