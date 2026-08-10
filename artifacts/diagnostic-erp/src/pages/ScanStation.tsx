import { useEffect, useRef, useState, useCallback } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ScanLine, AlertTriangle, PackageCheck, FlaskConical,
  CheckCircle2, XCircle, ArrowRight, RefreshCcw, Printer, Trash2,
  User, Receipt, ShieldCheck, FileText, Play, Square, Eye
} from "lucide-react";
import SampleLabel, { printLabels } from "@/components/SampleLabel";
import { readStaffSession } from "@/lib/staffSession";
import { useLocation } from "wouter";

type Patient = {
  id: number; firstName: string; lastName: string; patientId: string;
  phone: string; gender: string; dateOfBirth: string;
  ageValue?: number | null; ageUnit?: string | null;
};

type SampleTest = {
  orderTestId: number; testId: number; testCode: string;
  testName: string; category: string; resultStatus: string | null;
};

type Sample = {
  id: number; barcode: string; orderId: number; patientId: number;
  sampleType: string; containerType: string; volume: string; status: string;
  collectedByName: string; collectedAt: string; collectionSite: string;
  receivedAt: string | null; processingStartedAt: string | null;
  completedAt: string | null; reportedAt: string | null;
  rejectedAt: string | null; rejectionReason: string | null;
  isOutsourced: boolean; outsourceLab: string | null;
  notes: string;
  patient: Patient | null;
  order: { id: number; orderNumber: string } | null;
  tests: SampleTest[];
};

const STATUS_ORDER = [
  "pending", "collected", "received", "in_processing", "completed", "reported", "rejected",
];

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending", collected: "Collected", received: "Received",
  in_processing: "In Processing", completed: "Completed", reported: "Reported", rejected: "Rejected",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  collected: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  received: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  in_processing: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  reported: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

const NEXT_ACTIONS: Record<string, Array<{ next: string; label: string; icon: React.ComponentType<{size?:number;className?:string}> }>> = {
  pending:        [{ next: "collected",       label: "Mark Collected",      icon: FlaskConical }],
  collected:      [{ next: "received",        label: "Receive at Lab",      icon: PackageCheck }],
  received:       [{ next: "in_processing",   label: "Start Processing",    icon: FlaskConical }],
  in_processing:  [{ next: "completed",       label: "Mark Completed",      icon: CheckCircle2 }],
  completed:      [{ next: "reported",        label: "Mark Reported",       icon: CheckCircle2 }],
  reported:       [],
  rejected:       [],
};

const REJECT_REASONS = [
  "Hemolysis", "Clotted", "Insufficient quantity", "Wrong container",
  "Lipemic", "Icteric", "Patient not present", "Wrong patient",
  "Expired sample", "Transport delay", "Other",
];

