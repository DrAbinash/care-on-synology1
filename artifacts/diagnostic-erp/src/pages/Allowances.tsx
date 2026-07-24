import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Wallet, Check, X, PauseCircle } from "lucide-react";

type StaffRow = { id: number; firstName: string; lastName: string; staffId: string };
type Reason = { rule: string; ok: boolean | null; detail?: string };
type Eligibility = { id: number; staffId: number; allowanceKind: string; periodLabel: string; status: string; reasons: Reason[] | null; approvedByName: string | null };

const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" =>
  s === "approved" || s === "eligible" ? "default" : s === "rejected" || s === "disqualified" || s === "not_eligible" ? "destructive" : "secondary";

export default function AllowancesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: staff = [] } = useQuery({ queryKey: ["allow-staff"], queryFn: () => api.get<StaffRow[]>("/api/staff?active=true") });
  const staffName = (id: number) => { const s = staff.find((x) => x.id === id); return s ? `${s.firstName} ${s.lastName}` : `Staff #${id}`; };
  const { data: rows = [] } = useQuery({ queryKey: ["allow-list"], queryFn: () => api.get<Eligibility[]>("/api/recognition/allowances/eligibility"), retry: false });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["allow-list"] });

  const decide = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "approved" | "rejected" | "on_hold" }) => api.post(`/api/recognition/allowances/eligibility/${id}/decide`, { status }),
    onSuccess: () => { toast({ title: "Decision saved" }); invalidate(); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader title="Allowances" subtitle="Travel / food allowance eligibility — advisory, no payroll effect" />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Eligibility records</CardTitle></CardHeader>
            <CardContent>
              {rows.length === 0 ? <p className="text-sm text-muted-foreground">No eligibility records yet — evaluate one on the right.</p> : (
                <div className="divide-y">
                  {rows.map((r) => (
                    <div key={r.id} className="py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{staffName(r.staffId)} <span className="text-muted-foreground font-normal capitalize">· {r.allowanceKind} · {r.periodLabel}</span></span>
                        <Badge variant={statusVariant(r.status)} className="text-[10px]">{r.status.replace(/_/g, " ")}</Badge>
                      </div>
                      {r.reasons && r.reasons.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-1">
                          {r.reasons.map((x, i) => (
                            <span key={i} className={`rounded px-1.5 py-0.5 ${x.ok === false ? "bg-red-100 text-red-700 dark:bg-red-950/40" : x.ok ? "bg-green-100 text-green-700 dark:bg-green-950/40" : "bg-muted"}`}>{x.rule}{x.detail ? `: ${x.detail}` : ""}</span>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-1.5 mt-1.5">
                        <Button size="sm" variant="outline" className="text-green-700" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, status: "approved" })}><Check className="h-3.5 w-3.5 mr-1" />Approve</Button>
                        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, status: "on_hold" })}><PauseCircle className="h-3.5 w-3.5 mr-1" />Hold</Button>
                        <Button size="sm" variant="outline" className="text-red-700" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, status: "rejected" })}><X className="h-3.5 w-3.5 mr-1" />Reject</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2"><Evaluate staff={staff} onDone={invalidate} toast={toast} /></div>
      </div>
    </div>
  );
}

function Evaluate({ staff, onDone, toast }: { staff: StaffRow[]; onDone: () => void; toast: ReturnType<typeof useToast>["toast"] }) {
  const [form, setForm] = useState({ staffId: "", kind: "travel", periodLabel: "", monthlyScore: "", attendancePct: "" });
  const [flags, setFlags] = useState({ majorMisconduct: false, seriousComplaint: false, documentedExtraContribution: false });

  const evaluate = useMutation({
    mutationFn: () => {
      const metrics: Record<string, unknown> = { ...flags };
      if (form.monthlyScore !== "") metrics.monthlyScore = Number(form.monthlyScore);
      if (form.attendancePct !== "") metrics.attendancePct = Number(form.attendancePct);
      return api.post("/api/recognition/allowances/eligibility", { staffId: Number(form.staffId), kind: form.kind, periodLabel: form.periodLabel, metrics });
    },
    onSuccess: () => { toast({ title: "Eligibility evaluated" }); setForm({ staffId: "", kind: form.kind, periodLabel: "", monthlyScore: "", attendancePct: "" }); setFlags({ majorMisconduct: false, seriousComplaint: false, documentedExtraContribution: false }); onDone(); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4" />Evaluate eligibility</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <Select value={form.staffId} onValueChange={(v) => setForm({ ...form, staffId: v })}>
          <SelectTrigger><SelectValue placeholder="Staff member" /></SelectTrigger>
          <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.firstName} {s.lastName} · {s.staffId}</SelectItem>)}</SelectContent>
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="travel">Travel</SelectItem>
              <SelectItem value="food">Food</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Period (e.g. 2026-07)" value={form.periodLabel} onChange={(e) => setForm({ ...form, periodLabel: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">Monthly score<Input type="number" min="0" value={form.monthlyScore} onChange={(e) => setForm({ ...form, monthlyScore: e.target.value })} /></label>
          <label className="text-xs text-muted-foreground">Attendance %<Input type="number" min="0" max="100" value={form.attendancePct} onChange={(e) => setForm({ ...form, attendancePct: e.target.value })} /></label>
        </div>
        <div className="space-y-1.5 pt-1">
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={flags.majorMisconduct} onCheckedChange={(v) => setFlags({ ...flags, majorMisconduct: v === true })} />Major misconduct</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={flags.seriousComplaint} onCheckedChange={(v) => setFlags({ ...flags, seriousComplaint: v === true })} />Serious complaint</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={flags.documentedExtraContribution} onCheckedChange={(v) => setFlags({ ...flags, documentedExtraContribution: v === true })} />Documented extra contribution</label>
        </div>
        <Button className="w-full" disabled={!form.staffId || !form.periodLabel.trim() || evaluate.isPending} onClick={() => evaluate.mutate()}>{evaluate.isPending ? "Evaluating…" : "Evaluate & record"}</Button>
        <p className="text-xs text-muted-foreground">The engine decides eligibility from these metrics; management then approves or rejects.</p>
      </CardContent>
    </Card>
  );
}
