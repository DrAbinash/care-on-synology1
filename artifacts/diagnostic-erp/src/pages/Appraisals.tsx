import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Award, ClipboardList, Check, Clock, X } from "lucide-react";

type StaffRow = { id: number; firstName: string; lastName: string; staffId: string };
type Cycle = { id: number; label: string; yearStart: string; yearEnd: string };
type Appraisal = { id: number; cycleId: number; staffId: number; annualScoreAvg: string | null; recommendationBand: string | null; recommendation: string | null; strengths: string | null; improvementAreas: string | null; managerComments: string | null; managementDecision: string | null };
type Pip = { id: number; staffId: number; reason: string; requiredActions: string | null; trainingAssigned: string | null; startDate: string | null; status: string; outcome: string | null };

const PIP_STATUSES = ["draft", "active", "review_due", "improved", "extended", "failed", "closed"];

export default function AppraisalsPage() {
  const { toast } = useToast();
  const { data: staff = [] } = useQuery({ queryKey: ["appr-staff"], queryFn: () => api.get<StaffRow[]>("/api/staff?active=true") });
  const staffName = (id: number) => { const s = staff.find((x) => x.id === id); return s ? `${s.firstName} ${s.lastName}` : `Staff #${id}`; };
  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader title="Appraisals" subtitle="Annual appraisals, advisory increment recommendations and PIPs" />
      <Card className="border-muted bg-muted/30"><CardContent className="py-2 text-xs text-muted-foreground">Increment output is a recommendation only — nothing here changes payroll or salary.</CardContent></Card>
      <Tabs defaultValue="appraisals">
        <TabsList>
          <TabsTrigger value="appraisals"><Award className="h-3.5 w-3.5 mr-1" />Appraisals</TabsTrigger>
          <TabsTrigger value="pips"><ClipboardList className="h-3.5 w-3.5 mr-1" />PIPs</TabsTrigger>
        </TabsList>
        <TabsContent value="appraisals" className="mt-4"><AppraisalsTab staff={staff} staffName={staffName} toast={toast} /></TabsContent>
        <TabsContent value="pips" className="mt-4"><PipsTab staff={staff} staffName={staffName} toast={toast} /></TabsContent>
      </Tabs>
    </div>
  );
}

