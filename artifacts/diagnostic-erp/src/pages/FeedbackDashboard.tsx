import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Send, ShieldAlert, Smile, Meh, Frown } from "lucide-react";

type Summary = { nps: number; promoters: number; passives: number; detractors: number; total: number };
type Response = { id: number; npsScore: number; stars: number | null; comment: string | null; category: string | null; submittedAt: string; reportId: number | null; patientName: string | null; testName: string | null };

const CAT: Record<string, { cls: string; icon: typeof Smile }> = {
  promoter: { cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300", icon: Smile },
  passive: { cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", icon: Meh },
  detractor: { cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", icon: Frown },
};

export default function FeedbackDashboard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const summaryQ = useQuery({ queryKey: ["feedback-summary"], queryFn: () => api.get<Summary>("/api/feedback/summary"), retry: false });
  const responsesQ = useQuery({ queryKey: ["feedback-responses"], queryFn: () => api.get<Response[]>("/api/feedback/responses") });

  const runMut = useMutation({
    mutationFn: () => api.post<{ created: number; sent: number }>("/api/feedback/run", {}),
    onSuccess: (r) => { toast({ title: "Invites processed", description: `Created ${r.created}, sent ${r.sent}` }); qc.invalidateQueries({ queryKey: ["feedback-summary"] }); qc.invalidateQueries({ queryKey: ["feedback-responses"] }); },
    onError: (e) => toast({ title: "Run failed", description: (e as Error).message, variant: "destructive" }),
  });

  if (summaryQ.error) {
    const msg = (summaryQ.error as Error).message || "";
    const shadow = msg.includes("disabled") || msg.includes("503");
    return (
      <div className="space-y-4">
        <PageHeader title="Patient Feedback / NPS" subtitle="Post-report satisfaction" />
        <Card className="min-h-[280px] flex items-center justify-center">
          <div className="text-center text-muted-foreground max-w-sm px-6">
            <ShieldAlert className="h-9 w-9 mx-auto mb-2 opacity-60" />
            <p className="text-sm font-medium mb-1">{shadow ? "Feedback / NPS is in Shadow Mode" : "Could not load"}</p>
            <p className="text-xs">{shadow ? "Enable the ff_feedback_nps feature flag to collect patient feedback." : msg}</p>
          </div>
        </Card>
      </div>
    );
  }

  const s = summaryQ.data;
  const npsColor = !s ? "" : s.nps >= 50 ? "text-green-600" : s.nps >= 0 ? "text-amber-600" : "text-red-600";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <PageHeader title="Patient Feedback / NPS" subtitle="Post-report satisfaction from tokenized WhatsApp links" />
        <Button onClick={() => runMut.mutate()} disabled={runMut.isPending}><Send className="h-4 w-4 mr-1.5" /> Send invites now</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="py-5 text-center"><div className={`text-3xl font-bold ${npsColor}`}>{s?.nps ?? 0}</div><div className="text-xs text-muted-foreground">NPS</div></CardContent></Card>
        <Card><CardContent className="py-5 text-center"><div className="text-2xl font-bold text-green-600">{s?.promoters ?? 0}</div><div className="text-xs text-muted-foreground">Promoters</div></CardContent></Card>
        <Card><CardContent className="py-5 text-center"><div className="text-2xl font-bold text-amber-600">{s?.passives ?? 0}</div><div className="text-xs text-muted-foreground">Passives</div></CardContent></Card>
        <Card><CardContent className="py-5 text-center"><div className="text-2xl font-bold text-red-600">{s?.detractors ?? 0}</div><div className="text-xs text-muted-foreground">Detractors</div></CardContent></Card>
        <Card><CardContent className="py-5 text-center"><div className="text-2xl font-bold">{s?.total ?? 0}</div><div className="text-xs text-muted-foreground">Responses</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Recent responses</CardTitle></CardHeader>
        <CardContent className="p-0">
          {responsesQ.isLoading ? <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div> :
            (responsesQ.data ?? []).length === 0 ? <div className="py-10 text-center text-muted-foreground text-sm">No responses yet.</div> :
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Score</TableHead><TableHead>Patient</TableHead><TableHead>Test</TableHead><TableHead>Comment</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(responsesQ.data ?? []).map((r) => {
                    const cat = CAT[r.category ?? ""] ?? CAT.detractor;
                    const Icon = cat.icon;
                    return (
                      <TableRow key={r.id}>
                        <TableCell><Badge variant="outline" className={`gap-1 ${cat.cls}`}><Icon className="h-3 w-3" />{r.npsScore}</Badge></TableCell>
                        <TableCell className="max-w-[150px] truncate">{r.patientName || "—"}</TableCell>
                        <TableCell className="max-w-[160px] truncate">{r.testName || "—"}</TableCell>
                        <TableCell className="max-w-[280px] truncate">{r.comment || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-xs">{new Date(r.submittedAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>}
        </CardContent>
      </Card>
    </div>
  );
}
