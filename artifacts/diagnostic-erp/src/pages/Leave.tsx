import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plane, Check, X, CalendarDays } from "lucide-react";

type StaffRow = { id: number; firstName: string; lastName: string; staffId: string };
type LeaveType = { id: number; code: string; name: string; paid: boolean; maxDaysPerYear: string | null; countsAsAttendance: boolean; isActive: boolean };
type LeaveBalance = { id: number; staffId: number; leaveTypeId: number; year: number; entitled: string; used: string };
type LeaveRequest = { id: number; staffId: number; leaveTypeId: number; fromDate: string; toDate: string; days: string; halfDay: boolean; reason: string | null; status: string; approverName: string | null; decisionNote: string | null };

const num = (s: string | null | undefined) => (s == null ? 0 : Number(s));

export default function LeavePage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: staff = [] } = useQuery({ queryKey: ["leave-staff"], queryFn: () => api.get<StaffRow[]>("/api/staff?active=true") });
  const { data: types = [] } = useQuery({ queryKey: ["leave-types"], queryFn: () => api.get<LeaveType[]>("/api/leave/types"), retry: false });
  const staffName = (id: number) => { const s = staff.find((x) => x.id === id); return s ? `${s.firstName} ${s.lastName}` : `Staff #${id}`; };
  const typeName = (id: number) => types.find((t) => t.id === id)?.name ?? `Type #${id}`;

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader title="Leave" subtitle="Approve requests, manage leave types and balances" />
      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests"><Plane className="h-3.5 w-3.5 mr-1" />Requests</TabsTrigger>
          <TabsTrigger value="types">Leave Types</TabsTrigger>
          <TabsTrigger value="balances"><CalendarDays className="h-3.5 w-3.5 mr-1" />Balances</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-4">
          <RequestsTab staffName={staffName} typeName={typeName} onChange={() => qc.invalidateQueries({ queryKey: ["leave-requests"] })} toast={toast} />
        </TabsContent>
        <TabsContent value="types" className="mt-4">
          <TypesTab types={types} onChange={() => qc.invalidateQueries({ queryKey: ["leave-types"] })} toast={toast} />
        </TabsContent>
        <TabsContent value="balances" className="mt-4">
          <BalancesTab staff={staff} types={types} typeName={typeName} toast={toast} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RequestsTab({ staffName, typeName, onChange, toast }: { staffName: (id: number) => string; typeName: (id: number) => string; onChange: () => void; toast: ReturnType<typeof useToast>["toast"] }) {
  const [status, setStatus] = useState("submitted");
  const { data: requests = [], isLoading } = useQuery({ queryKey: ["leave-requests", status], queryFn: () => api.get<LeaveRequest[]>(`/api/leave/requests?status=${status}`), retry: false });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: "approved" | "rejected" }) => api.post(`/api/leave/requests/${id}/decide`, { decision }),
    onSuccess: (_r, v) => { toast({ title: `Leave ${v.decision}` }); onChange(); },
    onError: (e) => toast({ title: "Could not update", description: (e as Error).message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">Leave requests</CardTitle>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="submitted">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No {status} requests.</p>
        ) : (
          <div className="divide-y">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{staffName(r.staffId)} <span className="text-muted-foreground font-normal">· {typeName(r.leaveTypeId)}</span></div>
                  <div className="text-xs text-muted-foreground">{r.fromDate} → {r.toDate} · {num(r.days)} day(s){r.halfDay ? " · half-day" : ""}{r.reason ? ` · ${r.reason}` : ""}</div>
                </div>
                {r.status === "submitted" ? (
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" className="text-green-700" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: "approved" })}><Check className="h-3.5 w-3.5 mr-1" />Approve</Button>
                    <Button size="sm" variant="outline" className="text-red-700" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: "rejected" })}><X className="h-3.5 w-3.5 mr-1" />Reject</Button>
                  </div>
                ) : (
                  <Badge variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "secondary"} className="text-[10px] shrink-0">{r.status}</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TypesTab({ types, onChange, toast }: { types: LeaveType[]; onChange: () => void; toast: ReturnType<typeof useToast>["toast"] }) {
  const [form, setForm] = useState({ code: "", name: "", paid: true, maxDaysPerYear: "" });
  const create = useMutation({
    mutationFn: () => api.post("/api/leave/types", { code: form.code, name: form.name, paid: form.paid, maxDaysPerYear: form.maxDaysPerYear ? Number(form.maxDaysPerYear) : null }),
    onSuccess: () => { toast({ title: "Leave type added" }); setForm({ code: "", name: "", paid: true, maxDaysPerYear: "" }); onChange(); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Leave types</CardTitle></CardHeader>
        <CardContent>
          {types.length === 0 ? <p className="text-sm text-muted-foreground">No leave types yet.</p> : (
            <div className="divide-y">
              {types.map((t) => (
                <div key={t.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{t.name} <span className="text-muted-foreground">({t.code})</span></span>
                  <span className="flex items-center gap-1.5">
                    <Badge variant={t.paid ? "default" : "secondary"} className="text-[10px]">{t.paid ? "paid" : "unpaid"}</Badge>
                    {t.maxDaysPerYear && <span className="text-xs text-muted-foreground">{num(t.maxDaysPerYear)}/yr</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Add leave type</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Code (e.g. CL)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <Input placeholder="Name (e.g. Casual Leave)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <Input type="number" min="0" placeholder="Max days / year (optional)" value={form.maxDaysPerYear} onChange={(e) => setForm({ ...form, maxDaysPerYear: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><Switch checked={form.paid} onCheckedChange={(v) => setForm({ ...form, paid: v })} />Paid leave</label>
          <Button className="w-full" disabled={!form.code || !form.name || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Adding…" : "Add leave type"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function BalancesTab({ staff, types, typeName, toast }: { staff: StaffRow[]; types: LeaveType[]; typeName: (id: number) => string; toast: ReturnType<typeof useToast>["toast"] }) {
  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const [staffId, setStaffId] = useState("");
  const [form, setForm] = useState({ leaveTypeId: "", entitled: "" });
  const { data: balances = [] } = useQuery({ queryKey: ["leave-balances", staffId], queryFn: () => api.get<LeaveBalance[]>(`/api/leave/balances?staffId=${staffId}`), enabled: !!staffId, retry: false });
  const save = useMutation({
    mutationFn: () => api.post("/api/leave/balances", { staffId: Number(staffId), leaveTypeId: Number(form.leaveTypeId), year, entitled: Number(form.entitled) }),
    onSuccess: () => { toast({ title: "Balance saved" }); setForm({ leaveTypeId: "", entitled: "" }); qc.invalidateQueries({ queryKey: ["leave-balances", staffId] }); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Leave balances</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Select value={staffId} onValueChange={setStaffId}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Select staff member" /></SelectTrigger>
          <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.firstName} {s.lastName} · {s.staffId}</SelectItem>)}</SelectContent>
        </Select>
        {staffId && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">Current balances</div>
              {balances.length === 0 ? <p className="text-sm text-muted-foreground">No balances set.</p> : balances.map((b) => (
                <div key={b.id} className="flex justify-between text-sm border-b py-1 last:border-0">
                  <span>{typeName(b.leaveTypeId)} ({b.year})</span>
                  <span className="text-muted-foreground tabular-nums">{num(b.used)} used / {num(b.entitled)} entitled · {(num(b.entitled) - num(b.used)).toFixed(1)} left</span>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">Set entitlement ({year})</div>
              <Select value={form.leaveTypeId} onValueChange={(v) => setForm({ ...form, leaveTypeId: v })}>
                <SelectTrigger><SelectValue placeholder="Leave type" /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" min="0" step="0.5" placeholder="Entitled days" value={form.entitled} onChange={(e) => setForm({ ...form, entitled: e.target.value })} />
              <Button className="w-full" disabled={!form.leaveTypeId || form.entitled === "" || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save entitlement"}</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
