// ============================================================================
// HOPE Referrals inbox (CARE ERP). Single fast workflow:
//   open referral → verify patient → verify/map tests → create CARE order → bill
// Reads/writes only the additive integration APIs (/api/hope-referrals). Order
// creation goes through the canonical path server-side; billing is handed off to
// the existing (unmodified) billing desk. This page never creates a bill.
// ============================================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Inbox, AlertTriangle, Clock, UserCheck, FlaskConical, Search, RefreshCw,
  CheckCircle2, XCircle, Link2, ArrowRight, ShieldAlert, Stethoscope,
} from "lucide-react";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface ReferralListItem {
  id: number; referralUuid: string; patientName: string; patientPhone: string | null;
  sourcePatientId: string; patientAge: number | null; patientGender: string | null;
  referringDoctorName: string | null; department: string | null; priority: string;
  status: string; matchStatus: string; mappingStatus: string; testCount: number; receivedAt: string;
}
interface ReferralItem {
  id: number; lineNo: number; sourceTestCode: string | null; sourceTestName: string;
  careTestId: number | null; carePackageId: number | null; careDisplayName: string | null;
  department: string | null; modality: string | null; itemStatus: string; resolvedTestIds: number[]; careModality: string;
}
interface MatchCandidate { carePatientId: number; patientCode: string; name: string; phone: string; gender: string | null; score: number; reasons: string[]; }
interface ReferralDetail {
  referral: {
    id: number; referralUuid: string; status: string; matchStatus: string; mappingStatus: string;
    patientName: string; patientFirstName: string | null; patientLastName: string | null;
    patientAge: number | null; patientAgeUnit: string | null; patientDob: string | null;
    patientGender: string | null; patientPhone: string | null; patientAddress: string | null; patientEmail: string | null;
    sourcePatientId: string; sourceEncounterId: string | null; referringDoctorName: string | null;
    referringDoctorSpecialization: string | null; department: string | null; clinicalHistory: string | null;
    provisionalDiagnosis: string | null; priority: string; careOrderId: number | null; carePatientId: number | null;
  };
  items: ReferralItem[];
  events: Array<{ id: number; eventType: string; actorName: string | null; organisation: string | null; reason: string | null; createdAt: string }>;
  patientMatch: { outcome: string; confidence: number; method: string; candidates: MatchCandidate[]; conflictReason?: string } | null;
  carePatient: { id: number; patientId: string; name: string; phone: string } | null;
}

const FILTERS: Array<{ key: string; label: string; icon: typeof Inbox }> = [
  { key: "new", label: "New", icon: Inbox },
  { key: "urgent", label: "Urgent", icon: AlertTriangle },
  { key: "today", label: "Today", icon: Clock },
  { key: "awaiting_patient", label: "Awaiting patient", icon: UserCheck },
  { key: "patient_accepted", label: "Patient accepted", icon: CheckCircle2 },
  { key: "unmapped", label: "Unmapped tests", icon: FlaskConical },
  { key: "identity_conflict", label: "Identity conflict", icon: ShieldAlert },
  { key: "awaiting_billing", label: "Awaiting billing", icon: ArrowRight },
  { key: "partially_fulfilled", label: "Partial", icon: RefreshCw },
  { key: "cancelled", label: "Cancelled", icon: XCircle },
  { key: "sync_errors", label: "Sync errors", icon: AlertTriangle },
];

const statusColor = (s: string): string => {
  if (["CANCELLED", "EXPIRED"].includes(s)) return "bg-gray-200 text-gray-700";
  if (["REPORTED", "DELIVERED", "COMPLETED"].includes(s)) return "bg-green-100 text-green-800";
  if (["CARE_ORDER_CREATED", "BILLED", "PAID", "PARTIALLY_BOOKED"].includes(s)) return "bg-blue-100 text-blue-800";
  if (s === "RECEIVED_BY_CARE") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
};