function AppraisalsTab({ staff, staffName, toast }: { staff: StaffRow[]; staffName: (id: number) => string; toast: ReturnType<typeof useToast>["toast"] }) {
  const qc = useQueryClient();
  const [cycleId, setCycleId] = useState("");
  const [cycleForm, setCycleForm] = useState({ label: "", yearStart: "", yearEnd: "" });
  const [form, setForm] = useState({ staffId: "", strengths: "", improvementAreas: "", managerComments: "" });

  const { data: cycles = [] } = useQuery({ queryKey: ["appr-cycles"], queryFn: () => api.get<Cycle[]>("/api/appraisal/cycles"), retry: false });
  const { data: appraisals = [] } = useQuery({ queryKey: ["appr-list", cycleId], queryFn: () => api.get<Appraisal[]>(`/api/appraisal/cycles/${cycleId}/appraisals`), enabled: !!cycleId, retry: false });

  const createCycle = useMutation({
    mutationFn: () => api.post<Cycle>("/api/appraisal/cycles", { label: cycleForm.label, yearStart: cycleForm.yearStart, yearEnd: cycleForm.yearEnd }),
    onSuccess: (row) => { toast({ title: "Cycle created" }); setCycleForm({ label: "", yearStart: "", yearEnd: "" }); setCycleId(String(row.id)); qc.invalidateQueries({ queryKey: ["appr-cycles"] }); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  const createAppraisal = useMutation({
    mutationFn: () => api.post("/api/appraisal/appraisals", { cycleId: Number(cycleId), staffId: Number(form.staffId), strengths: form.strengths || undefined, improvementAreas: form.improvementAreas || undefined, managerComments: form.managerComments || undefined }),
    onSuccess: () => { toast({ title: "Appraisal recorded" }); setForm({ staffId: "", strengths: "", improvementAreas: "", managerComments: "" }); qc.invalidateQueries({ queryKey: ["appr-list", cycleId] }); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  const decide = useMutation({
    mutationFn: ({ id, managementDecision }: { id: number; managementDecision: "approved" | "deferred" | "rejected" }) => api.post(`/api/appraisal/appraisals/${id}/decide`, { managementDecision }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["appr-list", cycleId] }); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Appraisal cycle</div>
            <Select value={cycleId} onValueChange={setCycleId}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select cycle" /></SelectTrigger>
              <SelectContent>{cycles.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-1.5">
            <Input className="w-40" placeholder="New cycle label" value={cycleForm.label} onChange={(e) => setCycleForm({ ...cycleForm, label: e.target.value })} />
            <label className="text-[10px] text-muted-foreground">Start<Input type="date" className="w-36" value={cycleForm.yearStart} onChange={(e) => setCycleForm({ ...cycleForm, yearStart: e.target.value })} /></label>
            <label className="text-[10px] text-muted-foreground">End<Input type="date" className="w-36" value={cycleForm.yearEnd} onChange={(e) => setCycleForm({ ...cycleForm, yearEnd: e.target.value })} /></label>
            <Button variant="outline" disabled={!cycleForm.label || !cycleForm.yearStart || !cycleForm.yearEnd || createCycle.isPending} onClick={() => createCycle.mutate()}>Add cycle</Button>
          </div>
        </CardContent>
      </Card>

      {cycleId && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Appraisals</CardTitle></CardHeader>
            <CardContent>
              {appraisals.length === 0 ? <p className="text-sm text-muted-foreground">No appraisals in this cycle yet.</p> : (
                <div className="divide-y">
                  {appraisals.map((a) => (
                    <div key={a.id} className="py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{staffName(a.staffId)}</span>
                        <span className="flex items-center gap-1.5">
                          {a.annualScoreAvg != null && <span className="text-xs text-muted-foreground tabular-nums">avg {Number(a.annualScoreAvg).toFixed(1)}</span>}
                          {a.managementDecision ? <Badge variant={a.managementDecision === "approved" ? "default" : a.managementDecision === "rejected" ? "destructive" : "secondary"} className="text-[10px]">{a.managementDecision}</Badge> : null}
                        </span>
                      </div>
                      {a.recommendation && <div className="text-xs text-muted-foreground mt-0.5">Recommendation: {a.recommendation}{a.recommendationBand ? ` (${a.recommendationBand})` : ""}</div>}
                      {!a.managementDecision && (
                        <div className="flex gap-1.5 mt-1.5">
                          <Button size="sm" variant="outline" className="text-green-700" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, managementDecision: "approved" })}><Check className="h-3.5 w-3.5 mr-1" />Approve</Button>
                          <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, managementDecision: "deferred" })}><Clock className="h-3.5 w-3.5 mr-1" />Defer</Button>
                          <Button size="sm" variant="outline" className="text-red-700" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, managementDecision: "rejected" })}><X className="h-3.5 w-3.5 mr-1" />Reject</Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Record appraisal</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Select value={form.staffId} onValueChange={(v) => setForm({ ...form, staffId: v })}>
                <SelectTrigger><SelectValue placeholder="Staff member" /></SelectTrigger>
                <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.firstName} {s.lastName} · {s.staffId}</SelectItem>)}</SelectContent>
              </Select>
              <Textarea placeholder="Strengths" value={form.strengths} onChange={(e) => setForm({ ...form, strengths: e.target.value })} rows={2} />
              <Textarea placeholder="Improvement areas" value={form.improvementAreas} onChange={(e) => setForm({ ...form, improvementAreas: e.target.value })} rows={2} />
              <Textarea placeholder="Manager comments" value={form.managerComments} onChange={(e) => setForm({ ...form, managerComments: e.target.value })} rows={2} />
              <Button className="w-full" disabled={!form.staffId || createAppraisal.isPending} onClick={() => createAppraisal.mutate()}>{createAppraisal.isPending ? "Saving…" : "Record appraisal"}</Button>
              <p className="text-xs text-muted-foreground">The annual score average + increment recommendation are computed from finalized performance scores.</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function PipsTab({ staff, staffName, toast }: { staff: StaffRow[]; staffName: (id: number) => string; toast: ReturnType<typeof useToast>["toast"] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ staffId: "", reason: "", requiredActions: "", startDate: "" });
  const { data: pips = [] } = useQuery({ queryKey: ["pips"], queryFn: () => api.get<Pip[]>("/api/appraisal/pips"), retry: false });
  const create = useMutation({
    mutationFn: () => api.post("/api/appraisal/pips", { staffId: Number(form.staffId), reason: form.reason, requiredActions: form.requiredActions || undefined, startDate: form.startDate || undefined }),
    onSuccess: () => { toast({ title: "PIP created" }); setForm({ staffId: "", reason: "", requiredActions: "", startDate: "" }); qc.invalidateQueries({ queryKey: ["pips"] }); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.patch(`/api/appraisal/pips/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pips"] }),
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Performance Improvement Plans</CardTitle></CardHeader>
        <CardContent>
          {pips.length === 0 ? <p className="text-sm text-muted-foreground">No PIPs.</p> : (
            <div className="divide-y">
              {pips.map((p) => (
                <div key={p.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{staffName(p.staffId)}</span>
                    <Select value={p.status} onValueChange={(v) => setStatus.mutate({ id: p.id, status: v })}>
                      <SelectTrigger className="w-36 h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{PIP_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{p.reason}{p.startDate ? ` · from ${p.startDate}` : ""}</div>
                  {p.requiredActions && <div className="text-xs mt-0.5">Actions: {p.requiredActions}</div>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">New PIP</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Select value={form.staffId} onValueChange={(v) => setForm({ ...form, staffId: v })}>
            <SelectTrigger><SelectValue placeholder="Staff member" /></SelectTrigger>
            <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.firstName} {s.lastName} · {s.staffId}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Reason (required)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <Textarea placeholder="Required actions" value={form.requiredActions} onChange={(e) => setForm({ ...form, requiredActions: e.target.value })} rows={3} />
          <label className="text-xs text-muted-foreground">Start date<Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
          <Button className="w-full" disabled={!form.staffId || !form.reason.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create PIP"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
