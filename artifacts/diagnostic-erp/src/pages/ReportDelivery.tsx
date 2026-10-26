import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, isHttpError } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ScanLine, AlertTriangle, CheckCircle2, RefreshCcw,
  PackageOpen, Send, FileText, Play, Square, Eye, User, Receipt
} from "lucide-react";
import { Link, useLocation } from "wouter";

type ResolveResult = {
  type: "sample" | "order" | "bill" | "report" | "patient";
  code: string;
  patient: { id: number; firstName: string; lastName: string; patientId: string; gender: string; dateOfBirth: string; ageValue?: number | null; ageUnit?: string | null; phone?: string; bloodGroup?: string | null } | null;
  order?: { id: number; orderNumber: string; patientId: number; doctorId: number | null; doctor: { name: string; specialization?: string | null } | null; createdAt: string } | null;
  tests?: Array<{ id: number; name: string; code: string; price: number; orderTestId: number }>;
  sample?: { id: number; barcode: string; status: string; sampleType: string };
  report?: { id: number; reportNumber: string; title: string; status: string; deliveredAt: string | null; type: string };
};

/**
 * Exactly what `/api/resolve-barcode/patient/:id/reports` sends. `body` and
 * `impression` used to be here and were rendered — a delivery clerk saw the
 * impression sentence on every card. The counter identifies a report; it is not
 * a place to read one, so the endpoint no longer selects them and this type no
 * longer pretends they arrive.
 */
type PatientReport = {
  id: number;
  reportNumber: string;
  type: string;
  testId: number;
  orderTestId: number | null;
  orderId: number | null;
  billId: number | null;
  title: string;
  status: string;
  signedAt: string | null;
  deliveredAt: string | null;
  signedByName: string | null;
  verifiedByName: string | null;
  createdAt: string;
  testName: string | null;
  testCode: string | null;
  isDelivered: boolean;
  deliveredBy: string | null;
  physicalState: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  verified: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  reported: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  delivered: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  draft: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

/**
 * The four custody queues, in the owner's own words: Awaiting Receipt, At
 * Counter, Handed Over, Discrepancies. The API shape is mirrored here rather
 * than imported, the same way `PatientReport` mirrors its endpoint — this page
 * declares what it renders, so a field dropped server-side cannot keep
 * rendering here from a stale assumption.
 */
type CustodyQueueEntry = {
  key: string;
  billNumber: string | null;
  patientName: string;
  patientCode: string;
  examination: string;
  reportNumber: string | null;
  state: "AWAITING_RECEIPT" | "AT_COUNTER" | "HANDED_OVER" | "DISCREPANCY";
  receivedByName: string | null;
  receivedAt: string | null;
  deliveredByName: string | null;
  deliveredAt: string | null;
  recipientName: string | null;
  recipientCategory: string | null;
  overrideReason: string | null;
  issue: string | null;
  issueDetail: string | null;
};

type CustodyQueue = {
  id: string;
  status: "measured" | "not_measured";
  reason: string | null;
  total: number;
  truncated: boolean;
  rows: CustodyQueueEntry[];
};

type CustodyQueuesResponse = {
  generatedAt: string;
  goLive: { configured: boolean; at: string | null };
  handedOverSince: string;
  handedOverDays: number;
  limit: number;
  queues: Record<string, CustodyQueue>;
};

const QUEUE_CARDS = [
  { id: "awaitingReceipt", title: "Awaiting Receipt", icon: PackageOpen, empty: "Nothing waiting to be received." },
  { id: "atCounter", title: "At Counter", icon: Receipt, empty: "No paper is sitting at the counter." },
  { id: "handedOver", title: "Handed Over", icon: Send, empty: "Nothing handed over in this window." },
  { id: "discrepancies", title: "Discrepancies", icon: AlertTriangle, empty: "No custody discrepancy found." },
];

/** Times print in the counter's own clock: the browser renders the instant the
 *  server stored, so an IST desk reads IST without the API guessing a zone. */
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** The categories the counter is allowed to record, in the words a clerk uses.
 *  Kept here rather than imported from the API's own RECIPIENT_LABEL so a page
 *  cannot silently render `FAMILY_MEMBER` at a delivery desk. */
const RECIPIENT_LABELS: Record<string, string> = {
  PATIENT: "the patient",
  FAMILY_MEMBER: "a family member",
  CARRYING_AGENT: "a courier",
  DOOR_DROP: "left at reception",
};

function recipientLabel(e: CustodyQueueEntry): string {
  if (!e.recipientCategory) return "";
  const who = RECIPIENT_LABELS[e.recipientCategory] ?? e.recipientCategory.toLowerCase();
  // A door drop is not a person, so the name a clerk typed for it would be a
  // claim about somebody who was never there.
  if (e.recipientCategory === "DOOR_DROP") return ` — ${who}`;
  return ` to ${who}${e.recipientName ? ` (${e.recipientName})` : ""}`;
}

function QueueRow({ e }: { e: CustodyQueueEntry }) {
  return (
    <div className="border rounded-lg p-2.5 space-y-0.5 bg-background">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium truncate">
          {e.patientName}
          {/* Two clerks with the same surname are indistinguishable otherwise, and
              the wrong patient is the one error a delivery desk cannot take back. */}
          {e.patientCode && (
            <span className="ml-1.5 text-[10px] font-mono font-normal text-muted-foreground">{e.patientCode}</span>
          )}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground shrink-0">
          {e.billNumber ?? "No bill linked"}
        </span>
      </div>
      <p className="text-xs truncate">
        {e.examination}
        <span className="text-muted-foreground"> · {e.reportNumber ?? "Word report"}</span>
      </p>
      {e.receivedByName && (
        <p className="text-xs text-muted-foreground">
          Received by <span className="font-medium text-foreground">{e.receivedByName}</span> · {fmtTime(e.receivedAt)}
        </p>
      )}
      {e.deliveredByName && (
        <p className="text-xs text-muted-foreground">
          Handed over by <span className="font-medium text-foreground">{e.deliveredByName}</span> · {fmtTime(e.deliveredAt)}
          {recipientLabel(e)}
        </p>
      )}
      {/* An override is not decoration: it is the one case where paper moved
          despite a check failing, and a dispute starts here. */}
      {e.overrideReason && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Overridden: {e.overrideReason}</p>
      )}
      {e.issueDetail && (
        <p className="text-xs text-amber-800 dark:text-amber-300">{e.issueDetail}</p>
      )}
    </div>
  );
}