export default function HopeReferrals() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState("new");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const stats = useQuery<Record<string, number>>({ queryKey: ["hope-ref-stats"], queryFn: () => api.get("/api/hope-referrals/stats") });
  const list = useQuery<{ referrals: ReferralListItem[] }>({
    queryKey: ["hope-ref-list", filter, search],
    queryFn: () => api.get(`/api/hope-referrals?filter=${encodeURIComponent(filter)}&search=${encodeURIComponent(search)}`),
  });
  const detail = useQuery<ReferralDetail>({
    queryKey: ["hope-ref-detail", selectedId],
    queryFn: () => api.get(`/api/hope-referrals/${selectedId}`),
    enabled: selectedId != null,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["hope-ref-stats"] });
    qc.invalidateQueries({ queryKey: ["hope-ref-list"] });
    if (selectedId != null) qc.invalidateQueries({ queryKey: ["hope-ref-detail", selectedId] });
  };
  const ok = (msg: string) => { setBanner({ kind: "ok", msg }); refresh(); };
  const err = (e: unknown) => setBanner({ kind: "err", msg: (e as Error)?.message ?? "Action failed" });

  const confirmPatient = useMutation({
    mutationFn: (vars: { action: string; carePatientId?: number }) => api.post(`/api/hope-referrals/${selectedId}/confirm-patient`, vars),
    onSuccess: () => ok("Patient identity confirmed."), onError: err,
  });
  const createAndConfirm = useMutation({
    mutationFn: async () => {
      const r = detail.data!.referral;
      const created = await api.post<{ id: number; patientId: string }>("/api/patients", {
        firstName: r.patientFirstName || r.patientName || "Unknown",
        lastName: r.patientLastName || "",
        dateOfBirth: r.patientDob || "1900-01-01",
        gender: r.patientGender || "Other",
        phone: r.patientPhone || "",
        email: r.patientEmail || undefined,
        address: r.patientAddress || undefined,
        ageValue: r.patientAge ?? undefined,
        ageUnit: r.patientAgeUnit ?? undefined,
      });
      return api.post(`/api/hope-referrals/${selectedId}/confirm-patient`, { action: "create_new", carePatientId: created.id });
    },
    onSuccess: () => ok("New CARE patient created and linked."), onError: err,
  });
  const accept = useMutation({
    mutationFn: (itemIds?: number[]) => api.post<{ orderId: number; orderNumber: string; billing: { orderId: number } }>(`/api/hope-referrals/${selectedId}/accept`, itemIds ? { itemIds } : {}),
    onSuccess: (r) => { ok(`CARE order ${r.orderNumber} created. Opening billing…`); setTimeout(() => navigate(`/billing?orderId=${r.billing.orderId}`), 900); },
    onError: err,
  });
  const contact = useMutation({ mutationFn: () => api.post(`/api/hope-referrals/${selectedId}/contact-patient`, {}), onSuccess: () => ok("Marked patient contacted."), onError: err });
  const cancel = useMutation({ mutationFn: () => api.post(`/api/hope-referrals/${selectedId}/cancel`, { reason: "cancelled_by_care" }), onSuccess: () => ok("Referral cancelled."), onError: err });
  const decline = useMutation({ mutationFn: () => api.post(`/api/hope-referrals/${selectedId}/decline`, { reason: "declined_by_patient" }), onSuccess: () => ok("Marked declined."), onError: err });

  const d = detail.data;
  const unmappedCount = d?.items.filter((i) => i.itemStatus === "unmapped").length ?? 0;
  const acceptableCount = d?.items.filter((i) => (i.careTestId || i.carePackageId) && !["accepted", "billed", "declined", "cancelled"].includes(i.itemStatus)).length ?? 0;

  return (
    <div className="p-4 h-full flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Inbox className="h-6 w-6 text-blue-600" />
        <h1 className="text-xl font-semibold">HOPE Referrals</h1>
        <span className="text-sm text-muted-foreground">Diagnostic referrals from HOPE Hospital — verify, accept, and create the CARE order.</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={refresh}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = stats.data?.[f.key] ?? 0;
          const active = filter === f.key;
          return (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${active ? "bg-blue-600 text-white border-blue-600" : "bg-white hover:bg-slate-50 border-slate-200"}`}>
              <f.icon className="h-3.5 w-3.5" />{f.label}
              {n > 0 && <span className={`ml-1 rounded-full px-1.5 text-xs ${active ? "bg-white/25" : "bg-slate-100"}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      {banner && (
        <div className={`rounded-md px-3 py-2 text-sm ${banner.kind === "ok" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
          {banner.msg}
          <button className="float-right opacity-60 hover:opacity-100" onClick={() => setBanner(null)}>✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 flex-1 min-h-0">
        {/* List */}
        <div className="flex flex-col gap-2 min-h-0">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search name / mobile / HOPE ID" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="overflow-y-auto flex flex-col gap-2 pr-1">
            {list.isLoading && <div className="text-sm text-muted-foreground p-4">Loading…</div>}
            {list.data?.referrals.length === 0 && <div className="text-sm text-muted-foreground p-4">No referrals in this view.</div>}
            {list.data?.referrals.map((r) => (
              <button key={r.id} onClick={() => setSelectedId(r.id)}
                className={`text-left rounded-lg border p-3 hover:shadow-sm ${selectedId === r.id ? "border-blue-400 ring-1 ring-blue-200" : "border-slate-200"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{r.patientName}</span>
                  {["urgent", "emergency"].includes(r.priority) && <Badge variant="destructive" className="text-[10px]">{r.priority}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {r.patientAge ?? "?"}{r.patientGender ? `/${r.patientGender}` : ""} · {r.patientPhone ?? "no phone"} · HOPE {r.sourcePatientId}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Dr {r.referringDoctorName ?? "—"} · {r.testCount} test(s)</div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className={`text-[10px] rounded px-1.5 py-0.5 ${statusColor(r.status)}`}>{r.status}</span>
                  {r.matchStatus === "conflict" && <span className="text-[10px] rounded px-1.5 py-0.5 bg-red-100 text-red-800">identity conflict</span>}
                  {["unmapped", "partial"].includes(r.mappingStatus) && <span className="text-[10px] rounded px-1.5 py-0.5 bg-orange-100 text-orange-800">{r.mappingStatus} tests</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="rounded-lg border border-slate-200 overflow-y-auto p-4 min-h-0">
          {!selectedId && <div className="text-sm text-muted-foreground">Select a referral to review.</div>}
          {selectedId && detail.isLoading && <div className="text-sm text-muted-foreground">Loading referral…</div>}
          {d && (
            <div className="flex flex-col gap-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{d.referral.patientName}</div>
                  <div className="text-sm text-muted-foreground">{d.referral.patientAge ?? "?"}{d.referral.patientGender ? `/${d.referral.patientGender}` : ""} · {d.referral.patientPhone ?? "no phone"} · HOPE ID {d.referral.sourcePatientId}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Encounter {d.referral.sourceEncounterId ?? "—"} · Dr {d.referral.referringDoctorName ?? "—"} {d.referral.referringDoctorSpecialization ? `(${d.referral.referringDoctorSpecialization})` : ""}</div>
                </div>
                <span className={`text-xs rounded px-2 py-1 ${statusColor(d.referral.status)}`}>{d.referral.status}</span>
              </div>

              {(d.referral.clinicalHistory || d.referral.provisionalDiagnosis) && (
                <div className="rounded-md bg-slate-50 p-3 text-sm">
                  {d.referral.clinicalHistory && <div><span className="font-medium">Clinical history:</span> {d.referral.clinicalHistory}</div>}
                  {d.referral.provisionalDiagnosis && <div><span className="font-medium">Provisional Dx:</span> {d.referral.provisionalDiagnosis}</div>}
                </div>
              )}

              {/* Step 1 — patient identity */}
              <section>
                <div className="flex items-center gap-2 mb-2"><UserCheck className="h-4 w-4 text-blue-600" /><h3 className="font-medium">1 · Verify patient</h3></div>
                {d.carePatient ? (
                  <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    Linked to CARE patient <b>{d.carePatient.name}</b> ({d.carePatient.patientId}) · {d.carePatient.phone}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {d.patientMatch?.outcome === "conflict" && (
                      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2">
                        <ShieldAlert className="h-4 w-4 mt-0.5" /><div>{d.patientMatch.conflictReason ?? "Identity conflict — manual review required."}</div>
                      </div>
                    )}
                    {(d.patientMatch?.candidates ?? []).length > 0 && (
                      <div className="text-sm">
                        <div className="text-muted-foreground mb-1">Possible existing CARE patients:</div>
                        {d.patientMatch!.candidates.map((c) => (
                          <div key={c.carePatientId} className="flex items-center justify-between rounded-md border p-2 mb-1">
                            <div>
                              <div className="font-medium">{c.name} <span className="text-xs text-muted-foreground">({c.patientCode})</span></div>
                              <div className="text-xs text-muted-foreground">{c.phone} · match {c.score}% · {c.reasons.join(", ")}</div>
                            </div>
                            <Button size="sm" variant="outline" onClick={() => confirmPatient.mutate({ action: "confirm_existing", carePatientId: c.carePatientId })}>
                              <Link2 className="h-4 w-4 mr-1" />Confirm this
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => createAndConfirm.mutate()} disabled={createAndConfirm.isPending}>
                        Create new CARE patient
                      </Button>
                      {d.patientMatch?.outcome === "conflict" && (
                        <Button size="sm" variant="outline" onClick={() => confirmPatient.mutate({ action: "block" })}>Keep blocked for review</Button>
                      )}
                    </div>
                  </div>
                )}
              </section>

              {/* Step 2 — tests */}
              <section>
                <div className="flex items-center gap-2 mb-2"><FlaskConical className="h-4 w-4 text-blue-600" /><h3 className="font-medium">2 · Verify tests</h3>
                  {unmappedCount > 0 && <Badge variant="outline" className="text-orange-700 border-orange-300">{unmappedCount} unmapped</Badge>}
                </div>
                <div className="flex flex-col gap-1.5">
                  {d.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                      <div>
                        <div className="font-medium">{it.sourceTestName} {it.sourceTestCode ? <span className="text-xs text-muted-foreground">[{it.sourceTestCode}]</span> : null}</div>
                        <div className="text-xs text-muted-foreground">
                          {it.careTestId || it.carePackageId
                            ? <>→ CARE: {it.careDisplayName ?? "mapped"} · <span className="capitalize">{it.careModality}</span></>
                            : <span className="text-orange-700">unmapped — map to a CARE test in the mapping admin</span>}
                        </div>
                      </div>
                      <span className={`text-[10px] rounded px-1.5 py-0.5 ${it.itemStatus === "unmapped" ? "bg-orange-100 text-orange-800" : statusColor(it.itemStatus.toUpperCase())}`}>{it.itemStatus}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Step 3 — actions */}
              <section className="flex flex-wrap gap-2 pt-1 border-t">
                <Button variant="outline" size="sm" onClick={() => contact.mutate()}>Contact patient</Button>
                <Button size="sm" disabled={!d.referral.carePatientId || acceptableCount === 0 || accept.isPending}
                  onClick={() => accept.mutate(undefined)}>
                  <Stethoscope className="h-4 w-4 mr-1" />Accept all & create CARE order
                </Button>
                <Button variant="outline" size="sm" onClick={() => decline.mutate()}>Patient declined</Button>
                <Button variant="ghost" size="sm" className="text-red-600" onClick={() => cancel.mutate()}>Cancel referral</Button>
                {!d.referral.carePatientId && <span className="text-xs text-muted-foreground self-center">Verify the patient before creating an order.</span>}
              </section>

              {/* Timeline */}
              <section>
                <h3 className="font-medium text-sm text-muted-foreground mb-1">Audit trail</h3>
                <div className="flex flex-col gap-1">
                  {d.events.slice(0, 12).map((e) => (
                    <div key={e.id} className="text-xs text-muted-foreground flex gap-2">
                      <span className="tabular-nums">{new Date(e.createdAt).toLocaleString()}</span>
                      <span className="font-medium text-slate-700">{e.eventType}</span>
                      <span>{e.organisation}{e.actorName ? ` · ${e.actorName}` : ""}{e.reason ? ` · ${e.reason}` : ""}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
