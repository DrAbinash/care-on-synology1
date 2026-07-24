import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { CalendarClock, Clock, PartyPopper, Trash2 } from "lucide-react";

type StaffRow = { id: number; firstName: string; lastName: string; staffId: string };
type Shift = { id: number; name: string; code: string | null; startTime: string; endTime: string; crossMidnight: boolean; graceMinutes: number; breakMinutes: number };
type Duty = { id: number; staffId: number; dutyDate: string; shiftTemplateId: number | null; status: string; notes: string | null };
type Holiday = { id: number; holidayDate: string; name: string; type: string };

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export default function RosterPage() {
  const { toast } = useToast();
  const { data: staff = [] } = useQuery({ queryKey: ["roster-staff"], queryFn: () => api.get<StaffRow[]>("/api/staff?active=true") });
  const { data: shifts = [] } = useQuery({ queryKey: ["roster-shifts"], queryFn: () => api.get<Shift[]>("/api/roster/shift-templates"), retry: false });
  const staffName = (id: number) => { const s = staff.find((x) => x.id === id); return s ? `${s.firstName} ${s.lastName}` : `Staff #${id}`; };
  const shiftName = (id: number | null) => (id == null ? "—" : shifts.find((s) => s.id === id)?.name ?? `Shift #${id}`);

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader title="Duty Roster" subtitle="Shift scheduling, duty assignments and the holiday calendar" />
      <Tabs defaultValue="roster">
        <TabsList>
          <TabsTrigger value="roster"><CalendarClock className="h-3.5 w-3.5 mr-1" />Roster</TabsTrigger>
          <TabsTrigger value="shifts"><Clock className="h-3.5 w-3.5 mr-1" />Shifts</TabsTrigger>
          <TabsTrigger value="holidays"><PartyPopper className="h-3.5 w-3.5 mr-1" />Holidays</TabsTrigger>
        </TabsList>
        <TabsContent value="roster" className="mt-4"><RosterTab staff={staff} shifts={shifts} staffName={staffName} shiftName={shiftName} toast={toast} /></TabsContent>
        <TabsContent value="shifts" className="mt-4"><ShiftsTab shifts={shifts} toast={toast} /></TabsContent>
        <TabsContent value="holidays" className="mt-4"><HolidaysTab toast={toast} /></TabsContent>
      </Tabs>
    </div>
  );
}

