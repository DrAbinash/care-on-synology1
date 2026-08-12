import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";

const STRUCTURED_TEMPLATES_BASE = "/api/radiology/structured-report-templates";

type QualityFinding = {
  ruleId: string;
  severity: string;
  category?: string;
  message: string;
  suggestedFix?: string | null;
};

type CanonicalEvaluation = {
  evaluationId: number;
  reportDraftId: number | null;
  reportId: number | null;
  source: string;
  modality: string | null;
  score: number;
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  evaluatedAt: string;
  findings: QualityFinding[];
};

type LegacyQualityGate = {
  id: number;
  reportId: number;
  findingsPresent: boolean;
  impressionPresent: boolean;
  signaturePresent: boolean;
  clinicalHistoryPresent: boolean;
  techniquePresent: boolean;
  comparisonPresent: boolean;
  allPassed: boolean;
  failedChecks: string | null;
  createdAt: string;
};

type ReportDraft = {
  id: number;
  modality: string | null;
  studyName: string | null;
  clinicalHistory: string | null;
  rawFindings: string | null;
  impression: string | null;
  recommendation: string | null;
};

function parseImpression(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    /* plain text */
  }
  return raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

function draftToQualityText(draft: ReportDraft) {
  return {
    findings: draft.rawFindings?.trim() ?? "",
    impression: parseImpression(draft.impression),
    recommendation: draft.recommendation?.trim() ?? undefined,
    clinicalHistory: draft.clinicalHistory?.trim() ?? undefined,
    modality: draft.modality ?? undefined,
    studyDescription: draft.studyName ?? undefined,
  };
}

