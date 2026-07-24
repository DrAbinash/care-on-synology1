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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, Lock } from "lucide-react";

type StaffRow = { id: number; firstName: string; lastName: string; staffId: string };
type Case = { id: number; staffId: number; type: string; severity: string; reason: string; description: string | null; incidentDate: string | null; status: string; issuedByName: string | null; issuedAt: string | null; employeeResponse: string | null; outcome: string | null };

const TYPES = ["verbal_warning", "written_warning", "show_cause", "suspension", "inquiry", "termination_notice"];
const label = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => s === "closed" ? "secondary" : s === "issued" ? "destructive" : s === "responded" ? "default" : "outline";

export default function DisciplinaryPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [closing, setClosing] = useState<Case | null>(null);
  const [outcome, setOutcome] = useState("");

  const { data: staff = [] } = useQuery({ queryKey: ["disc-staff"], queryFn: () => api.get<StaffRow[]>("/api/staff?active=true") });
  const staffName = (id: number) => { const s = staff.find((x) => x.id === id); return s ? `${s.firstName} ${s.lastName}` : `Staff #${id}`; };
  const qs = status === "all" ? "" : `?status=${status}`;
  const { data: cases = [], isLoading } = useQuery({ queryKey: ["disc-cases", status], queryFn: () => api.get<Case[]>(`/api/disciplinary${qs}`), retry: false });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["disc-cases"] });

  const issue = useMutation({
    mutationFn: (id: number) => api.post(`/api/disciplinary/${id}/issue`, {}),
    onSuccess: () => { toast({ title: "Action issued" }); invalidate(); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  const close = useMutation({
    mutationFn: () => api.post(`/api/disciplinary/${closing!.id}/close`, { outcome }),
    onSuccess: () => { toast({ title: "Case closed" }); setClosing(null); setOutcome(""); invalidate(); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader title="Disciplinary" subtitle="Confidential case management — warnings, inquiries and suspensions" />
      <Card className="border-muted bg-muted/30"><CardContent className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" />Confidential. Suspension here does not change payroll. Every step is audited.</CardContent></Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 space-y-3">
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">Cases</CardTitle>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="issued">Issued</SelectItem>
                  <SelectItem value="responded">Responded</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : cases.length === 0 ? (
                <p className="text-sm text-muted-foreground">No {status === "all" ? "" : status + " "}cases.</p>
              ) : (
                <div className="divide-y">
                  {cases.map((c) => (
                    <div key={c.id} className="py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{staffName(c.staffId)} · {label(c.type)}</span>
                        <Badge variant={statusVariant(c.status)} className="text-[10px]">{c.status}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        <Badge variant="outline" className="text-[10px] mr-1">{c.severity}</Badge>
                        {c.reason}{c.incidentDate ? ` · incident ${c.incidentDate}` : ""}
                      </div>
                      {c.employeeResponse && <div className="text-xs mt-1 rounded bg-muted px-2 py-1"><span className="font-medium">Employee response: </span>{c.employeeResponse}</div>}
                      {c.outcome && <div className="text-xs mt-1 text-muted-foreground"><span className="font-medium">Outcome: </span>{c.outcome}</div>}
                      <div className="flex gap-2 mt-1.5">
                        {c.status === "draft" && <Button size="sm" variant="outline" disabled={issue.isPending} onClick={() => issue.mutate(c.id)}>Issue</Button>}
                        {(c.status === "issued" || c.status === "responded") && <Button size="sm" variant="outline" onClick={() => { setClosing(c); setOutcome(""); }}>Close case</Button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2"><NewCase staff={staff} onCreated={invalidate} toast={toast} /></div>
      </div>

      <Dialog open={!!closing} onOpenChange={(o) => { if (!o) setClosing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Close case</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{closing ? `${staffName(closing.staffId)} · ${label(closing.type)}` : ""}</p>
          <Textarea placeholder="Outcome / resolution (required)" value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={4} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)}>Cancel</Button>
            <Button disabled={!outcome.trim() || close.isPending} onClick={() => close.mutate()}>{close.isPending ? "Closing…" : "Close case"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewCase({ staff, onCreated, toast }: { staff: StaffRow[]; onCreated: () => void; toast: ReturnType<typeof useToast>["toast"] }) {
  const [form, setForm] = useState({ staffId: "", type: "verbal_warning", severity: "minor", reason: "", description: "", incidentDate: "" });
  const create = useMutation({
    mutationFn: () => api.post("/api/disciplinary", { staffId: Number(form.staffId), type: form.type, severity: form.severity, reason: form.reason, description: form.description || undefined, incidentDate: form.incidentDate || undefined }),
    onSuccess: () => { toast({ title: "Case created (draft)" }); setForm({ staffId: "", type: "verbal_warning", severity: "minor", reason: "", description: "", incidentDate: "" }); onCreated(); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="h-4 w-4" />New case</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <Select value={form.staffId} onValueChange={(v) => setForm({ ...form, staffId: v })}>
          <SelectTrigger><SelectValue placeholder="Staff member" /></SelectTrigger>
          <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.firstName} {s.lastName} · {s.staffId}</SelectItem>)}</SelectContent>
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{label(t)}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="minor">Minor</SelectItem>
              <SelectItem value="major">Major</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input placeholder="Reason (required)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <Textarea placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
        <label className="text-xs text-muted-foreground">Incident date<Input type="date" value={form.incidentDate} onChange={(e) => setForm({ ...form, incidentDate: e.target.value })} /></label>
        <Button className="w-full" disabled={!form.staffId || !form.reason.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create draft"}</Button>
      </CardContent>
    </Card>
  );
}