function RosterTab({ staff, shifts, staffName, shiftName, toast }: { staff: StaffRow[]; shifts: Shift[]; staffName: (id: number) => string; shiftName: (id: number | null) => string; toast: ReturnType<typeof useToast>["toast"] }) {
  const qc = useQueryClient();
  const [range, setRange] = useState({ from: todayISO(), to: addDays(todayISO(), 6) });
  const [form, setForm] = useState({ staffId: "", dutyDate: todayISO(), shiftTemplateId: "", notes: "" });
  const key = ["roster", range.from, range.to];
  const { data: duties = [] } = useQuery({ queryKey: key, queryFn: () => api.get<Duty[]>(`/api/roster?from=${range.from}&to=${range.to}`), retry: false });

  const assign = useMutation({
    mutationFn: () => api.post("/api/roster", { staffId: Number(form.staffId), dutyDate: form.dutyDate, shiftTemplateId: form.shiftTemplateId ? Number(form.shiftTemplateId) : null, notes: form.notes || undefined }),
    onSuccess: () => { toast({ title: "Duty assigned" }); setForm({ ...form, staffId: "", notes: "" }); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/roster/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Roster</CardTitle>
          <div className="flex items-center gap-1.5">
            <Input type="date" className="w-36" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <span className="text-muted-foreground text-xs">→</span>
            <Input type="date" className="w-36" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </div>
        </CardHeader>
        <CardContent>
          {duties.length === 0 ? <p className="text-sm text-muted-foreground">No duties scheduled in this range.</p> : (
            <div className="divide-y">
              {duties.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <span className="font-medium">{staffName(d.staffId)}</span>
                    <div className="text-xs text-muted-foreground">{d.dutyDate} · {shiftName(d.shiftTemplateId)}{d.notes ? ` · ${d.notes}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{d.status}</Badge>
                    <button className="text-muted-foreground hover:text-red-600" onClick={() => remove.mutate(d.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Assign duty</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Select value={form.staffId} onValueChange={(v) => setForm({ ...form, staffId: v })}>
            <SelectTrigger><SelectValue placeholder="Staff member" /></SelectTrigger>
            <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.firstName} {s.lastName} · {s.staffId}</SelectItem>)}</SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" value={form.dutyDate} onChange={(e) => setForm({ ...form, dutyDate: e.target.value })} />
            <Select value={form.shiftTemplateId} onValueChange={(v) => setForm({ ...form, shiftTemplateId: v })}>
              <SelectTrigger><SelectValue placeholder="Shift" /></SelectTrigger>
              <SelectContent>{shifts.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.startTime}–{s.endTime})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Input placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <Button className="w-full" disabled={!form.staffId || !form.dutyDate || assign.isPending} onClick={() => assign.mutate()}>{assign.isPending ? "Saving…" : "Assign duty"}</Button>
          <p className="text-xs text-muted-foreground">Re-assigning the same staff + date updates the existing entry.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function ShiftsTab({ shifts, toast }: { shifts: Shift[]; toast: ReturnType<typeof useToast>["toast"] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", code: "", startTime: "09:00", endTime: "17:00", graceMinutes: "10", breakMinutes: "0" });
  const create = useMutation({
    mutationFn: () => api.post("/api/roster/shift-templates", { name: form.name, code: form.code || null, startTime: form.startTime, endTime: form.endTime, graceMinutes: Number(form.graceMinutes) || 0, breakMinutes: Number(form.breakMinutes) || 0 }),
    onSuccess: () => { toast({ title: "Shift added" }); setForm({ ...form, name: "", code: "" }); qc.invalidateQueries({ queryKey: ["roster-shifts"] }); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/roster/shift-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roster-shifts"] }),
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Shift templates</CardTitle></CardHeader>
        <CardContent>
          {shifts.length === 0 ? <p className="text-sm text-muted-foreground">No shifts defined.</p> : (
            <div className="divide-y">
              {shifts.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{s.name}{s.code ? ` (${s.code})` : ""} <span className="text-muted-foreground">· {s.startTime}–{s.endTime}{s.crossMidnight ? " +1d" : ""}</span></span>
                  <button className="text-muted-foreground hover:text-red-600" onClick={() => remove.mutate(s.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Add shift</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Name (e.g. Morning)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Code (e.g. M)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">Start<Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">End<Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">Grace (min)<Input type="number" min="0" value={form.graceMinutes} onChange={(e) => setForm({ ...form, graceMinutes: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">Break (min)<Input type="number" min="0" value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })} /></label>
          </div>
          <Button className="w-full" disabled={!form.name || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Adding…" : "Add shift"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function HolidaysTab({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ holidayDate: todayISO(), name: "", type: "public" });
  const { data: holidays = [] } = useQuery({ queryKey: ["roster-holidays"], queryFn: () => api.get<Holiday[]>("/api/roster/holidays"), retry: false });
  const create = useMutation({
    mutationFn: () => api.post("/api/roster/holidays", { holidayDate: form.holidayDate, name: form.name, type: form.type }),
    onSuccess: () => { toast({ title: "Holiday added" }); setForm({ ...form, name: "" }); qc.invalidateQueries({ queryKey: ["roster-holidays"] }); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/roster/holidays/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roster-holidays"] }),
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Holiday calendar</CardTitle></CardHeader>
        <CardContent>
          {holidays.length === 0 ? <p className="text-sm text-muted-foreground">No holidays added.</p> : (
            <div className="divide-y">
              {holidays.map((h) => (
                <div key={h.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{h.holidayDate} · <span className="font-medium">{h.name}</span> <Badge variant="outline" className="text-[10px] ml-1">{h.type}</Badge></span>
                  <button className="text-muted-foreground hover:text-red-600" onClick={() => remove.mutate(h.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Add holiday</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input type="date" value={form.holidayDate} onChange={(e) => setForm({ ...form, holidayDate: e.target.value })} />
          <Input placeholder="Name (e.g. Republic Day)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="public">Public</SelectItem>
              <SelectItem value="optional">Optional</SelectItem>
              <SelectItem value="restricted">Restricted</SelectItem>
            </SelectContent>
          </Select>
          <Button className="w-full" disabled={!form.name || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Adding…" : "Add holiday"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
