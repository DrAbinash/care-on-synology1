import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MapPin, LogIn, LogOut, CalendarClock, Bell, Plane } from "lucide-react";

type Me = { linked: boolean; staffId?: number; staff?: { firstName: string; lastName: string; staffId: string; role: string } };
type Attendance = { id: number; attendanceDate: string; punchIn: string | null; punchOut: string | null; source: string };
type LeaveType = { id: number; code: string; name: string };
type LeaveBalance = { id: number; leaveTypeId: number; year: number; entitled: string; used: string };
type LeaveRequest = { id: number; leaveTypeId: number; fromDate: string; toDate: string; days: string; status: string };
type Note = { id: number; type: string; title: string; body: string | null; isRead: boolean; createdAt: string };

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) { reject(new Error("Geolocation not supported on this device")); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
  });
}
const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");

export default function MyPortalPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/self-service/me"), retry: false });
  const linked = me?.linked === true;

  const { data: attendance = [] } = useQuery({ queryKey: ["my-attendance"], queryFn: () => api.get<Attendance[]>("/api/self-service/attendance"), enabled: linked, retry: false });
  const { data: leave } = useQuery({ queryKey: ["my-leave"], queryFn: () => api.get<{ requests: LeaveRequest[]; balances: LeaveBalance[] }>("/api/self-service/leave"), enabled: linked, retry: false });
  const { data: leaveTypes = [] } = useQuery({ queryKey: ["my-leave-types"], queryFn: () => api.get<LeaveType[]>("/api/self-service/leave-types"), enabled: linked, retry: false });
  const { data: notes = [] } = useQuery({ queryKey: ["my-notes"], queryFn: () => api.get<Note[]>("/api/self-service/notifications"), enabled: linked, retry: false });
  const typeName = (id: number) => leaveTypes.find((t) => t.id === id)?.name ?? `Type #${id}`;

  const checkIn = async (action: "in" | "out") => {
    setBusy(action);
    try {
      const pos = await getPosition();
      const res = await api.post<{ action: string; duplicate: boolean }>("/api/self-service/attendance/check-in", { action, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      toast({ title: `Checked ${res.action}`, description: res.duplicate ? "Already recorded" : "Location captured" });
      qc.invalidateQueries({ queryKey: ["my-attendance"] });
    } catch (e) {
      toast({ title: "Check-in failed", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const markRead = useMutation({
    mutationFn: (id: number) => api.post(`/api/recognition/notifications/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-notes"] }),
  });

  if (me && !linked) {
    return (
      <div className="space-y-4"><PageHeader title="My Portal" subtitle="Employee self-service" />
        <Card><CardContent className="py-10 text-center text-muted-foreground">Your login isn't linked to a staff profile yet. Please ask HR to link your account.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader title="My Portal" subtitle={me?.staff ? `${me.staff.firstName} ${me.staff.lastName} · ${me.staff.role}` : "Employee self-service"} />

      {/* GPS check-in */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><MapPin className="h-4 w-4" />Mobile check-in</CardTitle></CardHeader>
        <CardContent className="flex gap-3">
          <Button size="lg" onClick={() => checkIn("in")} disabled={busy !== null}><LogIn className="h-4 w-4 mr-1" />{busy === "in" ? "Locating…" : "Check In"}</Button>
          <Button size="lg" variant="secondary" onClick={() => checkIn("out")} disabled={busy !== null}><LogOut className="h-4 w-4 mr-1" />{busy === "out" ? "Locating…" : "Check Out"}</Button>
          <p className="text-xs text-muted-foreground self-center">Uses your device location. Records an attendance punch (source: mobile GPS).</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Attendance */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4" />Recent attendance</CardTitle></CardHeader>
          <CardContent>
            {attendance.length === 0 ? <p className="text-sm text-muted-foreground">No records.</p> : (
              <div className="space-y-1 text-sm">
                {attendance.slice(0, 8).map((a) => (
                  <div key={a.id} className="flex justify-between border-b py-1 last:border-0">
                    <span>{a.attendanceDate}</span>
                    <span className="text-muted-foreground">{timeOf(a.punchIn)} – {timeOf(a.punchOut)} <Badge variant="outline" className="ml-1 text-[10px]">{a.source}</Badge></span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Bell className="h-4 w-4" />Notifications</CardTitle></CardHeader>
          <CardContent>
            {notes.length === 0 ? <p className="text-sm text-muted-foreground">You're all caught up.</p> : (
              <div className="space-y-2">
                {notes.slice(0, 8).map((n) => (
                  <div key={n.id} className={`rounded-md border px-3 py-2 text-sm ${n.isRead ? "opacity-60" : ""}`}>
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{n.title}</span>
                      {!n.isRead && <button className="text-xs text-primary" onClick={() => markRead.mutate(n.id)}>Mark read</button>}
                    </div>
                    {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Leave */}
      <LeaveSection balances={leave?.balances ?? []} requests={leave?.requests ?? []} leaveTypes={leaveTypes} typeName={typeName} onApplied={() => qc.invalidateQueries({ queryKey: ["my-leave"] })} />
    </div>
  );
}

function LeaveSection({ balances, requests, leaveTypes, typeName, onApplied }: {
  balances: LeaveBalance[]; requests: LeaveRequest[]; leaveTypes: LeaveType[]; typeName: (id: number) => string; onApplied: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({ leaveTypeId: "", fromDate: "", toDate: "", days: "", reason: "" });
  const apply = useMutation({
    mutationFn: () => api.post("/api/self-service/leave", { leaveTypeId: Number(form.leaveTypeId), fromDate: form.fromDate, toDate: form.toDate, days: Number(form.days), reason: form.reason || undefined }),
    onSuccess: () => { toast({ title: "Leave request submitted" }); setForm({ leaveTypeId: "", fromDate: "", toDate: "", days: "", reason: "" }); onApplied(); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  const canSubmit = form.leaveTypeId && form.fromDate && form.toDate && Number(form.days) > 0;

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Plane className="h-4 w-4" />Leave</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1">Balances</div>
          {balances.length === 0 ? <p className="text-sm text-muted-foreground">No balances set.</p> : balances.map((b) => (
            <div key={b.id} className="flex justify-between text-sm border-b py-1 last:border-0">
              <span>{typeName(b.leaveTypeId)} ({b.year})</span>
              <span className="text-muted-foreground tabular-nums">{(Number(b.entitled) - Number(b.used)).toFixed(1)} left</span>
            </div>
          ))}
          <div className="text-xs font-semibold text-muted-foreground mt-3 mb-1">Requests</div>
          {requests.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : requests.slice(0, 6).map((r) => (
            <div key={r.id} className="flex justify-between text-sm py-0.5">
              <span>{typeName(r.leaveTypeId)} · {r.fromDate}→{r.toDate}</span>
              <Badge variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "secondary"} className="text-[10px]">{r.status}</Badge>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">Apply for leave</div>
          <Select value={form.leaveTypeId} onValueChange={(v) => setForm({ ...form, leaveTypeId: v })}>
            <SelectTrigger><SelectValue placeholder="Leave type" /></SelectTrigger>
            <SelectContent>{leaveTypes.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} />
            <Input type="date" value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} />
          </div>
          <Input type="number" min="0.5" step="0.5" placeholder="Days" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
          <Input placeholder="Reason (optional)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <Button className="w-full" disabled={!canSubmit || apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? "Submitting…" : "Submit request"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