function QueueCard({ q, title, icon: Icon, empty }: { q: CustodyQueue; title: string; icon: typeof PackageOpen; empty: string }) {
  const count = q.rows.length;
  return (
    <div className="bg-card border rounded-xl p-4 flex flex-col gap-2 min-h-[180px]">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <Icon size={15} className="text-muted-foreground" /> {title}
        </h4>
        {q.status === "not_measured" ? (
          <Badge variant="outline" className="text-[10px]">Not measured</Badge>
        ) : (
          <Badge className={`text-[10px] ${count > 0 ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}>
            {q.total}
          </Badge>
        )}
      </div>

      {q.status === "not_measured" && (
        <p className="text-xs text-muted-foreground leading-relaxed">{q.reason}</p>
      )}
      {q.status === "measured" && count === 0 && (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
      {q.status === "measured" && count > 0 && (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-0.5">
          {q.rows.map((e) => <QueueRow key={e.key} e={e} />)}
        </div>
      )}

      {/* The caveat rides with the numbers, including when the queue is empty:
          "nothing waiting" is only true of the paper CARE can see. */}
      {q.status === "measured" && q.reason && (
        <p className="text-[10px] text-muted-foreground leading-relaxed mt-auto">{q.reason}</p>
      )}
      {q.status === "measured" && q.truncated && (
        <p className="text-[10px] text-muted-foreground">Showing {count} of {q.total}.</p>
      )}
    </div>
  );
}

/**
 * The dashboard half of the existing Report Delivery interface. A read of the
 * custody ledger, nothing more: no charts, no polling, no second page. It sits
 * below the kiosk and is NOT cleared by the kiosk countdown, because the queues
 * describe the whole counter rather than the last patient who walked up.
 *
 * A 403 is explained rather than hidden. The queues are gated on the module's
 * own `view` action and nothing is granted automatically, so the first day of
 * this feature looks like a refusal until an administrator ticks Report
 * Delivery → View — which must read as an instruction, not an error.
 */
function CustodyQueuesSection() {
  const { data, isFetching, error, refetch } = useQuery<CustodyQueuesResponse>({
    queryKey: ["report-custody-queues"],
    queryFn: () => api.get<CustodyQueuesResponse>("/api/report-custody/queues"),
    staleTime: 30_000,
  });

  if (error) {
    const denied = isHttpError(error) && error.status === 403;
    return (
      <div className="bg-card border rounded-xl p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-1">
          <PackageOpen size={15} className="text-muted-foreground" /> Delivery queues
        </h3>
        <p className="text-xs text-muted-foreground">
          {denied
            ? "An administrator has to give your account Report Delivery → View in Settings → Users before these queues open. Receiving and handing over paper are separate ticks and are unaffected."
            : `The delivery queues could not be read: ${error.message}`}
        </p>
        <Button variant="outline" size="sm" className="mt-2 gap-1" onClick={() => refetch()}>
          <RefreshCcw size={13} className={isFetching ? "animate-spin" : ""} /> Retry
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-card border rounded-xl p-4 text-xs text-muted-foreground">
        Loading the delivery queues…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">Delivery queues</h3>
          <p className="text-xs text-muted-foreground">
            Read from the custody ledger · {new Date(data.generatedAt).toLocaleString()}
            {data.goLive.configured
              ? ` · go-live ${fmtTime(data.goLive.at)}`
              : " · go-live date not set, so Awaiting Receipt is not measured"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1">
          <RefreshCcw size={13} className={isFetching ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
        {QUEUE_CARDS.map((card) => {
          const q = data.queues[card.id] ?? {
            id: card.id, status: "not_measured" as const,
            reason: "This queue was not returned by the server.", total: 0, truncated: false, rows: [],
          };
          return <QueueCard key={card.id} q={{ ...q, id: card.id }} title={card.title} icon={card.icon} empty={card.empty} />;
        })}
      </div>
    </div>
  );
}

export default function ReportDelivery() {
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [buffer, setBuffer] = useState("");
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");

  // Kiosk specific states
  const [countdown, setCountdown] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const countdownIntervalRef = useRef<number | null>(null);

  // Fetch clinic settings for auto-clear preferences
  const { data: clinicSettings } = useQuery<any>({
    queryKey: ["clinic-settings-public"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 60_000,
  });

  const autoClearEnabled = clinicSettings?.scanStationAutoClearEnabled !== false;
  const displaySeconds = clinicSettings?.scanStationResultDisplaySeconds ?? 10;

  // Always focus the hidden input
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    window.addEventListener("click", focus);
    window.addEventListener("touchstart", focus);
    return () => {
      window.removeEventListener("click", focus);
      window.removeEventListener("touchstart", focus);
    };
  }, []);

  // Global keydown: prevent Enter from navigating away
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && document.activeElement === inputRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clear current results
  const handleClear = useCallback(() => {
    setResolved(null);
    setError(null);
    setCountdown(null);
    setPaused(false);
    if (countdownIntervalRef.current) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  // Handle countdown triggers
  useEffect(() => {
    if (countdown !== null && countdown > 0 && !paused && autoClearEnabled) {
      countdownIntervalRef.current = window.setTimeout(() => {
        setCountdown((c) => (c !== null ? c - 1 : null));
      }, 1000) as unknown as number;
    } else if (countdown === 0) {
      handleClear();
    }
    return () => {
      if (countdownIntervalRef.current) {
        window.clearTimeout(countdownIntervalRef.current);
      }
    };
  }, [countdown, paused, autoClearEnabled, handleClear]);

  const resolveCode = useCallback(async (code: string) => {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    handleClear();
    try {
      const result = await api.get<ResolveResult>(`/api/resolve-barcode/${encodeURIComponent(code.trim())}`);
      setResolved(result);
      if (autoClearEnabled && result.patient) {
        setCountdown(displaySeconds);
      }
    } catch (err: any) {
      setError(err?.message || "Not found");
    } finally {
      setLoading(false);
      setBuffer("");
      if (inputRef.current) inputRef.current.value = "";
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [autoClearEnabled, displaySeconds, handleClear]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      resolveCode(e.currentTarget.value);
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBuffer(e.target.value);
  };

  const patientId = resolved?.patient?.id ?? null;

  const { data: reportsData } = useQuery<{ patientId: number; reports: PatientReport[] }>({
    queryKey: ["patient-reports-ready", patientId],
    queryFn: () => api.get(`/api/resolve-barcode/patient/${patientId}/reports`),
    enabled: !!patientId,
  });

  const ageDisplay = resolved?.patient
    ? (() => {
        const p = resolved.patient;
        if (p.ageValue != null && p.ageUnit) {
          if (p.ageUnit === "years") return p.ageValue > 0 ? `${p.ageValue} Yrs` : null;
          if (p.ageUnit === "months") return `${p.ageValue} Mo`;
          if (p.ageUnit === "days") return `${p.ageValue} D`;
        }
        const years = new Date().getFullYear() - new Date(p.dateOfBirth).getFullYear();
        return years > 0 ? `${years} Yrs` : null;
      })()
    : null;

  const reports = reportsData?.reports ?? [];

  return (
    <div className="space-y-4 max-w-6xl mx-auto px-4">
      <PageHeader
        title="Report Delivery"
        subtitle={resolved?.patient ? "Kiosk mode active — patient and reports loaded instantly" : "Scan patient, bill, phone, or report ID to view results instantly"}
        actions={<ScanLine size={18} className="text-primary" />}
      />

      {/* Hidden scanner input */}
      <input
        ref={inputRef}
        type="text"
        autoFocus
        autoComplete="off"
        aria-hidden="true"
        className="fixed top-0 left-0 w-1 h-1 opacity-0 pointer-events-none"
        onChange={onInputChange}
        onKeyDown={onInputKeyDown}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Scanner feedback and inputs */}
        <div className="lg:col-span-5 space-y-4">
          {/* Status bar */}
          <div className="flex items-center justify-between bg-card border rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${loading ? "bg-amber-400 animate-pulse" : "bg-emerald-500"}`} />
              <div>
                <p className="text-sm font-medium">{loading ? "Scanning…" : "Ready to scan"}</p>
                <p className="text-xs text-muted-foreground">
                  {buffer ? `Buffer: ${buffer}` : "Point scanner at barcode and press trigger"}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleClear}>
              <RefreshCcw size={14} className="mr-1" /> Reset
            </Button>
          </div>

          {/* Manual fallback */}
          <div className="flex gap-2">
            <Input
              placeholder="Or enter bill, phone, report ID manually..."
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { resolveCode(manualCode); setManualCode(""); } }}
              className="flex-1"
            />
            <Button onClick={() => { resolveCode(manualCode); setManualCode(""); }}>Lookup</Button>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-4 flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-300">{error}</p>
                <p className="text-xs text-muted-foreground mt-1">Ready for next scan.</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Kiosk Result Screen */}
        <div className="lg:col-span-7">
          {resolved?.patient ? (
            <div className="bg-card border rounded-xl shadow-md overflow-hidden flex flex-col min-h-[400px]">
              
              {/* Header / Countdown section */}
              <div className="bg-muted/50 p-4 border-b flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Badge className="bg-blue-100 text-blue-800 uppercase font-bold tracking-wider">
                    {resolved.type} Result Details
                  </Badge>
                  <span className="text-sm font-mono text-muted-foreground">{resolved.code}</span>
                </div>
                
                {countdown !== null && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full animate-pulse border border-amber-200">
                      Clearing in {countdown}s
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPaused((p) => !p)}
                      className="h-8 px-2"
                    >
                      {paused ? <Play size={13} className="mr-1" /> : <Square size={13} className="mr-1" />}
                      {paused ? "Resume" : "Keep"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleClear} className="h-8 px-2 text-destructive">
                      Clear now
                    </Button>
                  </div>
                )}
              </div>

              {/* Patient details */}
              <div className="p-4 border-b bg-gradient-to-r from-primary/5 to-transparent">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg shrink-0">
                    {resolved.patient.firstName[0]}{resolved.patient.lastName[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-bold">{resolved.patient.firstName} {resolved.patient.lastName}</h2>
                    <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground mt-0.5">
                      <span>PID: <span className="font-mono font-semibold text-foreground">{resolved.patient.patientId}</span></span>
                      <span>{ageDisplay ?? "—"} / <span className="capitalize">{resolved.patient.gender}</span></span>
                      {resolved.patient.bloodGroup && <span>Blood: <span className="text-red-600 font-bold">{resolved.patient.bloodGroup}</span></span>}
                      {resolved.patient.phone && <span>Phone: {resolved.patient.phone}</span>}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 bg-emerald-50 text-emerald-700 border-emerald-200">
                    <CheckCircle2 size={12} className="mr-1 text-emerald-500" /> Verified
                  </Badge>
                </div>
                {resolved.order && (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground border-t border-border pt-2">
                    <span>Order: <span className="font-mono font-semibold text-foreground">{resolved.order.orderNumber}</span></span>
                    <span>Ref. Doctor: <span className="font-medium text-foreground">{resolved.order.doctor?.name ?? "Self Referred"}</span></span>
                    {resolved.order.doctor?.specialization && <span>{resolved.order.doctor.specialization}</span>}
                  </div>
                )}
              </div>

              {/* Ready reports */}
              <div className="p-4 flex-1">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <FileText size={15} /> Ready Reports
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {reports.filter((r) => !r.isDelivered).length} pending · {reports.filter((r) => r.isDelivered).length} delivered
                  </span>
                </div>

                {reports.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <PackageOpen size={36} className="mx-auto opacity-30 mb-2" />
                    <p className="text-sm">No reports found for this patient.</p>
                    <p className="text-xs mt-1">A report appears here once it is signed. An unsigned report cannot be handed over.</p>
                  </div>
                )}

                <div className="space-y-2">
                  {reports.map((r) => (
                    <div key={r.id} className={`flex items-start justify-between gap-3 p-3 rounded-lg border ${r.isDelivered ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900" : "bg-card border-border"}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-semibold">{r.reportNumber}</span>
                          <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_COLOR[r.status] ?? "bg-gray-100 text-gray-800"}`}>
                            {r.isDelivered ? "Delivered" : r.status}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{r.type}</Badge>
                        </div>
                        <p className="text-sm font-medium mt-0.5 truncate">{r.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.testName} {r.testCode ? `(${r.testCode})` : ""} · Signed: {r.signedByName ?? "—"} · Verified: {r.verifiedByName ?? "—"}
                          {r.isDelivered && r.deliveredBy ? <span className="text-blue-600 font-medium"> · Handed by {r.deliveredBy}</span> : null}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        {/* The one-click Deliver button is retired. It set
                            `status = 'delivered'` — the value the report_delivered
                            commission policy pays on — with no record of who took
                            the paper or whether it ever reached the counter.
                            Handing paper over is now Scan Station → Deliver, which
                            writes two named custody acts per report. `isDelivered`
                            and `physicalState` are still shown, because the history
                            this page reads is real either way. */}
                        {r.physicalState === "HANDED_OVER" ? (
                          <Button variant="ghost" size="sm" disabled className="text-emerald-600">
                            <CheckCircle2 size={13} className="mr-1" /> Handed over at counter
                          </Button>
                        ) : r.isDelivered ? (
                          <Button variant="ghost" size="sm" disabled className="text-blue-600">
                            <CheckCircle2 size={13} className="mr-1" /> Shared
                          </Button>
                        ) : (
                          <Link href="/scan-station">
                            <Button variant="outline" size="sm" className="w-full gap-1">
                              <Send size={13} /> Hand over at the counter
                            </Button>
                          </Link>
                        )}
                        <Link href={`/report-generator?orderId=${r.orderId ?? ""}`}>
                          <Button variant="outline" size="sm" className="w-full gap-1">
                            <FileText size={13} /> View
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer controls */}
              <div className="p-4 bg-muted/40 border-t flex justify-end gap-3">
                <Button variant="outline" onClick={handleClear}>
                  Close Result
                </Button>
              </div>

            </div>
          ) : (
            <div className="bg-card border-2 border-dashed rounded-xl min-h-[400px] flex flex-col items-center justify-center text-center p-6 text-muted-foreground bg-muted/10">
              <ScanLine size={48} className="text-muted-foreground/30 mb-4 stroke-1" />
              <h3 className="font-semibold text-base text-foreground mb-1">Kiosk Result Screen</h3>
              <p className="text-sm max-w-sm">
                Scan patient, bill, phone, or report ID. Results and ready reports will display here instantly in real-time.
              </p>
            </div>
          )}
        </div>
      </div>

      <CustodyQueuesSection />
    </div>
  );
}
