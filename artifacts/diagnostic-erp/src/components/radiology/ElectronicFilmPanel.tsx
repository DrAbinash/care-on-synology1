import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileImage, AlertTriangle, Send, ExternalLink, Link2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

type FilmSummary = {
  id: number;
  ingestStatus: string;
  hopeDeliveryStatus: string | null;
  version: number;
  isCurrent: boolean;
  matchMethod: string | null;
  accessToken: string | null;
  sourceAe?: string | null;
  accessionNumber?: string | null;
  studyInstanceUid?: string | null;
  imageCount?: number | null;
  pageCount?: number | null;
  filePath?: string | null;
};

type Candidate = {
  studyId: number;
  accessionNumber: string;
  studyInstanceUid: string | null;
  modality: string;
  studyDescription: string | null;
  studyDate: string | null;
};

export function ElectronicFilmPanel({ studyId }: { studyId: number }) {
  const qc = useQueryClient();
  const [matchOpen, setMatchOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["electronic-film", studyId],
    queryFn: () => api.get<{ current: FilmSummary | null; artifacts: FilmSummary[] }>(`/electronic-film/study/${studyId}`),
    enabled: studyId > 0,
  });

  const unmatched = useQuery({
    queryKey: ["electronic-film-match-required"],
    queryFn: () => api.get<{ artifacts: FilmSummary[] }>("/electronic-film/match-required"),
  });

  const filmDetail = useQuery({
    queryKey: ["electronic-film-detail", matchOpen],
    queryFn: () => {
      const id = unmatched.data?.artifacts[0]?.id;
      if (!id) return null;
      return api.get<{ artifact: FilmSummary; candidates: Candidate[] }>(`/electronic-film/${id}`);
    },
    enabled: matchOpen && !!unmatched.data?.artifacts?.length,
  });

  const sendHope = useMutation({
    mutationFn: (id: number) => api.post(`/electronic-film/${id}/send-hope`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["electronic-film", studyId] }),
  });

  const matchFilm = useMutation({
    mutationFn: ({ filmId, targetStudyId }: { filmId: number; targetStudyId: number }) =>
      api.post(`/electronic-film/${filmId}/match`, { studyId: targetStudyId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["electronic-film", studyId] });
      qc.invalidateQueries({ queryKey: ["electronic-film-match-required"] });
      setMatchOpen(false);
    },
  });

  const current = data?.current;
  const pendingMatch = unmatched.data?.artifacts?.find((a) => a.ingestStatus === "MATCH_REQUIRED");

  if (isLoading) return null;
  if (!current && !pendingMatch) return null;

  const active = current ?? pendingMatch;
  if (!active) return null;

  const statusIcon =
    active.ingestStatus === "MATCH_REQUIRED" ? "⚠" :
    active.ingestStatus === "STORED" || active.ingestStatus === "HOPE_SENT" ? "✓" :
    active.hopeDeliveryStatus === "FAILED" ? "!" : "?";

  const previewUrl = active.id ? `/api/electronic-film/${active.id}/artifact` : null;

  return (
    <>
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs" data-testid="electronic-film-panel">
        <div className="flex flex-wrap items-center gap-2">
          <FileImage className="h-3.5 w-3.5" />
          <span className="font-semibold">ELECTRONIC FILM</span>
          <Badge variant="outline" className="text-[10px]">{statusIcon} {active.ingestStatus}</Badge>
          {active.hopeDeliveryStatus && (
            <Badge variant="secondary" className="text-[10px]">HOPE: {active.hopeDeliveryStatus}</Badge>
          )}
          {active.ingestStatus === "MATCH_REQUIRED" && (
            <>
              <Badge variant="destructive" className="gap-1 text-[10px]">
                <AlertTriangle className="h-3 w-3" /> MATCH REQUIRED
              </Badge>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setMatchOpen(true)}>
                <Link2 className="mr-1 h-3 w-3" /> Review
              </Button>
            </>
          )}
          <span className="text-muted-foreground">v{active.version}</span>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              <ExternalLink className="h-3 w-3" /> Preview / PDF
            </a>
          )}
          {active.ingestStatus === "STORED" && active.hopeDeliveryStatus !== "SENT" && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              disabled={sendHope.isPending}
              onClick={() => sendHope.mutate(active.id)}
            >
              <Send className="mr-1 h-3 w-3" /> Send to HOPE
            </Button>
          )}
        </div>
      </div>

      <Dialog open={matchOpen} onOpenChange={setMatchOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>ELECTRONIC FILM — MATCH REQUIRED</DialogTitle>
            <DialogDescription>
              Link this film to the correct CARE study. No automatic attachment when ambiguous.
            </DialogDescription>
          </DialogHeader>
          {filmDetail.data?.artifact && (
            <div className="space-y-3 text-xs">
              <div className="rounded border p-2">
                <p>Source AE: {filmDetail.data.artifact.sourceAe ?? "—"}</p>
                <p>Accession: {filmDetail.data.artifact.accessionNumber ?? "absent"}</p>
                <p>Study UID: {filmDetail.data.artifact.studyInstanceUid ?? "absent"}</p>
                <p>Images: {filmDetail.data.artifact.imageCount ?? "—"} · Pages: {filmDetail.data.artifact.pageCount ?? "—"}</p>
              </div>
              <div className="space-y-2">
                <p className="font-semibold">Candidate studies</p>
                {(filmDetail.data.candidates ?? []).map((c) => (
                  <div key={c.studyId} className="flex items-center justify-between rounded border p-2">
                    <div>
                      <p className="font-medium">{c.studyDescription ?? "Study"} · {c.modality}</p>
                      <p className="text-muted-foreground">Accession {c.accessionNumber} · {c.studyDate ?? "—"}</p>
                    </div>
                    <Button
                      size="sm"
                      disabled={matchFilm.isPending}
                      onClick={() => matchFilm.mutate({ filmId: filmDetail.data!.artifact.id, targetStudyId: c.studyId })}
                    >
                      Link Film
                    </Button>
                  </div>
                ))}
                {studyId > 0 && (
                  <Button
                    className="w-full"
                    variant="secondary"
                    disabled={matchFilm.isPending}
                    onClick={() => matchFilm.mutate({ filmId: filmDetail.data!.artifact.id, targetStudyId: studyId })}
                  >
                    Link to this study (#{studyId})
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function filmWorklistIndicator(film?: { ingestStatus?: string; hopeDeliveryStatus?: string | null } | null): string | null {
  if (!film) return null;
  if (film.ingestStatus === "MATCH_REQUIRED") return "?";
  if (film.hopeDeliveryStatus === "FAILED") return "!";
  if (film.ingestStatus === "STORED" || film.ingestStatus === "HOPE_SENT") return "✓";
  return null;
}
