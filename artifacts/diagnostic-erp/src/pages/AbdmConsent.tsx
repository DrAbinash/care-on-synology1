import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, ShieldAlert, Fingerprint, FileCheck2 } from "lucide-react";

type ConsentRequest = { id: number; requestId: string; patientId: number | null; abhaAddress: string | null; purposeCode: string; hiTypes: string | null; status: string; consentId: string | null; createdAt: string };
type EnrolSession = { id: number; txnId: string; patientId: number | null; method: string; identifierLast4: string | null; status: string; step: string; lastError: string | null; createdAt: string };

const CONSENT_CLS: Record<string, string> = {
  REQUESTED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  GRANTED: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  DENIED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  REVOKED: "bg-muted text-muted-foreground",
  EXPIRED: "bg-muted text-muted-foreground",
};

export default function AbdmConsent() {
  const q = useQuery({ queryKey: ["abha-consents"], queryFn: () => api.get<ConsentRequest[]>("/api/abha/consent-requests"), retry: false });
  if (q.error) {
    const msg = (q.error as Error).message || "";
    const shadow = msg.includes("disabled") || msg.includes("503");
    return (
      <div className="space-y-4">
        <PageHeader title="ABDM / ABHA" subtitle="National health-ID & consent" />
        <Card className="min-h-[280px] flex items-center justify-center">
          <div className="text-center text-muted-foreground max-w-sm px-6">
            <ShieldAlert className="h-9 w-9 mx-auto mb-2 opacity-60" />
            <p className="text-sm font-medium mb-1">{shadow ? "ABDM/ABHA is in Shadow Mode" : "Could not load"}</p>
            <p className="text-xs">{shadow ? "Enable the ff_abdm_abha feature flag to manage ABHA enrolment & consent. Live gateway calls additionally require ABDM_ENABLED + credentials." : msg}</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="ABDM / ABHA" subtitle="ABHA enrolment + HIU consent request lifecycle" />
      <Tabs defaultValue="consent">
        <TabsList>
          <TabsTrigger value="consent">Consent Requests</TabsTrigger>
          <TabsTrigger value="enrol">ABHA Enrolment</TabsTrigger>
        </TabsList>
        <TabsContent value="consent" className="mt-4"><ConsentTab requests={q.data ?? []} loading={q.isLoading} /></TabsContent>
        <TabsContent value="enrol" className="mt-4"><EnrolTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function ConsentTab({ requests, loading }: { requests: ConsentRequest[]; loading: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ abhaAddress: "", hiTypes: "DiagnosticReport", purposeText: "Care management" });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["abha-consents"] });

  const createMut = useMutation({
    mutationFn: () => {
      const now = new Date();
      const to = new Date(now.getTime() + 180 * 864e5);
      const exp = new Date(now.getTime() + 365 * 864e5);
      return api.post("/api/abha/consent-requests", {
        abhaAddress: f.abhaAddress, hiTypes: f.hiTypes.split(",").map((s) => s.trim()).filter(Boolean),
        purposeText: f.purposeText, dateFrom: now.toISOString(), dateTo: to.toISOString(), expiry: exp.toISOString(),
      });
    },
    onSuccess: () => { toast({ title: "Consent request created" }); setF({ ...f, abhaAddress: "" }); invalidate(); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  const transMut = useMutation({
    mutationFn: ({ id, to }: { id: number; to: string }) => api.post(`/api/abha/consent-requests/${id}/transition`, { to }),
    onSuccess: () => { toast({ title: "Updated" }); invalidate(); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Consent requests</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div> :
            requests.length === 0 ? <p className="text-sm text-muted-foreground py-8 text-center">No consent requests yet.</p> :
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>ABHA</TableHead><TableHead>HI Types</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[160px] truncate">{r.abhaAddress || "—"}</TableCell>
                    <TableCell className="text-xs">{r.hiTypes}</TableCell>
                    <TableCell><Badge variant="outline" className={CONSENT_CLS[r.status] ?? ""}>{r.status}</Badge></TableCell>
                    <TableCell>
                      {r.status === "REQUESTED" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => transMut.mutate({ id: r.id, to: "GRANTED" })}>Grant</Button>
                          <Button size="sm" variant="ghost" onClick={() => transMut.mutate({ id: r.id, to: "DENIED" })}>Deny</Button>
                        </div>
                      )}
                      {r.status === "GRANTED" && (
                        <Button size="sm" variant="ghost" onClick={() => transMut.mutate({ id: r.id, to: "REVOKED" })}>Revoke</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><FileCheck2 className="h-4 w-4" /> New request</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label className="text-xs">ABHA address</Label><Input value={f.abhaAddress} onChange={(e) => setF({ ...f, abhaAddress: e.target.value })} placeholder="name@sbx" /></div>
          <div><Label className="text-xs">HI types (comma-separated)</Label><Input value={f.hiTypes} onChange={(e) => setF({ ...f, hiTypes: e.target.value })} /></div>
          <div><Label className="text-xs">Purpose</Label><Input value={f.purposeText} onChange={(e) => setF({ ...f, purposeText: e.target.value })} /></div>
          <Button className="w-full" disabled={!f.abhaAddress || createMut.isPending} onClick={() => createMut.mutate()}><ShieldCheck className="h-4 w-4 mr-1.5" /> Request consent</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function EnrolTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState<{ method: "aadhaar-otp" | "mobile-otp"; identifier: string }>({ method: "mobile-otp", identifier: "" });

  const { data: sessions = [], isLoading } = useQuery({ queryKey: ["abha-enrol"], queryFn: () => api.get<EnrolSession[]>("/api/abha/enrolment") });
  const otpMut = useMutation({
    mutationFn: () => api.post("/api/abha/enrolment/otp", { method: f.method, identifier: f.identifier }),
    onSuccess: () => { toast({ title: "OTP requested" }); setF({ ...f, identifier: "" }); qc.invalidateQueries({ queryKey: ["abha-enrol"] }); },
    onError: (e) => { const m = (e as Error).message; toast({ title: m.includes("not configured") ? "Gateway not configured" : "Failed", description: m, variant: "destructive" }); },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Enrolment sessions</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div> :
            sessions.length === 0 ? <p className="text-sm text-muted-foreground py-8 text-center">No enrolment sessions yet.</p> :
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Method</TableHead><TableHead>ID ••••</TableHead><TableHead>Status</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs">{s.method}</TableCell>
                    <TableCell className="text-xs">••••{s.identifierLast4}</TableCell>
                    <TableCell><Badge variant="outline">{s.status}</Badge></TableCell>
                    <TableCell className="text-xs">{new Date(s.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Fingerprint className="h-4 w-4" /> Start enrolment</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant={f.method === "mobile-otp" ? "default" : "outline"} onClick={() => setF({ ...f, method: "mobile-otp" })}>Mobile</Button>
            <Button size="sm" variant={f.method === "aadhaar-otp" ? "default" : "outline"} onClick={() => setF({ ...f, method: "aadhaar-otp" })}>Aadhaar</Button>
          </div>
          <div><Label className="text-xs">{f.method === "aadhaar-otp" ? "Aadhaar number" : "Mobile number"}</Label><Input value={f.identifier} onChange={(e) => setF({ ...f, identifier: e.target.value })} placeholder={f.method === "aadhaar-otp" ? "XXXX XXXX XXXX" : "10-digit mobile"} /></div>
          <Button className="w-full" disabled={f.identifier.length < 4 || otpMut.isPending} onClick={() => otpMut.mutate()}>Request OTP</Button>
          <p className="text-xs text-muted-foreground">Live enrolment requires a configured ABDM gateway (ABDM_ENABLED + credentials).</p>
        </CardContent>
      </Card>
    </div>
  );
}
