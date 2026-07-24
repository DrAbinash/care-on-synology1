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
import { Trophy, Medal } from "lucide-react";

type StaffRow = { id: number; firstName: string; lastName: string; staffId: string };
type AwardType = { id: number; code: string; name: string; cadence: string; description: string | null };
type Winner = { id: number; awardTypeId: number; staffId: number; periodLabel: string; citation: string | null; approvedByName: string | null; createdAt: string };

export default function AwardsPage() {
  const { toast } = useToast();
  const { data: staff = [] } = useQuery({ queryKey: ["award-staff"], queryFn: () => api.get<StaffRow[]>("/api/staff?active=true") });
  const { data: types = [] } = useQuery({ queryKey: ["award-types"], queryFn: () => api.get<AwardType[]>("/api/recognition/awards/types"), retry: false });
  const staffName = (id: number) => { const s = staff.find((x) => x.id === id); return s ? `${s.firstName} ${s.lastName}` : `Staff #${id}`; };
  const typeName = (id: number) => types.find((t) => t.id === id)?.name ?? `Award #${id}`;

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader title="Awards" subtitle="Employee of the Week / Month / Year recognition" />
      <Tabs defaultValue="winners">
        <TabsList>
          <TabsTrigger value="winners"><Trophy className="h-3.5 w-3.5 mr-1" />Winners</TabsTrigger>
          <TabsTrigger value="types"><Medal className="h-3.5 w-3.5 mr-1" />Award Types</TabsTrigger>
        </TabsList>
        <TabsContent value="winners" className="mt-4"><WinnersTab staff={staff} types={types} staffName={staffName} typeName={typeName} toast={toast} /></TabsContent>
        <TabsContent value="types" className="mt-4"><TypesTab types={types} toast={toast} /></TabsContent>
      </Tabs>
    </div>
  );
}

function WinnersTab({ staff, types, staffName, typeName, toast }: { staff: StaffRow[]; types: AwardType[]; staffName: (id: number) => string; typeName: (id: number) => string; toast: ReturnType<typeof useToast>["toast"] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ awardTypeId: "", staffId: "", periodLabel: "", citation: "" });
  const { data: winners = [] } = useQuery({ queryKey: ["award-winners"], queryFn: () => api.get<Winner[]>("/api/recognition/awards/winners"), retry: false });
  const create = useMutation({
    mutationFn: () => api.post("/api/recognition/awards/winners", { awardTypeId: Number(form.awardTypeId), staffId: Number(form.staffId), periodLabel: form.periodLabel, citation: form.citation || undefined }),
    onSuccess: () => { toast({ title: "Award recorded 🎉" }); setForm({ awardTypeId: "", staffId: "", periodLabel: "", citation: "" }); qc.invalidateQueries({ queryKey: ["award-winners"] }); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Recent winners</CardTitle></CardHeader>
        <CardContent>
          {winners.length === 0 ? <p className="text-sm text-muted-foreground">No awards recorded yet.</p> : (
            <div className="divide-y">
              {winners.map((w) => (
                <div key={w.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5 text-amber-500" />{staffName(w.staffId)}</span>
                    <Badge variant="outline" className="text-[10px]">{typeName(w.awardTypeId)} · {w.periodLabel}</Badge>
                  </div>
                  {w.citation && <p className="text-xs text-muted-foreground mt-0.5">{w.citation}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Give an award</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Select value={form.awardTypeId} onValueChange={(v) => setForm({ ...form, awardTypeId: v })}>
            <SelectTrigger><SelectValue placeholder={types.length ? "Award type" : "Add an award type first"} /></SelectTrigger>
            <SelectContent>{types.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={form.staffId} onValueChange={(v) => setForm({ ...form, staffId: v })}>
            <SelectTrigger><SelectValue placeholder="Staff member" /></SelectTrigger>
            <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.firstName} {s.lastName} · {s.staffId}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Period (e.g. July 2026)" value={form.periodLabel} onChange={(e) => setForm({ ...form, periodLabel: e.target.value })} />
          <Textarea placeholder="Citation (optional)" value={form.citation} onChange={(e) => setForm({ ...form, citation: e.target.value })} rows={2} />
          <Button className="w-full" disabled={!form.awardTypeId || !form.staffId || !form.periodLabel.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Saving…" : "Record award"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function TypesTab({ types, toast }: { types: AwardType[]; toast: ReturnType<typeof useToast>["toast"] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ code: "", name: "", cadence: "monthly", description: "" });
  const create = useMutation({
    mutationFn: () => api.post("/api/recognition/awards/types", { code: form.code, name: form.name, cadence: form.cadence, description: form.description || undefined }),
    onSuccess: () => { toast({ title: "Award type added" }); setForm({ code: "", name: "", cadence: "monthly", description: "" }); qc.invalidateQueries({ queryKey: ["award-types"] }); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Award types</CardTitle></CardHeader>
        <CardContent>
          {types.length === 0 ? <p className="text-sm text-muted-foreground">No award types yet.</p> : (
            <div className="divide-y">
              {types.map((t) => (
                <div key={t.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{t.name} <span className="text-muted-foreground font-normal">({t.code})</span></span>
                    <Badge variant="outline" className="text-[10px] capitalize">{t.cadence}</Badge>
                  </div>
                  {t.description && <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Add award type</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Code (e.g. EOM)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <Input placeholder="Name (e.g. Employee of the Month)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <Select value={form.cadence} onValueChange={(v) => setForm({ ...form, cadence: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          <Textarea placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          <Button className="w-full" disabled={!form.code || !form.name || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Adding…" : "Add award type"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
