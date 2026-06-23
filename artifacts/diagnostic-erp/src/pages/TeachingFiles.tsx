// Phase 8: Teaching Files & Interesting Cases Registry
// Main dashboard for browsing, searching, and managing teaching cases.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  Search, BookOpen, Star, Heart, BarChart3, Filter,
  GraduationCap, Microscope, Stethoscope, FlaskConical,
  AlertTriangle, Brain, HeartPulse, Baby, Bone, Eye, Activity,
  Layers, X, Tag,
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
}

const CATEGORIES = [
  "MRI Brain", "MRI Spine", "MRI MSK", "MRI Abdomen",
  "CT Brain", "CT Chest", "CT Abdomen",
  "USG General", "USG Obstetric", "Breast Imaging",
  "Head & Neck", "Emergency", "Trauma", "Pediatric",
  "Rare Cases", "Interesting Cases", "Research Cases", "Medico-Legal",
  "AI Learning Cases",
];

const DIFFICULTIES = ["beginner", "intermediate", "advanced", "expert"];

const CATEGORY_ICONS: Record<string, typeof Brain> = {
  "MRI Brain": Brain,
  "MRI Spine": Bone,
  "CT Brain": Brain,
  "CT Chest": HeartPulse,
  "USG General": Eye,
  "USG Obstetric": Baby,
  "Breast Imaging": Heart,
  "Head & Neck": Eye,
  "Emergency": AlertTriangle,
  "Trauma": Bone,
  "Pediatric": Baby,
  "Rare Cases": Microscope,
  "Interesting Cases": Star,
  "Research Cases": FlaskConical,
  "Medico-Legal": AlertTriangle,
  "AI Learning Cases": Brain,
};

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-green-100 text-green-700",
  intermediate: "bg-blue-100 text-blue-700",
  advanced: "bg-orange-100 text-orange-700",
  expert: "bg-red-100 text-red-700",
};

export default function TeachingFiles() {
  const { toast } = useToast();
  const [_, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "favorites" | "mine" | "research">("all");

  const { data, isLoading } = useQuery({
    queryKey: ["teaching-cases", search, selectedCategory, selectedDifficulty, activeTab],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (selectedCategory) params.set("category", selectedCategory);
      if (selectedDifficulty) params.set("difficulty", selectedDifficulty);
      params.set("limit", "50");
      return api.get<{ cases: TeachingCase[]; total: number; favorites: number[] }>(
        `/teaching-cases?${params.toString()}`
      );
    },
  });

  const cases = data?.cases ?? [];
  const favorites = data?.favorites ?? [];
  const total = data?.total ?? 0;

  const filteredCases = cases.filter((c) => {
    if (activeTab === "favorites") return favorites.includes(c.id);
    if (activeTab === "research") return c.isResearchCandidate;
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teaching Files & Interesting Cases"
        subtitle="Anonymized rare cases, interesting findings, research cases, and AI learning cases. All cases are editable and anonymized."
      />

      {/* Tabs */}
      <div className="flex gap-2">
        {[
          { id: "all", label: "All Cases", icon: BookOpen },
          { id: "favorites", label: "My Favorites", icon: Heart },
          { id: "mine", label: "My Cases", icon: Star },
          { id: "research", label: "Research", icon: FlaskConical },
        ].map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? "default" : "outline"}
            size="sm"
            className="text-xs"
            onClick={() => setActiveTab(tab.id as any)}
          >
            <tab.icon className="h-3 w-3 mr-1" />
            {tab.label}
          </Button>
        ))}
        <Button variant="outline" size="sm" className="text-xs" onClick={() => navigate("/teaching-collections")}>
          <Layers className="h-3 w-3 mr-1" /> Collections
        </Button>
        <Button variant="outline" size="sm" className="text-xs" onClick={() => navigate("/teaching-favorites")}>
          <Heart className="h-3 w-3 mr-1" /> Favorites
        </Button>
        <Button variant="outline" size="sm" className="text-xs" onClick={() => navigate("/teaching-ai")}>
          <Brain className="h-3 w-3 mr-1" /> AI
        </Button>
        <Button variant="outline" size="sm" className="text-xs ml-auto" onClick={() => navigate("/teaching-analytics")}>
          <BarChart3 className="h-3 w-3 mr-1" /> Analytics
        </Button>
      </div>

      {/* Search & Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by diagnosis, finding, or keyword..."
            className="pl-9 text-sm"
          />
        </div>
        <select
          value={selectedCategory ?? ""}
          onChange={(e) => setSelectedCategory(e.target.value || null)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={selectedDifficulty ?? ""}
          onChange={(e) => setSelectedDifficulty(e.target.value || null)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All Difficulties</option>
          {DIFFICULTIES.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
        </select>
        {(selectedCategory || selectedDifficulty) && (
          <Button variant="ghost" size="sm" onClick={() => { setSelectedCategory(null); setSelectedDifficulty(null); }}>
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Results count */}
      <div className="text-sm text-muted-foreground">
        {total} total cases {filteredCases.length !== total && `(${filteredCases.length} shown)`}
      </div>

      {/* Case Grid */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : filteredCases.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <GraduationCap className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No teaching cases found.</p>
          <p className="text-sm">Create a case from the report editor or click &quot;New Case&quot; below.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCases.map((c) => {
            const Icon = CATEGORY_ICONS[c.category] ?? Microscope;
            const tags = JSON.parse(c.tagsJson ?? "[]") as string[];
            return (
              <div
                key={c.id}
                className="border rounded-lg bg-card p-4 space-y-3 cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => navigate(`/teaching-cases/${c.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="text-sm font-medium line-clamp-1">{c.title}</div>
                      <div className="text-[11px] text-muted-foreground">{c.category}</div>
                    </div>
                  </div>
                  <Badge className={DIFFICULTY_COLORS[c.difficulty] ?? "bg-muted"}>
                    {c.difficulty}
                  </Badge>
                </div>

                {c.diagnosis && (
                  <div className="text-sm text-muted-foreground line-clamp-1">{c.diagnosis}</div>
                )}

                <div className="flex flex-wrap gap-1">
                  {c.modality && <Badge variant="outline" className="text-[10px]">{c.modality}</Badge>}
                  {c.bodyPart && <Badge variant="outline" className="text-[10px]">{c.bodyPart}</Badge>}
                  {c.classification && <Badge variant="outline" className="text-[10px]">{c.classification}: {c.classificationValue}</Badge>}
                  {tags.slice(0, 3).map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                  ))}
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" /> {c.viewCount}
                    </span>
                    {favorites.includes(c.id) && (
                      <span className="text-red-500 flex items-center gap-1">
                        <Heart className="h-3 w-3 fill-current" /> Saved
                      </span>
                    )}
                  </div>
                  <span>{c.createdByName}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* AI Disclaimer */}
      <div className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded p-2 flex items-center gap-2">
        <AlertTriangle className="h-3 w-3" />
        All teaching cases are anonymized. Patient identifiers are removed before storage. All AI-generated content is educational only and requires radiologist review.
      </div>
    </div>
  );
}
