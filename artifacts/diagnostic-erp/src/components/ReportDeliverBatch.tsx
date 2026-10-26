/**
 * Report Deliver Batch — the `DELIVER REPORTS` half of the report counter.
 *
 * Sits beside `ReportReceiveBatch` inside Scan Station for the same reason: the
 * scanner, the hidden input and the focus contract already work there, and a second
 * capture hook would be a second thing to break.
 *
 * Three steps, and the write is only the last one:
 *
 *   1. scan the patient's **bill** QR — that is what names who is standing at the
 *      counter, and the server re-reads it at confirm time rather than trusting
 *      this screen;
 *   2. scan the **report sheets** being handed over, ticking the ones the patient
 *      is collecting today (partial delivery is normal: one report now, the other
 *      on Monday);
 *   3. say **who** the paper went to, by category, and confirm once.
 *
 * Deliberate absences: no countdown and no auto-clear (a wiped tick list is a
 * clerk starting over), no report text of any kind (this is a delivery desk, and
 * the server does not send clinical content here), and no free-typed recipient —
 * the counter records that paper left with the patient or with somebody carrying
 * it, not a register of every person who touched a report.
 */
import { useCallback, useImperativeHandle, forwardRef, useRef, useState } from "react";
import { api, HttpError } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CheckCircle2, Trash2, AlertTriangle, Send, Loader2, Receipt, Undo2, Hand
} from "lucide-react";

/** Mirrors the server's cap (`RECEIVE_BATCH_LIMIT` in
 *  api-server/src/lib/reportCustodyReceive.ts), which one confirmation covers in
 *  either direction. A source-contract test asserts the two stay equal; the
 *  server's refusal is the one that can actually be bypassed. */
export const DELIVER_BATCH_LIMIT = 100;

export type ReportDeliverBatchHandle = {
  /** Called by Scan Station's existing scanner capture, and by its manual field. */
  scan: (code: string) => void;
};

/** Mirrors `PaymentSnapshot` in api-server/src/lib/reportCustodyReceive.ts. Each
 *  arm's `status` is a literal, not `string`, so a `=== "measured"` check actually
 *  narrows — with a loose arm the compiler keeps the union and `payment.total` is
 *  an error, which is how a "not measured" counter would render `undefined`. */
type Payment =
  | { status: "measured"; billNumber: string; total: string; paid: string; balance: string; billStatus: string }
  | { status: "no_bill_linked" }
  | { status: "bill_not_found"; billId: number };

type Bill = {
  billId: number;
  billNumber: string;
  patientId: number;
  settled: boolean;
  payment: Payment;
};

/** One piece of paper at the delivery desk.
 *
 *  `reportId` is null for a Word-typed report, so the row is keyed on `rowKey` and
 *  the confirmation names the examination instead. Everything else — the patient
 *  check, the received-first check, the money check — is the same judgement the
 *  server already makes, and the client never re-makes it. */
type Candidate = {
  rowKey: string;
  reportId: number | null;
  reportNumber: string | null;
  orderTestId: number | null;
  origin: string | null;
  patientId: number;
  patientLabel: string;
  testName: string | null;
  status: string;
  signedByName: string | null;
  revision: number;
  totalVersions: number;
  physicalState: string | null;
  handoverVerdict: string;
  handoverMessage: string;
  needsPaymentOverride: boolean;
};

/** One examination the bill bought, as the server described it. */
type Examination = {
  orderTestId: number | null;
  testName: string;
  wordOnly: boolean;
  paperSignedByName: string | null;
  candidate: Candidate;
};

type Item = {
  candidate: Candidate;
  /** True for a report CARE never produced — the label shown instead of an RPT number. */
  wordOnly: boolean;
  /** The code that named this sheet. A report pulled in by the bill carries the
   *  bill code until its own label is scanned, so the ledger says what was
   *  actually read rather than implying a scan that never happened. */
  scannedCode: string;
  include: boolean;
  result?: { ok: boolean; reason: string; message: string };
};

