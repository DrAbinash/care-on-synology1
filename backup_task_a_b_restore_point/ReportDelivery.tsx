import { useEffect, useRef, useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ScanLine, AlertTriangle, CheckCircle2, RefreshCcw,
  PackageOpen, Send, FileText, Play, Square, Eye, User, Receipt
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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

type PatientReport = {
  id: number;
  reportNumber: string;
  type: string;
  testId: number;
  orderTestId: number | null;
  orderId: number | null;
  title: string;
  status: string;
  deliveredAt: string | null;
  body: string;
  impression: string | null;
  signedByName: string | null;
  verifiedByName: string | null;
  createdAt: string;
  testName: string | null;
  testCode: string | null;
  isDelivered: boolean;
  deliveredBy: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  verified: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  reported: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  delivered: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  draft: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

export default function ReportDelivery() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
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

  const deliverMut = useMutation({
    mutationFn: (reportId: number) => api.post(`/api/resolve-barcode/reports/${reportId}/deliver`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient-reports-ready", patientId] });
      toast({ title: "Marked as delivered" });
    },
    onError: (err) => toast({ title: (err as Error).message, variant: "destructive" }),
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
                    <p className="text-xs mt-1">Reports must be verified or completed before delivery.</p>
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
                        {r.impression && (
                          <p className="text-xs text-muted-foreground mt-1 italic truncate">{r.impression}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        {!r.isDelivered ? (
                          <Button
                            size="sm"
                            onClick={() => deliverMut.mutate(r.id)}
                            disabled={deliverMut.isPending}
                            className="gap-1"
                          >
                            <Send size={13} /> Deliver
                            {deliverMut.isPending && <span className="animate-pulse">…</span>}
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" disabled className="text-blue-600">
                            <CheckCircle2 size={13} className="mr-1" /> Done
                          </Button>
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
    </div>
  );
}
