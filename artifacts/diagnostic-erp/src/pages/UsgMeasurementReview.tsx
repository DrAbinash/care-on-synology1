import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { ImagePlus, Trash2, Activity, ChevronDown, ChevronUp } from "lucide-react";
import UsgMeasurementReviewPanel from "@/components/radiology/UsgMeasurementReviewPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UsgKeyImage {
  id: number;
  label: string;
  seriesNumber: string | null;
  imageNumber: string | null;
  wadoUrl: string | null;
  sortOrder: number;
  addedBy: string | null;
}

// ── Main component ────────────────────────────────────────────────────────────
//
// R2.0 — this page is now a THIN WRAPPER: it resolves the studyInstanceUID
// (route param or ?studyUID= query string), keeps the PageHeader chrome and
// the Key Images / Extraction History sections, and delegates all
// measurement rendering/review/approve/insert actions to the shared
// UsgMeasurementReviewPanel — the SAME component the canonical
// RadiologyReportingWorkspace embeds as a sidebar tab. No draftId is passed
// here (the standalone page has no report-draft context), so the panel's
// "pin as key image" action is unavailable on this route — key images here
// are still managed the original WADO-URL-based way below.

export default function UsgMeasurementReview() {
  const params = useParams<{ studyInstanceUID?: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  // studyInstanceUID can come from URL param or query string
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const studyUID = params.studyInstanceUID ?? search.get("studyUID") ?? "";

  const [showLogs, setShowLogs] = useState(false);
  const [showKeyImages, setShowKeyImages] = useState(true);
  const [newImageLabel, setNewImageLabel] = useState("");
  const [newImageWado, setNewImageWado] = useState("");

  // ── Queries kept on the page: Key Images + Extraction History ────────────

  const logsQuery = useQuery({
    queryKey: ["usg-logs", studyUID],
    queryFn: () => fetchApi(`/api/usg-extraction/study/${encodeURIComponent(studyUID)}/logs`),
    enabled: !!studyUID && showLogs,
  });

  const keyImagesQuery = useQuery<UsgKeyImage[]>({
    queryKey: ["usg-key-images", studyUID],
    queryFn: () => fetchApi(`/api/usg-extraction/study/${encodeURIComponent(studyUID)}/key-images`),
    enabled: !!studyUID,
    staleTime: 60_000,
  });

  const addKeyImageMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/api/usg-extraction/study/${encodeURIComponent(studyUID)}/key-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newImageLabel, wadoUrl: newImageWado }),
      }),
    onSuccess: () => {
      toast({ title: "Key image added" });
      setNewImageLabel(""); setNewImageWado("");
      void qc.invalidateQueries({ queryKey: ["usg-key-images", studyUID] });
    },
  });

  const deleteKeyImageMutation = useMutation({
    mutationFn: (id: number) => fetchApi(`/api/usg-extraction/key-images/${id}`, { method: "DELETE" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["usg-key-images", studyUID] }); },
  });

  // ── Render ────────────────────────────────────────────────────────────────

  if (!studyUID) {
    return (
      <div className="p-6">
        <PageHeader title="USG Measurement Review" subtitle="Auto-extracted ultrasound measurements" />
        <Card className="mt-6"><CardContent className="pt-6 text-center text-muted-foreground">
          No study selected. Open this page from the Radiology Worklist by clicking "Review USG Measurements" on a US modality study.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="USG Measurement Review"
        subtitle={`Study: ${studyUID.slice(0, 40)}${studyUID.length > 40 ? "…" : ""}`}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate("/radiology/worklist")}>
            ← Worklist
          </Button>
        }
      />

      {/* R2.0 — measurement review/approve/insert now lives entirely in the
          shared panel (same component the canonical reporting workspace
          embeds as a sidebar tab). */}
      <Card>
        <CardContent className="pt-4">
          <UsgMeasurementReviewPanel studyInstanceUID={studyUID} />
        </CardContent>
      </Card>

      {/* Key images */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowKeyImages(!showKeyImages)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <ImagePlus className="h-4 w-4" /> Key Images for Report
              {keyImagesQuery.data?.length ? (
                <Badge variant="secondary">{keyImagesQuery.data.length}</Badge>
              ) : null}
            </CardTitle>
            {showKeyImages ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </CardHeader>
        {showKeyImages && (
          <CardContent className="space-y-3">
            {keyImagesQuery.data?.map((img) => (
              <div key={img.id} className="flex items-center gap-3 p-2 rounded border">
                {img.wadoUrl && (
                  <a href={img.wadoUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    <img src={img.wadoUrl} alt="key frame" className="h-16 w-16 object-cover rounded border" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  </a>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{img.label || "(unlabelled)"}</p>
                  <p className="text-xs text-muted-foreground">Series {img.seriesNumber ?? "?"} / Image {img.imageNumber ?? "?"}</p>
                  {img.addedBy && <p className="text-xs text-muted-foreground">Added by {img.addedBy}</p>}
                </div>
                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteKeyImageMutation.mutate(img.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Add key image by WADO URL:</p>
              <Input placeholder="Label (e.g. BPD measurement)" value={newImageLabel} onChange={(e) => setNewImageLabel(e.target.value)} className="text-sm" />
              <Input placeholder="WADO-URI URL (optional)" value={newImageWado} onChange={(e) => setNewImageWado(e.target.value)} className="text-sm font-mono text-xs" />
              <Button size="sm" onClick={() => addKeyImageMutation.mutate()} disabled={!newImageLabel || addKeyImageMutation.isPending}>
                <ImagePlus className="h-4 w-4 mr-2" /> Add Image
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Extraction logs */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowLogs(!showLogs)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Extraction History
            </CardTitle>
            {showLogs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </CardHeader>
        {showLogs && (
          <CardContent>
            {logsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="space-y-2">
                {(logsQuery.data as Array<Record<string, unknown>> | undefined)?.map((log) => (
                  <div key={String(log.id)} className="text-xs p-2 rounded border space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={log.status === "completed" ? "text-green-700" : "text-red-700"}>
                        {String(log.status)}
                      </Badge>
                      <span className="text-muted-foreground">{String(log.extractionType)}</span>
                      <span className="text-muted-foreground ml-auto">{String(log.createdAt).slice(0, 16).replace("T", " ")}</span>
                    </div>
                    <div className="text-muted-foreground">
                      Frames: {String(log.framesProcessed)} processed / {String(log.framesFailed)} failed
                      {log.srFound ? " · SR found" : ""}
                      {log.aiNormalized ? " · AI normalized" : ""}
                      {log.durationMs ? ` · ${String(log.durationMs)}ms` : ""}
                    </div>
                    {log.errorMessage ? <div className="text-red-600">{String(log.errorMessage as string)}</div> : null}
                  </div>
                ))}
                {!(logsQuery.data as unknown[])?.length && <p className="text-sm text-muted-foreground">No extraction runs recorded yet.</p>}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
