// Phase 10C: Research Database
// Server-side filtered, paginated, CSV-exportable research case database.
// Gated by the "researchDatabase" feature flag.

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { isFeatureEnabled } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  FlaskConical, ArrowLeft, ExternalLink, Calendar,
  Search, Download, Filter, ChevronLeft, ChevronRight,
  CheckCircle2, AlertCircle, Clock, Star, X,
} from "lucide-react";

interface ResearchCase {
  id: number;
  title: string;
  diagnosis: string | null;
  category: string;
  modality: string | null;
  bodyPart: string | null;
  difficulty: string | null;
  researchStatus: string | null;
  patientAge: string | null;
  patientGender: string | null;
  tagsJson: string | null;
  isAnonymized: boolean;
  publicationReference: string | null;
  conferenceName: string | null;
  createdByName: string | null;
  createdAt: string;
}

interface ResearchResponse {
  cases: ResearchCase[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

const STATUS_LABELS: Record<string, string> = {
  candidate: "Candidate",
  case_report: "Case Report",
  poster: "Poster",
  conference: "Conference",
  publication: "Publication",
  literature_review: "Lit Review",
  in_review: "In Review",
  submitted: "Submitted",
  accepted: "Accepted",
  published: "Published",
  rejected: "Rejected",
  deferred: "Deferred",
};

const STATUS_COLORS: Record<string, string> = {
  candidate: "bg-blue-100 text-blue-700",
  case_report: "bg-cyan-100 text-cyan-700",
  poster: "bg-indigo-100 text-indigo-700",
  conference: "bg-violet-100 text-violet-700",
  publication: "bg-emerald-100 text-emerald-700",
  literature_review: "bg-teal-100 text-teal-700",
  in_review: "bg-yellow-100 text-yellow-700",
  submitted: "bg-purple-100 text-purple-700",
  accepted: "bg-green-100 text-green-700",
  published: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  deferred: "bg-gray-100 text-gray-700",
};

const MODALITIES = ["", "MRI", "CT", "USG", "X-Ray", "Mammography", "PET-CT", "Nuclear Medicine", "Fluoroscopy"];
const DIFFICULTIES = ["", "beginner", "intermediate", "advanced", "expert"];
const GENDERS = ["", "M", "F", "Other"];
const PAGE_SIZES = [10, 20, 50];

interface Filters {
  q: string;
  modality: string;
  bodyPart: string;
  category: string;
  difficulty: string;
  researchStatus: string;
  sex: string;
  ageMin: string;
  ageMax: string;
  tag: string;
  interesting: boolean;
  rare: boolean;
  publicationCandidate: boolean;
  isAnonymized: string;
}

const DEFAULT_FILTERS: Filters = {
  q: "", modality: "", bodyPart: "", category: "", difficulty: "",
  researchStatus: "", sex: "", ageMin: "", ageMax: "", tag: "",
  interesting: false, rare: false, publicationCandidate: false, isAnonymized: "",
};

function buildParams(filters: Filters, page: number, pageSize: number): string {
  const p = new URLSearchParams();
  p.set("page", String(page));
  p.set("pageSize", String(pageSize));
  if (filters.q) p.set("q", filters.q);
  if (filters.modality) p.set("modality", filters.modality);
  if (filters.bodyPart) p.set("bodyPart", filters.bodyPart);
  if (filters.category) p.set("category", filters.category);
  if (filters.difficulty) p.set("difficulty", filters.difficulty);
  if (filters.researchStatus) p.set("researchStatus", filters.researchStatus);
  if (filters.sex) p.set("sex", filters.sex);
  if (filters.ageMin) p.set("ageMin", filters.ageMin);
  if (filters.ageMax) p.set("ageMax", filters.ageMax);
  if (filters.tag) p.set("tag", filters.tag);
  if (filters.interesting) p.set("interesting", "true");
  if (filters.rare) p.set("rare", "true");
  if (filters.publicationCandidate) p.set("publicationCandidate", "true");
  if (filters.isAnonymized) p.set("isAnonymized", filters.isAnonymized);
  return p.toString();
}

function parseTags(tagsJson: string | null): string[] {
  try { return JSON.parse(tagsJson ?? "[]") as string[]; } catch { return []; }
}

export default function TeachingResearchMode() {
  const { toast } = useToast();
  const [_, navigate] = useLocation();
  const researchEnabled = isFeatureEnabled("researchDatabase");

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [showFilters, setShowFilters] = useState(false);
  const [exporting, setExporting] = useState(false);

  const queryKey = ["research-db", applied, page, pageSize];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      api.get<ResearchResponse>(`/api/teaching-cases/research?${buildParams(applied, page, pageSize)}`),
    enabled: researchEnabled,
  });

