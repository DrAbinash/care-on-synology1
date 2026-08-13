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
import { ShieldCheck, ShieldAlert, Fingerprint, FileCheck2, Link2, Activity, Inbox } from "lucide-react";

type ConsentRequest = { id: number; requestId: string; patientId: number | null; abhaAddress: string | null; purposeCode: string; hiTypes: string | null; status: string; consentId: string | null; createdAt: string };
type EnrolSession = { id: number; txnId: string; patientId: number | null; method: string; identifierLast4: string | null; status: string; step: string; lastError: string | null; createdAt: string };
type AbdmStatus = { enabled: boolean; configured: boolean };
type AbhaLink = { id: number; patientId: number; abhaNumber: string | null; abhaAddress: string | null; name: string | null; status: string; linkedAt: string };
type InboundConsent = { id: number; consentId: string; status: string; abhaAddress: string | null; purposeText: string | null; hiTypes: string | null; grantedAt: string | null; expiry: string | null; createdAt: string };

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
      <PageHeader title="ABDM / ABHA" subtitle="ABHA enrolment, patient links, inbound consents & HIU requests" />
      <Tabs defaultValue="consent">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="consent">Consent Requests</TabsTrigger>
          <TabsTrigger value="enrol">ABHA Enrolment</TabsTrigger>
          <TabsTrigger value="status">Gateway Status</TabsTrigger>
          <TabsTrigger value="links">Patient ABHA Links</TabsTrigger>
          <TabsTrigger value="inbound">Inbound Consents</TabsTrigger>
        </TabsList>
        <TabsContent value="consent" className="mt-4"><ConsentTab requests={q.data ?? []} loading={q.isLoading} /></TabsContent>
        <TabsContent value="enrol" className="mt-4"><EnrolTab /></TabsContent>
        <TabsContent value="status" className="mt-4"><StatusTab /></TabsContent>
        <TabsContent value="links" className="mt-4"><PatientAbhaTab /></TabsContent>
        <TabsContent value="inbound" className="mt-4"><InboundConsentsTab /></TabsContent>
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
        <CardHeader className="pb-2"><CardTitle className="text-base">Consent requests (HIU-initiated)</CardTitle></CardHeader>
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
  const [verifyTxnId, setVerifyTxnId] = useState<string | null>(null);
  const [verifyOtp, setVerifyOtp] = useState("");

  const { data: sessions = [], isLoading } = useQuery({ queryKey: ["abha-enrol"], queryFn: () => api.get<EnrolSession[]>("/api/abha/enrolment") });
  const otpMut = useMutation({
    mutationFn: () => api.post("/api/abha/enrolment/otp", { method: f.method, identifier: f.identifier }),
    onSuccess: () => { toast({ title: "OTP requested" }); setF({ ...f, identifier: "" }); qc.invalidateQueries({ queryKey: ["abha-enrol"] }); },
    onError: (e) => { const m = (e as Error).message; toast({ title: m.includes("not configured") ? "Gateway not configured" : "Failed", description: m, variant: "destructive" }); },
  });
  const verifyMut = useMutation({
    mutationFn: () => api.post(`/api/abha/enrolment/${verifyTxnId}/verify`, { otp: verifyOtp }),
    onSuccess: () => {
      toast({ title: "OTP verified" });
      setVerifyTxnId(null);
      setVerifyOtp("");
      qc.invalidateQueries({ queryKey: ["abha-enrol"] });
    },
    onError: (e) => toast({ title: "Verify failed", description: (e as Error).message, variant: "destructive" }),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Enrolment sessions</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div> :
            sessions.length === 0 ? <p className="text-sm text-muted-foreground py-8 text-center">No enrolment sessions yet.</p> :
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Method</TableHead><TableHead>ID ••••</TableHead><TableHead>Status</TableHead><TableHead>When</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs">{s.method}</TableCell>
                    <TableCell className="text-xs">••••{s.identifierLast4}</TableCell>
                    <TableCell><Badge variant="outline">{s.status}</Badge></TableCell>
                    <TableCell className="text-xs">{new Date(s.createdAt).toLocaleString()}</TableCell>
                    <TableCell>
                      {s.status === "otp_sent" && (
                        <Button size="sm" variant="ghost" onClick={() => setVerifyTxnId(s.txnId)}>Verify OTP</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Fingerprint className="h-4 w-4" />
            {verifyTxnId ? "Verify enrolment OTP" : "Start enrolment"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {verifyTxnId ? (
            <>
              <p className="text-xs text-muted-foreground">Session {verifyTxnId.slice(0, 8)}…</p>
              <div><Label className="text-xs">OTP</Label><Input value={verifyOtp} onChange={(e) => setVerifyOtp(e.target.value)} placeholder="6-digit OTP" /></div>
              <Button className="w-full" disabled={verifyOtp.length < 4 || verifyMut.isPending} onClick={() => verifyMut.mutate()}>Submit OTP</Button>
              <Button variant="ghost" size="sm" onClick={() => { setVerifyTxnId(null); setVerifyOtp(""); }}>Back</Button>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <Button size="sm" variant={f.method === "mobile-otp" ? "default" : "outline"} onClick={() => setF({ ...f, method: "mobile-otp" })}>Mobile</Button>
                <Button size="sm" variant={f.method === "aadhaar-otp" ? "default" : "outline"} onClick={() => setF({ ...f, method: "aadhaar-otp" })}>Aadhaar</Button>
              </div>
              <div><Label className="text-xs">{f.method === "aadhaar-otp" ? "Aadhaar number" : "Mobile number"}</Label><Input value={f.identifier} onChange={(e) => setF({ ...f, identifier: e.target.value })} placeholder={f.method === "aadhaar-otp" ? "XXXX XXXX XXXX" : "10-digit mobile"} /></div>
              <Button className="w-full" disabled={f.identifier.length < 4 || otpMut.isPending} onClick={() => otpMut.mutate()}>Request OTP</Button>
              <p className="text-xs text-muted-foreground">Live enrolment requires ABDM_ENABLED + gateway credentials.</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusTab() {
  const q = useQuery({
    queryKey: ["abdm-status"],
    queryFn: () => api.get<AbdmStatus>("/api/abdm/status"),
    retry: false,
  });

  if (q.error) {
    const msg = (q.error as Error).message || "";
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium">ABDM management API unavailable</p>
          <p className="text-xs mt-1">{msg.includes("503") ? "Set ABDM_ENABLED=true on the server to use patient ABHA linking and inbound consent views." : msg}</p>
        </CardContent>
      </Card>
    );
  }

  const s = q.data;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Gateway status</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? <Skeleton className="h-16 w-full" /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">ABDM_ENABLED</p>
              <Badge variant="outline" className={s?.enabled ? "text-green-700" : ""}>{s?.enabled ? "On" : "Off"}</Badge>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Gateway credentials</p>
              <Badge variant="outline" className={s?.configured ? "text-green-700" : ""}>{s?.configured ? "Configured" : "Not configured"}</Badge>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          ff_abdm_abha controls ERP UI access. Live gateway traffic additionally needs ABDM_ENABLED and HIP credentials.
        </p>
      </CardContent>
    </Card>
  );
}

function PatientAbhaTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState("");
  const [linkForm, setLinkForm] = useState({ abhaNumber: "", abhaAddress: "", name: "" });
  const pid = Number(patientId);

  const linksQ = useQuery({
    queryKey: ["abdm-abha-links", pid],
    queryFn: () => api.get<AbhaLink[]>(`/api/abdm/abha/by-patient/${pid}`),
    enabled: Number.isInteger(pid) && pid > 0,
    retry: false,
  });

  const linkMut = useMutation({
    mutationFn: () => api.post("/api/abdm/abha/link", {
      patientId: pid,
      abhaNumber: linkForm.abhaNumber || undefined,
      abhaAddress: linkForm.abhaAddress || undefined,
      name: linkForm.name || undefined,
      linkedVia: "demographic",
    }),
    onSuccess: () => {
      toast({ title: "ABHA linked" });
      setLinkForm({ abhaNumber: "", abhaAddress: "", name: "" });
      qc.invalidateQueries({ queryKey: ["abdm-abha-links", pid] });
    },
    onError: (e) => toast({ title: "Link failed", description: (e as Error).message, variant: "destructive" }),
  });

  const unlinkMut = useMutation({
    mutationFn: (id: number) => api.post(`/api/abdm/abha/${id}/unlink`),
    onSuccess: () => {
      toast({ title: "ABHA unlinked" });
      qc.invalidateQueries({ queryKey: ["abdm-abha-links", pid] });
    },
    onError: (e) => toast({ title: "Unlink failed", description: (e as Error).message, variant: "destructive" }),
  });

  if (linksQ.error) {
    const msg = (linksQ.error as Error).message || "";
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          <Link2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium">Patient ABHA linking unavailable</p>
          <p className="text-xs mt-1">{msg.includes("503") ? "Requires ABDM_ENABLED=true on the API server." : msg}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Linked ABHA identities</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs">Patient ID (internal)</Label>
              <Input value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="e.g. 42" />
            </div>
          </div>
          {pid > 0 && linksQ.isLoading ? <Skeleton className="h-20 w-full" /> :
            (linksQ.data?.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">No ABHA links for this patient.</p> :
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>ABHA #</TableHead><TableHead>Address</TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {linksQ.data?.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">{l.abhaNumber || "—"}</TableCell>
                    <TableCell className="text-xs">{l.abhaAddress || "—"}</TableCell>
                    <TableCell className="text-xs">{l.name || "—"}</TableCell>
                    <TableCell><Badge variant="outline">{l.status}</Badge></TableCell>
                    <TableCell>
                      {l.status === "linked" && (
                        <Button size="sm" variant="ghost" onClick={() => unlinkMut.mutate(l.id)}>Unlink</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Link2 className="h-4 w-4" /> Link ABHA</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label className="text-xs">ABHA number (14 digits)</Label><Input value={linkForm.abhaNumber} onChange={(e) => setLinkForm({ ...linkForm, abhaNumber: e.target.value })} /></div>
          <div><Label className="text-xs">ABHA address</Label><Input value={linkForm.abhaAddress} onChange={(e) => setLinkForm({ ...linkForm, abhaAddress: e.target.value })} placeholder="name@sbx" /></div>
          <div><Label className="text-xs">Display name</Label><Input value={linkForm.name} onChange={(e) => setLinkForm({ ...linkForm, name: e.target.value })} /></div>
          <Button
            className="w-full"
            disabled={!pid || pid <= 0 || (!linkForm.abhaNumber && !linkForm.abhaAddress) || linkMut.isPending}
            onClick={() => linkMut.mutate()}
          >
            Link to patient
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function InboundConsentsTab() {
  const q = useQuery({
    queryKey: ["abdm-inbound-consents"],
    queryFn: () => api.get<InboundConsent[]>("/api/abdm/consents"),
    retry: false,
  });

  if (q.error) {
    const msg = (q.error as Error).message || "";
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium">Inbound consents unavailable</p>
          <p className="text-xs mt-1">{msg.includes("503") ? "Requires ABDM_ENABLED=true. Artefacts arrive via gateway callbacks." : msg}</p>
        </CardContent>
      </Card>
    );
  }

  const rows = q.data ?? [];
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Inbox className="h-4 w-4" /> Gateway consent artefacts (HIP)</CardTitle></CardHeader>
      <CardContent className="p-0">
        {q.isLoading ? <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div> :
          rows.length === 0 ? <p className="text-sm text-muted-foreground py-8 text-center">No inbound consent artefacts yet.</p> :
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Consent ID</TableHead><TableHead>ABHA</TableHead><TableHead>Status</TableHead><TableHead>HI Types</TableHead><TableHead>Received</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs max-w-[140px] truncate">{r.consentId}</TableCell>
                  <TableCell className="text-xs">{r.abhaAddress || "—"}</TableCell>
                  <TableCell><Badge variant="outline" className={CONSENT_CLS[r.status] ?? ""}>{r.status}</Badge></TableCell>
                  <TableCell className="text-xs">{r.hiTypes || "—"}</TableCell>
                  <TableCell className="text-xs">{new Date(r.createdAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table></div>}
      </CardContent>
    </Card>
  );
}
