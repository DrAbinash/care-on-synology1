import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2, CheckCircle2, XCircle, BrainCircuit, Search, RotateCcw,
  Eye, AlertTriangle, FlaskConical,
} from "lucide-react";

type Extraction = {
  id: number;
  studyId: number;
  extractionType: string;
  extractedData: string | Record<string, unknown>;
  confidence: string;
  isAiSuggested: boolean;
  reviewStatus: "pending" | "accepted" | "rejected" | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

const EXTRACTION_TYPES = [
  { key: "dicom_metadata", label: "DICOM Metadata" },
  { key: "key_images", label: "Key Images" },
  { key: "measurements_from_overlay", label: "OCR Measurements" },
  { key: "report_template_suggestion", label: "Template Suggestion" },
  { key: "findings_suggestion", label: "Findings Suggestion" },
  { key: "prior_comparison", label: "Prior Comparison" },
  { key: "quality_check", label: "Quality Check" },
];

function parseData(ex: Extraction): Record<string, unknown> {
  if (typeof ex.extractedData === "string") {
    try { return JSON.parse(ex.extractedData); } catch { return {}; }
  }
  return (ex.extractedData as Record<string, unknown>) ?? {};
}

export default function AiExtractionReview() {
  const qc = useQueryClient();
  const [studyId, setStudyId] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [detailExtraction, setDetailExtraction] = useState<Extraction | null>(null);

  const { data: ocrRows, isLoading: ocrLoading } = useQuery({
    queryKey: ["ocr-review", studyId],
    queryFn: () => studyId ? api.get<Extraction[]>(`/api/dicom-workflow/ocr-review/${studyId}`) : [],
    enabled: !!studyId,
  });

  const acceptMut = useMutation({
    mutationFn: (id: number) => api.post<Extraction>(`/api/dicom-workflow/ocr-review/${id}/accept`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ocr-review"] }),
  });

  const rejectMut = useMutation({
    mutationFn: (id: number) => api.post<Extraction>(`/api/dicom-workflow/ocr-review/${id}/reject`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ocr-review"] }),
  });

  const aiGenMut = useMutation({
    mutationFn: ({ id, t }: { id: number; t: string }) => api.post<Extraction>(`/api/dicom-workflow/ai-extract/${id}`, { extractionType: t }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ocr-review"] }),
  });

  const filtered = (ocrRows ?? []).filter((r) => !typeFilter || r.extractionType === typeFilter);

  return (
    <div>
      <PageHeader
        title="AI Extraction Review"
        subtitle="Review AI/OCR suggestions before accepting into reports"
      />

      <div className="px-4 sm:px-6 py-4 flex flex-wrap gap-3 items-center border-b">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Study ID for OCR review" value={studyId} onChange={(e) => setStudyId(e.target.value)} />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All types</SelectItem>
            {EXTRACTION_TYPES.map((t) => (
              <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {studyId && (
          <div className="flex gap-2">
            {EXTRACTION_TYPES.map((t) => (
              <Button key={t.key} size="sm" variant="outline" onClick={() => aiGenMut.mutate({ id: Number(studyId), t: t.key })} disabled={aiGenMut.isPending}>
                <FlaskConical className="h-3.5 w-3.5 mr-1" /> {t.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 sm:px-6 py-4">
        {!studyId ? (
          <div className="text-center py-12 text-muted-foreground">
            Enter a study ID above to load AI/OCR extractions for review.
          </div>
        ) : ocrLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="animate-spin h-5 w-5" /> Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No extractions found for this study. Use the buttons above to run AI pipelines.
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Data Preview</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reviewer</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((ex) => {
                  const data = parseData(ex);
                  const preview = JSON.stringify(data).slice(0, 80) + "...";
                  return (
                    <TableRow key={ex.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                          {EXTRACTION_TYPES.find((t) => t.key === ex.extractionType)?.label || ex.extractionType}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate text-xs font-mono">{preview}</TableCell>
                      <TableCell>{ex.confidence}</TableCell>
                      <TableCell>
                        {ex.reviewStatus === "accepted" ? (
                          <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Accepted</Badge>
                        ) : ex.reviewStatus === "rejected" ? (
                          <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Rejected</Badge>
                        ) : (
                          <Badge variant="outline">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{ex.reviewedByName || "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setDetailExtraction(ex)}><Eye className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => acceptMut.mutate(ex.id)} disabled={acceptMut.isPending || ex.reviewStatus === "accepted"}>
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => rejectMut.mutate(ex.id)} disabled={rejectMut.isPending || ex.reviewStatus === "rejected"}>
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={!!detailExtraction} onOpenChange={(o) => !o && setDetailExtraction(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Extraction Detail</DialogTitle></DialogHeader>
          {detailExtraction && (
            <div className="space-y-3">
              <div className="text-sm"><span className="text-muted-foreground">Type:</span> {detailExtraction.extractionType}</div>
              <div className="text-sm"><span className="text-muted-foreground">Confidence:</span> {detailExtraction.confidence}</div>
              <div className="text-sm"><span className="text-muted-foreground">Status:</span> {detailExtraction.reviewStatus || "pending"}</div>
              <pre className="bg-muted rounded-md p-3 text-xs overflow-auto max-h-[300px]">{JSON.stringify(parseData(detailExtraction), null, 2)}</pre>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailExtraction(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