export default function ReportQualityGates() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draftId, setDraftId] = useState("");
  const [legacyReportId, setLegacyReportId] = useState("");

  const draftIdNum = Number(draftId);
  const hasDraftId = Number.isInteger(draftIdNum) && draftIdNum > 0;

  const { data: evaluationsData, isLoading: evalLoading, refetch: refetchEvals, isFetching } = useQuery({
    queryKey: ["report-quality-evaluations", draftIdNum],
    enabled: hasDraftId,
    queryFn: () =>
      api.get<{ evaluations: CanonicalEvaluation[] }>(
        `/api/report-quality/drafts/${draftIdNum}/evaluations`,
      ),
  });

  const { data: recentData, isLoading: recentLoading } = useQuery({
    queryKey: ["report-quality-recent"],
    queryFn: () =>
      api.get<{ evaluations: CanonicalEvaluation[] }>("/api/report-quality/evaluations/recent?limit=30"),
  });

  const { data: legacyGates = [], isLoading: legacyLoading } = useQuery({
    queryKey: ["legacy-quality-gates", legacyReportId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (legacyReportId.trim()) params.set("reportId", legacyReportId.trim());
      return api.get<LegacyQualityGate[]>(`/api/ai-reporting/quality-gates?${params.toString()}`);
    },
  });

  const runCanonicalMutation = useMutation({
    mutationFn: async () => {
      const { draft } = await api.get<{ success: boolean; draft: ReportDraft }>(
        `/api/radiology/report-generator/drafts/${draftIdNum}`,
      );
      if (!draft) throw new Error("Draft not found");
      return api.post<CanonicalEvaluation & { evaluationId: number }>("/api/report-quality/evaluate", {
        reportDraftId: draft.id,
        modality: draft.modality,
        studyType: draft.studyName,
        source: "quality-gates-ui",
        text: draftToQualityText(draft),
      });
    },
    onSuccess: (res) => {
      toast({
        title: res.blockingCount > 0 ? "Blocking issues found" : "Quality check complete",
        description: `Score ${res.score} · ${res.blockingCount} blocker(s), ${res.warningCount} warning(s)`,
        variant: res.blockingCount > 0 ? "destructive" : "default",
      });
      void qc.invalidateQueries({ queryKey: ["report-quality-evaluations", draftIdNum] });
      void qc.invalidateQueries({ queryKey: ["report-quality-recent"] });
    },
    onError: (e: Error) => toast({ title: "Evaluation failed", description: e.message, variant: "destructive" }),
  });

  const evaluations = evaluationsData?.evaluations ?? [];
  const recent = recentData?.evaluations ?? [];
  const latest = evaluations[0];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Report Quality"
        subtitle="Canonical report quality engine — evaluate drafts before finalize. Legacy checklist gates are retained below for reference."
      />

      <Tabs defaultValue="canonical">
        <TabsList>
          <TabsTrigger value="canonical">Canonical engine</TabsTrigger>
          <TabsTrigger value="legacy">Legacy gates (archive)</TabsTrigger>
        </TabsList>

        <TabsContent value="canonical" className="space-y-4 mt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Report draft ID</Label>
              <Input
                className="w-40"
                value={draftId}
                onChange={(e) => setDraftId(e.target.value)}
                placeholder="e.g. 42"
              />
            </div>
            <Button
              disabled={!hasDraftId || runCanonicalMutation.isPending}
              onClick={() => runCanonicalMutation.mutate()}
            >
              Run quality evaluation
            </Button>
            <Button
              variant="outline"
              disabled={!hasDraftId || isFetching}
              onClick={() => void refetchEvals()}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              Refresh history
            </Button>
          </div>

          {latest && (
            <Card className="border-l-4 border-l-indigo-500">
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex flex-wrap items-center gap-2">
                  Latest evaluation
                  <Badge variant="outline">Score {latest.score}</Badge>
                  {latest.blockingCount > 0 ? (
                    <Badge variant="destructive">{latest.blockingCount} blocker(s)</Badge>
                  ) : (
                    <Badge className="bg-emerald-600">{latest.warningCount} warning(s)</Badge>
                  )}
                  <span className="text-xs text-muted-foreground font-normal">
                    {new Date(latest.evaluatedAt).toLocaleString()} · {latest.source}
                  </span>
                </CardTitle>
              </CardHeader>
              {latest.findings?.length > 0 && (
                <CardContent className="space-y-2 pt-0">
                  {latest.findings.map((f) => (
                    <div
                      key={`${f.ruleId}-${f.message}`}
                      className={`text-xs rounded border px-3 py-2 ${
                        f.severity === "blocker"
                          ? "border-red-200 bg-red-50 text-red-900"
                          : f.severity === "warning"
                            ? "border-amber-200 bg-amber-50 text-amber-900"
                            : "border-border bg-muted/30"
                      }`}
                    >
                      <span className="font-semibold">{f.ruleId}</span> — {f.message}
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          )}

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Evaluation history (draft {hasDraftId ? draftIdNum : "—"})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Blockers</TableHead>
                    <TableHead>Warnings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evalLoading && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Loading…</TableCell>
                    </TableRow>
                  )}
                  {!evalLoading && !hasDraftId && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                        Enter a draft ID to load history.
                      </TableCell>
                    </TableRow>
                  )}
                  {!evalLoading && hasDraftId && evaluations.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                        No evaluations yet — run a check above.
                      </TableCell>
                    </TableRow>
                  )}
                  {evaluations.map((ev) => (
                    <TableRow key={ev.evaluationId}>
                      <TableCell className="text-xs">{new Date(ev.evaluatedAt).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{ev.source}</TableCell>
                      <TableCell className="font-mono">{ev.score}</TableCell>
                      <TableCell>{ev.blockingCount > 0 ? <AlertTriangle className="h-4 w-4 text-red-500" /> : <Check className="h-4 w-4 text-emerald-600" />}</TableCell>
                      <TableCell>{ev.warningCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Recent evaluations (clinic-wide)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Draft</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Blockers</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentLoading && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">Loading…</TableCell>
                    </TableRow>
                  )}
                  {recent.map((ev) => (
                    <TableRow key={ev.evaluationId}>
                      <TableCell className="text-xs">{new Date(ev.evaluatedAt).toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-xs">{ev.reportDraftId ?? "—"}</TableCell>
                      <TableCell>{ev.score}</TableCell>
                      <TableCell>{ev.blockingCount}</TableCell>
                      <TableCell className="text-xs">{ev.source}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="legacy" className="space-y-4 mt-4">
          <p className="text-xs text-muted-foreground">
            Legacy Phase-20 checklist gates (findings/impression/signature booleans). Prefer the canonical engine tab for rule-based scoring.
          </p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-sm">Report ID filter</Label>
              <Input placeholder="Optional" value={legacyReportId} onChange={(e) => setLegacyReportId(e.target.value)} />
            </div>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report</TableHead>
                    <TableHead>Findings</TableHead>
                    <TableHead>Impression</TableHead>
                    <TableHead>Signature</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {legacyLoading && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Loading…</TableCell>
                    </TableRow>
                  )}
                  {legacyGates.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell>{g.reportId}</TableCell>
                      <TableCell>{g.findingsPresent ? <Check className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-red-500" />}</TableCell>
                      <TableCell>{g.impressionPresent ? <Check className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-red-500" />}</TableCell>
                      <TableCell>{g.signaturePresent ? <Check className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-red-500" />}</TableCell>
                      <TableCell>
                        {g.allPassed ? (
                          <Badge variant="outline" className="text-green-600">Passed</Badge>
                        ) : (
                          <Badge variant="destructive">Failed</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