/** The four categories the server accepts, in the order a clerk chooses them. */
const RECIPIENTS: Array<{ value: string; label: string }> = [
  { value: "PATIENT", label: "The patient themselves" },
  { value: "FAMILY_MEMBER", label: "A family member holding the slip" },
  { value: "CARRYING_AGENT", label: "A courier / carrying agent" },
  { value: "DOOR_DROP", label: "Left at reception for collection" },
];

/**
 * Which refusals a tick can even be offered for. `PAYMENT_OUTSTANDING` is the only
 * one a reason clears; the rest are facts about the paper, and offering to tick them
 * would teach the clerk that the badges are decoration.
 */
const TICKABLE = new Set(["DELIVERABLE", "PAYMENT_OUTSTANDING"]);

/** A bill that was read, or the sentence explaining why it was not. */
type BillRead =
  | { ok: true; bill: Bill; patient: { name: string; patientCode: string } | null; examinations: Examination[] }
  | { ok: false; ambiguous: boolean; message: string };

const VERDICT_TONE: Record<string, string> = {
  DELIVERABLE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  PAYMENT_OUTSTANDING: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  NOT_AT_COUNTER: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  NOT_SIGNED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  WRONG_PATIENT: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  SUPERSEDED_REVISION: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  NOT_ON_THIS_BILL: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  ALREADY_HANDED_OVER: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  REPORT_NOT_FOUND: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

function money(value: string | undefined): string {
  const n = Number(value);
  return Number.isFinite(n) ? `₹${n.toFixed(2)}` : "—";
}

export default forwardRef<ReportDeliverBatchHandle, { disabled?: boolean }>(
  function ReportDeliverBatch({ disabled }, ref) {
    const [bill, setBill] = useState<Bill | null>(null);
    const [patient, setPatient] = useState<{ name: string; patientCode: string } | null>(null);
    const [items, setItems] = useState<Item[]>([]);
    const [recipient, setRecipient] = useState("");
    const [recipientName, setRecipientName] = useState("");
    const [overrideReason, setOverrideReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [done, setDone] = useState<{ handed: number; refused: number } | null>(null);
    /** One id per Confirm CLICK, reused on a network retry of that same click, so
     *  a resending browser cannot hand the same paper over twice. */
    const requestIdRef = useRef<string | null>(null);

    const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const invalidateConfirm = () => {
      requestIdRef.current = null;
      setDone(null);
    };

    /**
     * Step 1, and the only place a code is decided.
     *
     * Every scanned code is first asked "are you a bill?" by the server. When it
     * is not, the same code is then asked "are you a sheet on the open bill?". That
     * costs one extra round trip per report label, and it is worth it: the
     * alternative is a second copy of the bill-code parser in the browser, and this
     * project already has three of those (ScanStation, ReportDelivery and the API)
     * disagreeing about what a scanned string means. Here the server decides, so
     * the paper means one thing on every screen.
     */
    const readBill = useCallback(async (code: string): Promise<BillRead> => {
      try {
        const res = await api.post<{ bill: Bill; patient: { name: string; patientCode: string } | null; examinations: Examination[] }>(
          "/api/report-custody/bill",
          { code },
        );
        return { ok: true, bill: res.bill, patient: res.patient, examinations: res.examinations };
      } catch (err) {
        if (err instanceof HttpError) {
          const reason = (err.details as { reason?: string } | undefined)?.reason;
          // A bill number two books issued is not an identity to guess at, and the
          // clerk needs the difference: asking the sheet endpoint would only add a
          // second wrong answer on top of it.
          if (reason === "AMBIGUOUS_BILL") {
            return { ok: false, ambiguous: true, message: err.message };
          }
          return { ok: false, ambiguous: false, message: err.message };
        }
        return { ok: false, ambiguous: false, message: "Could not reach the server — nothing was recorded." };
      }
    }, []);

    const openBill = useCallback(async (code: string) => {
      const read = await readBill(code);
      if (!read.ok) {
        setNotice(read.message);
        return false;
      }
      const ready = read.examinations.filter((e) => TICKABLE.has(e.candidate.handoverVerdict)).length;
      setBill(read.bill);
      setPatient(read.patient);
      // A fresh bill is a fresh patient: anything left from the previous one is not
      // this patient's paper, and silently carrying it into the next confirm is how
      // a wrong-patient handover would ever reach the ledger.
      //
      // And nothing arrives ticked. The bill says who is standing at the counter,
      // not what they are taking home: a patient who came for one report of five
      // must tick one.
      setItems(
        read.examinations
          .slice(0, DELIVER_BATCH_LIMIT)
          .map((e) => ({ candidate: e.candidate, wordOnly: e.wordOnly, scannedCode: code, include: false })),
      );
      setDone(null);
      requestIdRef.current = null;
      setNotice(
        read.examinations.length === 0
          ? "This bill has no examinations on it, so there is no paper to hand over."
          : ready === 0
            ? `Bill read — ${read.examinations.length} examination(s), none ready to hand over. Read each line below.`
            : `${read.patient?.name ?? "This patient"} · ${ready} of ${read.examinations.length} ready. `
              + "Tick the papers being collected — the scan ticks nothing.",
      );
      return true;
    }, [readBill]);

    const scanSheet = useCallback(async (code: string, billCode: string) => {
      try {
        const res = await api.post<{ candidate: Candidate }>("/api/report-custody/handover/scan", {
          code,
          billCode,
        });
        const c = res.candidate;
        setItems((prev) => {
          const existing = prev.find((it) => it.candidate.rowKey === c.rowKey);
          if (existing) {
            // The sheet itself was scanned, so from now on this row carries the
            // code that was actually read off it, not the bill that listed it.
            return prev.map((it) => (it === existing ? { ...it, scannedCode: code, candidate: c } : it));
          }
          if (prev.length >= DELIVER_BATCH_LIMIT) {
            setNotice(`One confirmation covers at most ${DELIVER_BATCH_LIMIT} reports. Confirm this batch first.`);
            return prev;
          }
          return [...prev, { candidate: c, wordOnly: c.reportId == null, scannedCode: code, include: c.handoverVerdict === "DELIVERABLE" }];
        });
        invalidateConfirm();
        if (c.handoverVerdict === "WRONG_PATIENT") {
          setNotice(`${c.reportNumber ?? c.testName} belongs to a different patient than this bill. Hand it over on its own bill.`);
        }
      } catch (err) {
        setNotice(err instanceof HttpError ? err.message : "Could not reach the server — nothing was recorded.");
      }
    }, []);

    const runScan = useCallback(async (raw: string) => {
      const code = raw.trim();
      if (!code || disabled) return;
      setBusy(true);
      setNotice(null);
      try {
        const asBill = await openBill(code);
        if (asBill) return;
        if (!bill) {
          setNotice("Scan the patient's bill QR first — it is what names who is collecting.");
          return;
        }
        await scanSheet(code, bill.billNumber);
      } finally {
        setBusy(false);
      }
    }, [bill, disabled, openBill, scanSheet]);

    useImperativeHandle(ref, () => ({ scan: (code: string) => { void runScan(code); } }), [runScan]);

    const toggle = (rowKey: string) => {
      setItems((prev) => prev.map((it) => (it.candidate.rowKey === rowKey ? { ...it, include: !it.include } : it)));
      invalidateConfirm();
    };

    const dropItem = (rowKey: string) => {
      setItems((prev) => prev.filter((it) => it.candidate.rowKey !== rowKey));
      invalidateConfirm();
    };

    const startOver = () => {
      setBill(null);
      setPatient(null);
      setItems([]);
      setRecipient("");
      setRecipientName("");
      setOverrideReason("");
      setDone(null);
      setNotice(null);
      requestIdRef.current = null;
    };

    const chosen = items.filter((it) => it.include && !it.result);
    const needsOverride = chosen.some((it) => it.candidate.needsPaymentOverride);
    const payment = bill?.payment;
    const outstanding = payment?.status === "measured" ? payment.balance : null;

    const canConfirm = Boolean(bill)
      && chosen.length > 0
      && recipient !== ""
      && (!needsOverride || overrideReason.trim().length > 0);

    const confirm = async () => {
      if (!bill || !canConfirm) return;
      if (!requestIdRef.current) requestIdRef.current = newKey();
      setConfirming(true);
      setNotice(null);
      try {
        const res = await api.post<{
          handed: number;
          refused: number;
          results: Array<{ rowKey: string; ok: boolean; reason: string; message: string }>;
        }>("/api/report-custody/handover", {
          requestId: requestIdRef.current,
          billCode: bill.billNumber,
          recipientCategory: recipient,
          recipientName: recipientName.trim() || null,
          paymentOverrideReason: needsOverride ? overrideReason.trim() : null,
          items: chosen.map((it) => ({
            // Two identities, one act: the row when CARE wrote the report, the
            // examination when the paper was typed in Word.
            ...(it.candidate.reportId != null
              ? { reportId: it.candidate.reportId }
              : { orderTestId: it.candidate.orderTestId }),
            scannedCode: it.scannedCode,
          })),
        });
        const byKey = new Map(res.results.map((r) => [r.rowKey, r]));
        setItems((prev) => prev.map((it) => {
          const r = byKey.get(it.candidate.rowKey);
          return r ? { ...it, result: { ok: r.ok, reason: r.reason, message: r.message } } : it;
        }));
        setDone({ handed: res.handed, refused: res.refused });
        if (res.refused > 0) {
          setNotice(
            `${res.refused} ${res.refused === 1 ? "report was" : "reports were"} refused and is still listed — the `
            + "rest went. Read each refused line, then remove that row, or open the bill again once it has been fixed.",
          );
        }
      } catch (err) {
        setNotice(err instanceof HttpError ? err.message : "Nothing was recorded — the server could not be reached.");
      } finally {
        setConfirming(false);
      }
    };

    return (
      <div className="space-y-3">
        {/* Step 1 — who is standing at the counter. */}
        <div className="bg-card border rounded-xl p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${busy ? "bg-amber-400 animate-pulse" : "bg-emerald-500"}`} />
              <div>
                <p className="text-sm font-medium">{busy ? "Reading label…" : bill ? "Bill open" : "Scan the patient's bill"}</p>
                <p className="text-xs text-muted-foreground">
                  {bill
                    ? `${patient?.name ?? ""} · Bill ${bill.billNumber}`
                    : "The bill QR is what names the patient. Then tick the papers they are collecting."}
                </p>
              </div>
            </div>
            {(bill || items.length > 0) && !done && (
              <Button variant="outline" size="sm" onClick={startOver} className="gap-1">
                <Undo2 size={14} /> Next patient
              </Button>
            )}
          </div>

          {payment?.status === "measured" && (
            <div className="grid grid-cols-3 gap-2 mt-4 text-center">
              <div className="rounded-lg bg-muted/40 p-2">
                <p className="text-lg font-bold leading-none">{money(payment.total)}</p>
                <p className="text-[11px] text-muted-foreground mt-1">Bill total</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-2">
                <p className="text-lg font-bold leading-none text-emerald-700 dark:text-emerald-300">{money(payment.paid)}</p>
                <p className="text-[11px] text-muted-foreground mt-1">Collected</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-2">
                <p className={`text-lg font-bold leading-none ${bill?.settled ? "" : "text-red-600"}`}>
                  {money(payment.balance)}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">Balance</p>
              </div>
            </div>
          )}

          {notice && (
            <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{notice}</span>
            </div>
          )}
        </div>

        {/* Step 2 — the sheets, each judged by the server. */}
        {items.length === 0 ? (
          <div className="border-2 border-dashed rounded-xl p-8 text-center text-muted-foreground bg-muted/10">
            <Receipt size={32} className="mx-auto opacity-30 mb-2" />
            <p className="text-sm font-medium text-foreground">No bill open</p>
            <p className="text-xs mt-1 max-w-sm mx-auto">
              Scan the patient's bill QR, or type its number in the field above. Every examination billed on
              it appears here, each with its own verdict — Word-typed reports included.
            </p>
          </div>
        ) : (
          <div className="border rounded-xl bg-card divide-y max-h-[42vh] overflow-y-auto">
            {items.map((it) => {
              const c = it.candidate;
              const tone = VERDICT_TONE[c.handoverVerdict] ?? "bg-gray-100 text-gray-800";
              const tickable = TICKABLE.has(c.handoverVerdict) && !it.result;
              return (
                <div key={c.rowKey} className="p-3 flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={it.include}
                    disabled={!tickable}
                    onChange={() => toggle(c.rowKey)}
                    aria-label={`Hand over ${c.reportNumber ?? it.candidate.testName ?? "this report"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold">{c.reportNumber ?? "Word report"}</span>
                      {it.wordOnly && (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">signed paper</span>
                      )}
                      {c.totalVersions > 1 && (
                        <span className="text-[10px] text-muted-foreground">v{c.revision}/{c.totalVersions}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate">{c.patientLabel}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.testName ?? c.status} · Signed: {c.signedByName ?? "—"}
                    </p>
                    <p className="text-xs mt-1">{it.result ? it.result.message : c.handoverMessage}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {it.result ? (
                      it.result.ok ? (
                        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 size={14} /> Handed over
                        </span>
                      ) : (
                        <Badge className={VERDICT_TONE[it.result.reason] ?? tone}>
                          {it.result.reason.replaceAll("_", " ")}
                        </Badge>
                      )
                    ) : (
                      <Badge className={tone}>{c.handoverVerdict.replaceAll("_", " ")}</Badge>
                    )}
                    {!it.result && (
                      <button
                        onClick={() => dropItem(c.rowKey)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Remove from this delivery"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Step 3 — who it went to, then the one confirmation. */}
        {!done && items.length > 0 && (
          <div className="bg-card border rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Hand size={14} /> Who collected it
            </div>
            <Select value={recipient} onValueChange={setRecipient}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Choose who the paper went to…" />
              </SelectTrigger>
              <SelectContent>
                {RECIPIENTS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Optional free text, and only ever a description: the category above
                is what the ledger records and what the dashboard counts. */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                With them (optional) — e.g. &ldquo;son, Rakesh&rdquo;
              </Label>
              <Input
                value={recipientName}
                maxLength={120}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Name the person holding the slip, if you want to"
              />
            </div>

            {needsOverride && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 space-y-1.5">
                <Label className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                  {money(outstanding ?? undefined)} is still due on this bill. Say why it is being handed over —
                  your name and this reason are recorded with it.
                </Label>
                <Input
                  value={overrideReason}
                  maxLength={500}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. Dues settled against the corporate account, invoice at billing desk"
                />
              </div>
            )}

            <Button
              size="lg"
              className="w-full gap-2"
              onClick={confirm}
              disabled={confirming || !canConfirm}
            >
              {confirming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {chosen.length === 0
                ? "Tick the reports the patient is collecting"
                : `Confirm ${chosen.length} report${chosen.length === 1 ? "" : "s"} handed over`}
            </Button>
          </div>
        )}

        {done && (
          <div className="rounded-xl border bg-emerald-50/60 dark:bg-emerald-950/20 p-4 space-y-2">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 size={16} />
              {done.handed} report{done.handed === 1 ? "" : "s"} handed over to{" "}
              {RECIPIENTS.find((r) => r.value === recipient)?.label.toLowerCase() ?? "the counter"}
              {done.refused > 0 ? ` · ${done.refused} refused below` : ""}
            </p>
            <Button size="sm" onClick={startOver}>Next patient</Button>
          </div>
        )}
      </div>
    );
  },
);
