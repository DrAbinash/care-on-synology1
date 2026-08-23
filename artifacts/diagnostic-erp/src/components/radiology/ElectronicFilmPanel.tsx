import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileImage, AlertTriangle, Send, ExternalLink } from "lucide-react";

type FilmSummary = {
  id: number;
  ingestStatus: string;
  hopeDeliveryStatus: string | null;
  version: number;
  isCurrent: boolean;
  matchMethod: string | null;
  accessToken: string | null;
};

export function ElectronicFilmPanel({ studyId }: { studyId: number }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["electronic-film", studyId],
    queryFn: () => api.get<{ current: FilmSummary | null; artifacts: FilmSummary[] }>(`/electronic-film/study/${studyId}`),
    enabled: studyId > 0,
  });

  const sendHope = useMutation({
    mutationFn: (id: number) => api.post(`/electronic-film/${id}/send-hope`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["electronic-film", studyId] }),
  });

  const current = data?.current;
  if (isLoading) return null;
  if (!current) return null;

  const statusIcon =
    current.ingestStatus === "MATCH_REQUIRED" ? "⚠" :
    current.ingestStatus === "STORED" || current.ingestStatus === "HOPE_SENT" ? "✓" :
    current.hopeDeliveryStatus === "FAILED" ? "!" : "?";

  const previewUrl = current.id ? `/api/electronic-film/${current.id}/artifact` : null;

  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs" data-testid="electronic-film-panel">
      <div className="flex flex-wrap items-center gap-2">
        <FileImage className="h-3.5 w-3.5" />
        <span className="font-semibold">ELECTRONIC FILM</span>
        <Badge variant="outline" className="text-[10px]">{statusIcon} {current.ingestStatus}</Badge>
        {current.hopeDeliveryStatus && (
          <Badge variant="secondary" className="text-[10px]">HOPE: {current.hopeDeliveryStatus}</Badge>
        )}
        {current.ingestStatus === "MATCH_REQUIRED" && (
          <Badge variant="destructive" className="gap-1 text-[10px]">
            <AlertTriangle className="h-3 w-3" /> MATCH REQUIRED
          </Badge>
        )}
        <span className="text-muted-foreground">v{current.version}</span>
        {previewUrl && (
          <a href={previewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            <ExternalLink className="h-3 w-3" /> Preview
          </a>
        )}
        {current.ingestStatus === "STORED" && current.hopeDeliveryStatus !== "SENT" && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px]"
            disabled={sendHope.isPending}
            onClick={() => sendHope.mutate(current.id)}
          >
            <Send className="mr-1 h-3 w-3" /> Send to HOPE
          </Button>
        )}
      </div>
    </div>
  );
}

export function filmWorklistIndicator(film?: { ingestStatus?: string; hopeDeliveryStatus?: string | null } | null): string | null {
  if (!film) return null;
  if (film.ingestStatus === "MATCH_REQUIRED") return "?";
  if (film.hopeDeliveryStatus === "FAILED") return "!";
  if (film.ingestStatus === "STORED" || film.ingestStatus === "HOPE_SENT") return "✓";
  return null;
}