export default function ScanStation() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [buffer, setBuffer] = useState("");
  const [sample, setSample] = useState<Sample | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [manualBarcode, setManualBarcode] = useState("");

  // Kiosk specific states
  const [kioskResult, setKioskResult] = useState<any>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const countdownIntervalRef = useRef<number | null>(null);

  // Fetch clinic settings
  const { data: clinicSettings } = useQuery<any>({
    queryKey: ["clinic-settings-public"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 60_000,
  });

  const kioskModeEnabled = clinicSettings?.scanStationKioskModeEnabled !== false;
  const autoClearEnabled = clinicSettings?.scanStationAutoClearEnabled !== false;
  const displaySeconds = clinicSettings?.scanStationResultDisplaySeconds ?? 10;

  const session = readStaffSession();
  const staffName = session?.user?.name ?? "";

  // Always keep the hidden input focused so scanner output goes there.
  useEffect(() => {
    const focusInput = () => inputRef.current?.focus();
    focusInput();
    window.addEventListener("click", focusInput);
    window.addEventListener("touchstart", focusInput);
    return () => {
      window.removeEventListener("click", focusInput);
      window.removeEventListener("touchstart", focusInput);
    };
  }, []);

  // Global keyboard capture: any printable key goes into the hidden input.
  // The scanner sends a rapid burst of characters followed by Enter.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in a visible input/textarea/select.
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (["input", "textarea", "select"].includes(tag) && e.target !== inputRef.current) return;

      // Prevent default navigation for keys that would leave the page.
      if (e.key === "Enter" && inputRef.current === document.activeElement) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Helper: detect if the scanned input is a bill-verification QR URL.
  function extractBillNumber(raw: string): string | null {
    const m = raw.match(/\/api\/verify\/bill\/([A-Za-z0-9\-]+)/);
    return m ? m[1] : null;
  }

  function extractBillVerifyHash(raw: string): string | null {
    try {
      const u = new URL(raw, window.location.origin);
      const h = u.searchParams.get("hash");
      return h ? h.trim() : null;
    } catch {
      const m = raw.match(/[?&]hash=([A-Fa-f0-9]+)/);
      return m ? m[1] : null;
    }
  }

  // Clear current results
  const handleClear = useCallback(() => {
    setSample(null);
    setKioskResult(null);
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

  const lookupBarcode = useCallback(async (barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    handleClear();
    setRejecting(false);
    setRejectReason("");

    try {
      // 1. Check if it's a Bill QR url or number or pattern
      const billNo = extractBillNumber(trimmed) || (trimmed.startsWith("BILL:") ? trimmed.slice(5) : (/^\d{10,}$/.test(trimmed) ? trimmed : null));
      
      if (billNo && kioskModeEnabled) {
        // Fetch verification details locally for display — forward ?hash= so
        // the anti-tamper check runs the same as a phone camera scan.
        const hash = extractBillVerifyHash(trimmed);
        const qs = hash ? `?hash=${encodeURIComponent(hash)}` : "";
        const res = await api.get<any>(`/api/verify/bill/${encodeURIComponent(billNo)}${qs}`);
        setKioskResult({
          type: "bill",
          code: billNo,
          data: res
        });
        if (autoClearEnabled) {
          setCountdown(displaySeconds);
        }
        return;
      }

      // If it's a bill URL and kiosk mode is disabled, keep old fallback tab behavior
      const directBillNo = extractBillNumber(trimmed);
      if (directBillNo && !kioskModeEnabled) {
        setLoading(false);
        setBuffer("");
        if (inputRef.current) inputRef.current.value = "";
        // Prefer the scanned URL as-is so ?hash= survives; fall back to rebuilt.
        const verifyUrl = /^https?:\/\//i.test(trimmed)
          ? trimmed
          : (() => {
              const hash = extractBillVerifyHash(trimmed);
              const qs = hash ? `?hash=${encodeURIComponent(hash)}` : "";
              return `${window.location.origin}/api/verify/bill/${encodeURIComponent(directBillNo)}${qs}`;
            })();
        window.open(verifyUrl, "_blank", "noopener,noreferrer");
        setTimeout(() => inputRef.current?.focus(), 50);
        return;
      }

      // 2. Fall back to resolving via barcode resolver (which maps samples, orders, reports etc.)
      const resolved = await api.get<any>(`/api/resolve-barcode/${encodeURIComponent(trimmed)}`).catch(() => null);
      if (resolved && kioskModeEnabled) {
        setKioskResult({
          type: resolved.type,
          code: resolved.code,
          data: resolved
        });
        if (autoClearEnabled) {
          setCountdown(displaySeconds);
        }
        return;
      }

      // 3. Fall back to sample scanning status endpoint
      const s = await api.get<Sample>(`/api/samples/scan/${encodeURIComponent(trimmed)}`);
      setSample(s);
    } catch (err: any) {
      setError(err?.message || "Entity or sample not found");
    } finally {
      setLoading(false);
      setBuffer("");
      if (inputRef.current) inputRef.current.value = "";
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [kioskModeEnabled, autoClearEnabled, displaySeconds, handleClear]);

  // When Enter is pressed in the hidden input, fire lookup.
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      lookupBarcode(e.currentTarget.value);
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBuffer(e.target.value);
  };

  const statusMut = useMutation({
    mutationFn: ({ id, status, reason }: { id: number; status: string; reason?: string }) =>
      api.post<Sample>(`/api/samples/${id}/status`, {
        status, rejectionReason: reason, actorName: staffName,
      }),
    onSuccess: (s) => {
      setSample(s);
      setRejecting(false);
      setRejectReason("");
      qc.invalidateQueries({ queryKey: ["samples"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const handleStatus = (nextStatus: string) => {
    if (!sample) return;
    if (nextStatus === "rejected") {
      setRejecting(true);
      return;
    }
    statusMut.mutate({ id: sample.id, status: nextStatus });
  };

  const confirmReject = () => {
    if (!sample || !rejectReason.trim()) return;
    statusMut.mutate({ id: sample.id, status: "rejected", reason: rejectReason.trim() });
  };

  const labelRef = useRef<HTMLDivElement | null>(null);

  const printSampleLabel = () => {
    if (!labelRef.current) return;
    printLabels([labelRef.current]);
  };

  const statusIndex = sample ? STATUS_ORDER.indexOf(sample.status) : -1;

  // Generate target redirect links from resolved details
  const getFullPageRedirectUrl = () => {
    if (!kioskResult) return null;
    const type = kioskResult.type;
    const val = kioskResult.code;
    if (type === "bill") return `/billing/${encodeURIComponent(val)}`;
    if (type === "patient") return `/patients/${encodeURIComponent(val)}`;
    if (type === "report") return `/reports`;
    if (type === "order") return `/orders`;
    return null;
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto px-4">
      <PageHeader
        title="Scan Station"
        subtitle={kioskModeEnabled ? "Kiosk mode active — lookup details instantly on the same screen" : "Barcode scan workflow — no page refresh, no blank tabs"}
        actions={<ScanLine size={18} className="text-primary" />}
      />

      {/* Hidden input that always captures scanner keyboard output */}
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
        {/* Left Side: Scanner Feedback & Inputs */}
        <div className="lg:col-span-5 space-y-4">
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
            <Button variant="outline" size="sm" onClick={() => { setBuffer(""); inputRef.current && (inputRef.current.value = ""); inputRef.current?.focus(); }}>
              <RefreshCcw size={14} className="mr-1" /> Reset
            </Button>
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="Or type barcode manually & press Enter"
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { lookupBarcode(manualBarcode); setManualBarcode(""); } }}
              className="flex-1"
            />
            <Button onClick={() => { lookupBarcode(manualBarcode); setManualBarcode(""); }}>Lookup</Button>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-4 flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-300">{error}</p>
                <p className="text-xs text-muted-foreground mt-1">Scanner buffer cleared — ready for next scan.</p>
              </div>
            </div>
          )}

          {/* Sample Workflow Actions (If normal sample was scanned) */}
          {sample && (
            <div className="bg-card border rounded-xl shadow-sm overflow-hidden p-4 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold font-mono">{sample.barcode}</h2>
                    <Badge className={STATUS_COLOR[sample.status] ?? "bg-gray-100 text-gray-800"}>
                      {STATUS_LABEL[sample.status] ?? sample.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Order #{sample.order?.orderNumber ?? sample.orderId} · {sample.sampleType}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={printSampleLabel}>
                  <Printer size={14} className="mr-1" /> Label
                </Button>
              </div>

              {/* Progress bar */}
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workflow Progress</p>
                <div className="flex items-center gap-1 overflow-x-auto pb-1">
                  {STATUS_ORDER.filter((s) => s !== "rejected").map((s, i) => {
                    const done = statusIndex >= i && sample.status !== "rejected";
                    const current = sample.status === s;
                    return (
                      <div key={s} className="flex items-center gap-1 shrink-0">
                        <div className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap ${done ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                          {STATUS_LABEL[s]}
                        </div>
                        {i < STATUS_ORDER.length - 2 && <ArrowRight size={12} className="text-muted-foreground shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Actions */}
              <div className="pt-2">
                {sample.status === "rejected" ? (
                  <p className="text-sm text-red-700 bg-red-50 p-2 rounded">Rejected: {sample.rejectionReason}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(NEXT_ACTIONS[sample.status] ?? []).map((a) => {
                      const Icon = a.icon;
                      return (
                        <Button key={a.next} size="sm" onClick={() => handleStatus(a.next)} className="gap-1">
                          <Icon size={14} /> {a.label}
                        </Button>
                      );
                    })}
                    <Button variant="destructive" size="sm" onClick={() => setRejecting(true)}>Reject</Button>
                  </div>
                )}

                {rejecting && (
                  <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 rounded-lg p-3 space-y-2 mt-2">
                    <Label className="text-xs">Rejection reason</Label>
                    <Select value={rejectReason} onValueChange={setRejectReason}>
                      <SelectTrigger className="h-8 text-xs bg-white">
                        <SelectValue placeholder="Select reason…" />
                      </SelectTrigger>
                      <SelectContent>
                        {REJECT_REASONS.map((r) => (
                          <SelectItem key={r} value={r}>{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" onClick={confirmReject} disabled={!rejectReason}>Confirm</Button>
                      <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Kiosk Side Panel View */}
        <div className="lg:col-span-7">
          {kioskResult ? (
            <div className="bg-card border rounded-xl shadow-md overflow-hidden flex flex-col min-h-[400px]">
              
              {/* Header / Countdown section */}
              <div className="bg-muted/50 p-4 border-b flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Badge className="bg-blue-100 text-blue-800 uppercase font-bold tracking-wider">
                    {kioskResult.type} Details
                  </Badge>
                  <span className="text-sm font-mono text-muted-foreground">{kioskResult.code}</span>
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

              {/* Body details */}
              <div className="p-6 flex-1 space-y-6">
                
                {/* 1. Patient Info */}
                {kioskResult.data.patientName && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <User size={14} /> Patient Details
                    </div>
                    <div className="bg-muted/30 p-3 rounded-lg border">
                      <div className="font-bold text-base">{kioskResult.data.patientName}</div>
                      <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 gap-2">
                        <div>ID: <span className="font-mono">{kioskResult.data.patientCode || "—"}</span></div>
                        {kioskResult.data.patientSince && <div>Patient Since: {kioskResult.data.patientSince}</div>}
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Bill & Payment Summary */}
                {kioskResult.type === "bill" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <Receipt size={14} /> Bill & Payment Status
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-muted/30 p-3 rounded-lg border space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Total:</span>
                          <span className="font-bold">₹{kioskResult.data.total?.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-green-600">
                          <span>Paid:</span>
                          <span className="font-bold">- ₹{kioskResult.data.paid?.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-red-600 font-bold border-t pt-1 mt-1">
                          <span>Balance:</span>
                          <span>₹{kioskResult.data.balance?.toFixed(2)}</span>
                        </div>
                      </div>
                      
                      <div className="flex flex-col justify-center items-start p-3 bg-muted/20 rounded-lg border gap-2">
                        <div>
                          <span className="text-xs text-muted-foreground block">Bill Status</span>
                          <Badge className={
                            kioskResult.data.status === "paid" ? "bg-green-100 text-green-800" :
                            kioskResult.data.status === "cancelled" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                          }>
                            {kioskResult.data.status?.toUpperCase()}
                          </Badge>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Issued Date</span>
                          <span className="text-xs font-medium">{kioskResult.data.issued}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. Tests List */}
                {kioskResult.data.tests && kioskResult.data.tests.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <FileText size={14} /> Prescribed Tests
                    </div>
                    <div className="border rounded-lg divide-y bg-background text-sm">
                      {kioskResult.data.tests.map((t: any, i: number) => (
                        <div key={i} className="p-2.5 flex justify-between items-center gap-2">
                          <div className="font-medium text-foreground">
                            {t.name} <span className="text-xs text-muted-foreground">({t.code})</span>
                          </div>
                          {t.price !== undefined && (
                            <span className="font-mono text-xs">₹{Number(t.price).toFixed(2)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>

              {/* Footer controls */}
              <div className="p-4 bg-muted/40 border-t flex justify-end gap-3">
                <Button variant="outline" onClick={handleClear}>
                  Close Result
                </Button>
                {getFullPageRedirectUrl() && (
                  <Button onClick={() => {
                    const url = getFullPageRedirectUrl();
                    if (url) navigate(url);
                  }} className="gap-2">
                    <Eye size={14} /> Open Full Page
                  </Button>
                )}
              </div>

            </div>
          ) : (
            <div className="bg-card border-2 border-dashed rounded-xl min-h-[400px] flex flex-col items-center justify-center text-center p-6 text-muted-foreground bg-muted/10">
              <ScanLine size={48} className="text-muted-foreground/30 mb-4 stroke-1" />
              <h3 className="font-semibold text-base text-foreground mb-1">Kiosk Result Screen</h3>
              <p className="text-sm max-w-sm">
                Scan patient, bill, payment, or report barcodes. Results will display here instantly in real-time.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
