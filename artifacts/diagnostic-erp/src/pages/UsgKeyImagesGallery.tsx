import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fetchApi } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Image, ArrowLeft, Search, Trash2, Tag, Calendar, ScanSearch } from "lucide-react";

interface KeyImage {
  id: number;
  worklistId: number | null;
  studyInstanceUID: string | null;
  accessionNumber: string | null;
  patientId: number | null;
  seriesInstanceUID: string | null;
  sopInstanceUID: string | null;
  label: string;
  wadoUrl: string | null;
  thumbnailBase64: string | null;
  sortOrder: number;
  addedBy: string | null;
  createdAt: string;
}

export default function UsgKeyImagesGallery() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const { data: images = [], isLoading } = useQuery<KeyImage[]>({
    queryKey: ["usg-key-images-all"],
    queryFn: () => fetchApi("/api/usg-extraction/key-images/all"),
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetchApi(`/api/usg-extraction/key-images/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Key image removed" });
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ["usg-key-images-all"] });
      void qc.invalidateQueries({ queryKey: ["usg-stats"] });
    },
    onError: () => toast({ title: "Failed to remove", variant: "destructive" }),
  });

  const filtered = images.filter((img) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (img.label ?? "").toLowerCase().includes(q) ||
      (img.studyInstanceUID ?? "").toLowerCase().includes(q) ||
      (img.accessionNumber ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="USG Key Images"
        subtitle="Curated key frames selected by the sonologist for report inclusion"
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate("/usg")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
          </Button>
        }
      />

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search label / study / accession…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Badge variant="outline" className="text-xs">
          {filtered.length} {filtered.length === 1 ? "image" : "images"}
        </Badge>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <Image className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground font-medium">No key images found</p>
            <p className="text-xs text-muted-foreground mt-1">
              Key images can be pinned from the USG Measurement Review page for any study.
            </p>
            <Button
              variant="outline" size="sm" className="mt-4"
              onClick={() => navigate("/usg/measurements")}
            >
              <ScanSearch className="h-4 w-4 mr-2" /> Go to Measurements
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Masonry-style gallery grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map((img) => {
            const isSelected = selected === img.id;
            return (
              <div
                key={img.id}
                className={`
                  group relative rounded-xl border overflow-hidden cursor-pointer
                  transition-all duration-150
                  ${isSelected
                    ? "border-primary ring-2 ring-primary/30 shadow-md"
                    : "border-border hover:border-primary/40 hover:shadow-md hover:scale-[1.02]"}
                `}
                onClick={() => setSelected(isSelected ? null : img.id)}
              >
                {/* Image preview */}
                <div className="aspect-square bg-gradient-to-br from-violet-50 to-fuchsia-50 dark:from-violet-950/30 dark:to-fuchsia-950/30 flex items-center justify-center">
                  {img.thumbnailBase64 ? (
                    <img
                      src={`data:image/jpeg;base64,${img.thumbnailBase64}`}
                      alt={img.label || "Key image"}
                      className="w-full h-full object-cover"
                    />
                  ) : img.wadoUrl ? (
                    <img
                      src={img.wadoUrl}
                      alt={img.label || "Key image"}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <Image className="h-8 w-8 text-violet-400/60" />
                  )}
                </div>

                {/* Label bar */}
                <div className="p-2 bg-card">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {img.label || "Unlabeled"}
                  </p>
                  <div className="flex items-center gap-1 mt-0.5">
                    {img.accessionNumber && (
                      <span className="text-[10px] text-muted-foreground truncate flex items-center gap-0.5">
                        <ScanSearch className="h-2.5 w-2.5" />
                        {img.accessionNumber}
                      </span>
                    )}
                  </div>
                </div>

                {/* Hover overlay with actions */}
                {isSelected && (
                  <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2 p-2">
                    <div className="bg-white/90 dark:bg-black/80 rounded-lg p-2 text-center space-y-1 w-full">
                      {img.label && (
                        <p className="text-xs font-bold truncate">{img.label}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        Added {new Date(img.createdAt).toLocaleDateString()}
                        {img.addedBy ? ` by ${img.addedBy}` : ""}
                      </p>
                      {img.wadoUrl && (
                        <a
                          href={img.wadoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-[10px] text-primary font-semibold hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Open in PACS
                        </a>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMutation.mutate(img.id);
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Study grouping note */}
      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Click a thumbnail to see details and actions · Key images are linked to studies and appear in the report when the study is opened
        </p>
      )}
    </div>
  );
}