  const cases = data?.cases ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize, total: 0, totalPages: 1 };

  const applyFilters = useCallback(() => {
    setApplied({ ...filters });
    setPage(1);
  }, [filters]);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setApplied(DEFAULT_FILTERS);
    setPage(1);
  }, []);

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const params = buildParams(applied, 1, 9999);
      const resp = await fetch(`/api/teaching-cases/research?${params}&exportFormat=csv`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("staffToken") || ""}` },
      });
      if (!resp.ok) throw new Error("Export failed");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `research-cases-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "CSV exported" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  if (!researchEnabled) {
    return (
      <div className="space-y-6">
        <PageHeader title="Research Database" subtitle="Enable the Research Database feature flag in Settings → Radiology → Phase 10C to access this module." />
        <div className="text-center py-20 text-muted-foreground">
          <FlaskConical size={48} className="mx-auto mb-3 opacity-50" />
          <p className="font-medium">Research Database is off</p>
          <p className="text-sm mt-1">Go to Settings → Radiology to enable it.</p>
        </div>
      </div>
    );
  }

  const activeFilterCount = [
    applied.q, applied.modality, applied.bodyPart, applied.category,
    applied.difficulty, applied.researchStatus, applied.sex, applied.ageMin,
    applied.ageMax, applied.tag, applied.isAnonymized,
  ].filter(Boolean).length + (applied.interesting ? 1 : 0) + (applied.rare ? 1 : 0) + (applied.publicationCandidate ? 1 : 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Research Database"
        subtitle="Search, filter, and export anonymised research cases for publications, posters, and conference submissions."
      />

      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => navigate("/teaching-cases")}>
          <ArrowLeft size={14} className="mr-1.5" /> Teaching Files
        </Button>
        <div className="flex-1 flex items-center gap-2 bg-card border border-card-border rounded-lg px-3 py-2 max-w-md">
          <Search size={14} className="text-muted-foreground" />
          <Input
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            placeholder="Search title, diagnosis, findings..."
            className="border-0 focus-visible:ring-0 bg-transparent p-0 h-auto text-sm"
          />
          {filters.q && <button onClick={() => setFilters((f) => ({ ...f, q: "" }))}><X size={12} className="text-muted-foreground" /></button>}
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowFilters((v) => !v)} className="gap-1.5">
          <Filter size={14} />
          Filters
          {activeFilterCount > 0 && <Badge className="ml-1 bg-primary text-white text-[10px] px-1.5">{activeFilterCount}</Badge>}
        </Button>
        <Button size="sm" onClick={applyFilters}>Search</Button>
        {activeFilterCount > 0 && <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">Clear all</Button>}
        <div className="ml-auto flex items-center gap-2">
          <select
            className="text-xs border border-card-border rounded px-2 py-1.5 bg-card"
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={exporting} className="gap-1.5">
            <Download size={14} />
            {exporting ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
      </div>

      {/* Advanced filter panel */}
      {showFilters && (
        <div className="bg-card border border-card-border rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs">Modality</Label>
            <select className="w-full mt-1 text-xs border border-card-border rounded px-2 py-1.5 bg-background" value={filters.modality} onChange={(e) => setFilters((f) => ({ ...f, modality: e.target.value }))}>
              {MODALITIES.map((m) => <option key={m} value={m}>{m || "Any"}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Body Part</Label>
            <Input className="mt-1 text-xs h-8" value={filters.bodyPart} onChange={(e) => setFilters((f) => ({ ...f, bodyPart: e.target.value }))} placeholder="Brain, Abdomen..." />
          </div>
          <div>
            <Label className="text-xs">Difficulty</Label>
            <select className="w-full mt-1 text-xs border border-card-border rounded px-2 py-1.5 bg-background" value={filters.difficulty} onChange={(e) => setFilters((f) => ({ ...f, difficulty: e.target.value }))}>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d || "Any"}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Research Status</Label>
            <select className="w-full mt-1 text-xs border border-card-border rounded px-2 py-1.5 bg-background" value={filters.researchStatus} onChange={(e) => setFilters((f) => ({ ...f, researchStatus: e.target.value }))}>
              <option value="">Any</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Patient Sex</Label>
            <select className="w-full mt-1 text-xs border border-card-border rounded px-2 py-1.5 bg-background" value={filters.sex} onChange={(e) => setFilters((f) => ({ ...f, sex: e.target.value }))}>
              {GENDERS.map((g) => <option key={g} value={g}>{g || "Any"}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Age Range (years)</Label>
            <div className="flex gap-1 mt-1">
              <Input className="text-xs h-8" type="number" placeholder="Min" value={filters.ageMin} onChange={(e) => setFilters((f) => ({ ...f, ageMin: e.target.value }))} />
              <Input className="text-xs h-8" type="number" placeholder="Max" value={filters.ageMax} onChange={(e) => setFilters((f) => ({ ...f, ageMax: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Tag</Label>
            <Input className="mt-1 text-xs h-8" value={filters.tag} onChange={(e) => setFilters((f) => ({ ...f, tag: e.target.value }))} placeholder="e.g. rare, interesting..." />
          </div>
          <div>
            <Label className="text-xs">Anonymised</Label>
            <select className="w-full mt-1 text-xs border border-card-border rounded px-2 py-1.5 bg-background" value={filters.isAnonymized} onChange={(e) => setFilters((f) => ({ ...f, isAnonymized: e.target.value }))}>
              <option value="">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div className="col-span-2 md:col-span-4 flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={filters.interesting} onChange={(e) => setFilters((f) => ({ ...f, interesting: e.target.checked }))} />
              <Star size={12} className="text-yellow-500" /> Interesting cases only
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={filters.rare} onChange={(e) => setFilters((f) => ({ ...f, rare: e.target.checked }))} />
              <AlertCircle size={12} className="text-orange-500" /> Rare cases only
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={filters.publicationCandidate} onChange={(e) => setFilters((f) => ({ ...f, publicationCandidate: e.target.checked }))} />
              <CheckCircle2 size={12} className="text-emerald-500" /> Publication candidates
            </label>
          </div>
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">
          <Clock size={32} className="mx-auto mb-3 animate-spin opacity-40" />
          <p>Loading research database...</p>
        </div>
      ) : cases.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground bg-card border border-card-border rounded-xl">
          <FlaskConical size={48} className="mx-auto mb-3 opacity-40" />
          <p className="font-medium">No research cases found</p>
          <p className="text-sm mt-1">Try adjusting your filters or mark teaching cases as research candidates.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {cases.map((c) => {
            const tags = parseTags(c.tagsJson);
            return (
              <div
                key={c.id}
                className="bg-card border border-card-border rounded-xl p-4 hover:border-primary/40 cursor-pointer transition"
                onClick={() => navigate(`/teaching-cases/${c.id}`)}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{c.title}</span>
                      {c.isAnonymized && <Badge className="bg-green-100 text-green-700 text-[10px]">Anonymised</Badge>}
                      {c.researchStatus && (
                        <Badge className={`text-[10px] ${STATUS_COLORS[c.researchStatus] ?? "bg-gray-100 text-gray-700"}`}>
                          {STATUS_LABELS[c.researchStatus] ?? c.researchStatus}
                        </Badge>
                      )}
                    </div>
                    {c.diagnosis && <p className="text-xs text-muted-foreground mt-0.5">{c.diagnosis}</p>}
                    <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-muted-foreground">
                      {c.modality && <span className="bg-muted px-1.5 py-0.5 rounded">{c.modality}</span>}
                      {c.bodyPart && <span className="bg-muted px-1.5 py-0.5 rounded">{c.bodyPart}</span>}
                      {c.category && <span className="bg-muted px-1.5 py-0.5 rounded">{c.category}</span>}
                      {c.difficulty && <span className="bg-muted px-1.5 py-0.5 rounded capitalize">{c.difficulty}</span>}
                      {c.patientAge && <span>Age: {c.patientAge}</span>}
                      {c.patientGender && <span>Sex: {c.patientGender}</span>}
                    </div>
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {tags.slice(0, 5).map((t, i) => (
                          <span key={i} className="bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded-full">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <div className="text-[10px] text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</div>
                    {c.createdByName && <div className="text-[10px] text-muted-foreground">{c.createdByName}</div>}
                    <div className="flex items-center gap-1 justify-end mt-1">
                      {c.publicationReference && (
                        <span title="Has publication reference"><ExternalLink size={12} className="text-primary" /></span>
                      )}
                      {c.conferenceName && (
                        <span title={c.conferenceName}><Calendar size={12} className="text-primary" /></span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            {pagination.total} case{pagination.total !== 1 ? "s" : ""} · Page {pagination.page} of {pagination.totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft size={14} />
            </Button>
            {Array.from({ length: Math.min(pagination.totalPages, 7) }, (_, i) => {
              const pn = pagination.totalPages <= 7 ? i + 1 : Math.max(1, page - 3) + i;
              if (pn > pagination.totalPages) return null;
              return (
                <Button key={pn} variant={pn === page ? "default" : "outline"} size="sm" className="w-8 h-8 p-0 text-xs" onClick={() => setPage(pn)}>
                  {pn}
                </Button>
              );
            })}
            <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
