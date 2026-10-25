/**
 * Report Receive Batch — the `RECEIVE REPORTS` half of the report counter.
 *
 * It is a component inside Scan Station rather than a page because the scanner
 * already works there: one hidden input, one keyboard listener, one focus
 * contract. A second capture hook would be a second thing to break, and two
 * listeners on one page would split every scan between them.
 *
 * The rule this screen exists to enforce is the owner's: **scanning never marks a
 * report received.** Every scan here is a question — "what is this label?" — and
 * the answer is held in a review list. The only write is the one Confirm click,
 * and the server re-decides every item at that moment. So:
 *
 *   • no countdown and no auto-clear. A kiosk that wipes the list 10 seconds into
 *     a 40-report batch is the fastest way to make a clerk distrust a new tool;
 *   • the cap is enforced here so a lost tab cannot strand 130 labels, and again
 *     on the server, which is the one that can actually be bypassed;
 *   • a duplicate label is recognised before Confirm, not after;
 *   • each item reports its own outcome. One unsigned report in a stack of 39 must
 *     not cost the clerk the other 38.
 *
 * **A bill scan lists examinations, and ticks none of them.** Most reports here are
 * typed in Microsoft Word, so the bill QR is the code that exists and the
 * examination is the paper's identity. A bill can buy three tests and only two
 * sheets may have arrived, so the clerk selects which ones — the scan is not
 * allowed to decide that, and nothing is ticked until a person ticks it.
 */
import { useCallback, useImperativeHandle, forwardRef, useRef, useState } from "react";
import { api, HttpError } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Trash2, AlertTriangle, PackageCheck, Inbox, Loader2, PenLine } from "lucide-react";

/** Mirrors RECEIVE_BATCH_LIMIT in api-server/src/lib/reportCustodyReceive.ts.
 *  A source-contract test asserts the two stay equal; the server's refusal is the
 *  one that binds, this is the one that saves the clerk's list. */
export const RECEIVE_BATCH_LIMIT = 100;

export type ReportReceiveBatchHandle = {
  /** Called by Scan Station's existing scanner capture, and by its manual field. */
  scan: (code: string) => void;
};

/** What one piece of paper is called at the counter.
 *
 *  `reportId` is null for a Word-typed report: CARE holds no row for it, so the
 *  billed examination (`orderTestId`) is the whole identity, exactly as the ledger
 *  stores it. `rowKey` is what this list keys on, because a React key cannot be
 *  "whichever of the two ids happens to be set". */
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
  verdict: string;
  message: string;
  alreadyReceived: { actorName: string; at: string } | null;
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
  localKey: string;
  code: string;
  /** null while the server is still answering, or when the code meant nothing. */
  candidate: Candidate | null;
  /** A Word report has no row to prove it was signed, so the receiving clerk names
   *  the signer. Sent with the confirmation and stored on the custody event — never
   *  written into the report itself, and never a substitute for the server's check. */
  paperSignedByName: string;
  /** True only for a paper the clerk has selected. A bill scan sets nothing. */
  include: boolean;
  /** The sentence for a code that named no report — kept so the clerk can see
   *  what the scanner actually read. */
  rejection?: string;
  result?: { ok: boolean; reason: string; message: string };
};

const VERDICT_TONE: Record<string, string> = {
  RECEIVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  NOT_SIGNED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  SUPERSEDED_REVISION: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  WORD_REPORT_NOT_REGISTERED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  ALREADY_AT_COUNTER: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  ALREADY_HANDED_OVER: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  REPORT_NOT_FOUND: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  NOT_A_REPORT_CODE: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

/** A Word paper becomes selectable the moment the clerk has said who signed it.
 *  This is not the counter deciding that the report is authorised — the server
 *  re-reads everything at Confirm. It is a required field being filled in.
 *
 *  And paper that has already arrived, or already left, is never selectable: the
 *  server would refuse it, and a tick that always fails teaches a clerk to ignore
 *  the badges — which is the one thing a counter must not train out of a person. */
function isSelectable(item: Item): boolean {
  const c = item.candidate;
  if (!c) return false;
  if (c.verdict === "ALREADY_AT_COUNTER" || c.verdict === "ALREADY_HANDED_OVER") return false;
  if (c.reportId != null) return c.verdict === "RECEIVED";
  return c.verdict === "RECEIVED" || item.paperSignedByName.trim().length > 0;
}

export default forwardRef<ReportReceiveBatchHandle, { disabled?: boolean }>(
  function ReportReceiveBatch({ disabled }, ref) {
    const [items, setItems] = useState<Item[]>([]);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [done, setDone] = useState<{ received: number; refused: number } | null>(null);
    /** One id per Confirm CLICK, not per attempt: a network retry of the same
     *  click must not create a second receipt. Cleared when the list changes. */
    const requestIdRef = useRef<string | null>(null);

    const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const invalidateConfirm = () => {
      requestIdRef.current = null;
      setDone(null);
    };

    const addCandidate = useCallback((code: string, candidate: Candidate) => {
      setItems((prev) => {
        // Duplicate: the same paper already in the list. Refusing to add it twice
        // is kinder than letting Confirm refuse the second one.
        const clash = prev.find((it) => it.candidate?.rowKey === candidate.rowKey);
        if (clash) {
          setNotice(`${candidate.reportNumber ?? candidate.testName} is already in this batch.`);
          return prev;
        }
        if (prev.length >= RECEIVE_BATCH_LIMIT) {
          setNotice(`A batch holds at most ${RECEIVE_BATCH_LIMIT} reports. Confirm this one, then start the next.`);
          return prev;
        }
        invalidateConfirm();
        // A label the clerk pointed at is paper they are holding, so it starts
        // selected. A bill scan cannot claim that about three sheets at once.
        return [...prev, { localKey: newKey(), code, candidate, paperSignedByName: "", include: true }];
      });
    }, []);

    /** The bill scan: every examination it bought, each unticked. */
    const addExaminations = useCallback((code: string, examinations: Examination[]) => {
      setItems((prev) => {
        const fresh = examinations.filter(
          (e) => !prev.some((it) => it.candidate?.rowKey === e.candidate.rowKey),
        );
        if (fresh.length === 0) {
          setNotice(`Nothing new on bill ${code} — every examination is already listed.`);
          return prev;
        }
        if (prev.length >= RECEIVE_BATCH_LIMIT) {
          setNotice(`A batch holds at most ${RECEIVE_BATCH_LIMIT} reports. Confirm this one, then start the next.`);
          return prev;
        }
        invalidateConfirm();
        return [
          ...prev,
          ...fresh
            .slice(0, RECEIVE_BATCH_LIMIT - prev.length)
            .map((e) => ({
              localKey: newKey(),
              code,
              candidate: e.candidate,
              // A report that already arrived carries the name the first clerk gave;
              // it is shown, and the server will not let a second account replace it.
              paperSignedByName: e.wordOnly ? (e.paperSignedByName ?? "") : "",
              include: false,
            })),
        ];
      });
    }, []);

    const runScan = useCallback(async (raw: string) => {
      const code = raw.trim();
      if (!code || disabled) return;
      setBusy(true);
      setNotice(null);
      try {
        const res = await api.post<{
          outcome: string;
          candidate?: Candidate;
          examinations?: Examination[];
          patient?: { name: string; patientCode: string } | null;
        }>("/api/report-custody/scan", { code });
        if (res.outcome === "report" && res.candidate) {
          addCandidate(code, res.candidate);
          return;
        }
        if (res.outcome === "bill" && res.examinations) {
          addExaminations(code, res.examinations);
          const word = res.examinations.filter((e) => e.wordOnly).length;
          setNotice(
            res.examinations.length === 0
              ? `Bill ${code} has no examinations on it, so there is no paper to receive.`
              : `${res.patient?.name ?? "This patient"} — ${res.examinations.length} examination(s) on this bill`
                + (word > 0 ? `. ${word} typed in Word: name the signer, then tick the ones in your hand.` : "")
                + " Nothing is recorded until you confirm.",
          );
        }
      } catch (err) {
        // 422/404 carry the sentence the server chose. Keeping the code on screen
        // is the point: "the same label rejected four times" is a barcode problem,
        // and it disappears if the scan just beeps.
        const message = err instanceof HttpError ? err.message : "Could not reach the server.";
        setItems((prev) =>
          prev.length >= RECEIVE_BATCH_LIMIT
            ? prev
            : [...prev, { localKey: newKey(), code, candidate: null, paperSignedByName: "", include: false, rejection: message }],
        );
        invalidateConfirm();
      } finally {
        setBusy(false);
      }
    }, [addCandidate, addExaminations, disabled]);

    useImperativeHandle(ref, () => ({ scan: (code: string) => { void runScan(code); } }), [runScan]);

    const remove = (localKey: string) => {
      setItems((prev) => prev.filter((it) => it.localKey !== localKey));
      invalidateConfirm();
    };

    const toggle = (localKey: string) => {
      setItems((prev) => prev.map((it) => (it.localKey === localKey ? { ...it, include: !it.include } : it)));
      invalidateConfirm();
    };

    const setSignedBy = (localKey: string, value: string) => {
      setItems((prev) => prev.map((it) => (it.localKey === localKey ? { ...it, paperSignedByName: value } : it)));
      invalidateConfirm();
    };

    const selected = items.filter((it) => it.include && it.candidate && !it.result);
    const blocked = items.filter((it) => it.candidate && !isSelectable(it));
    const unread = items.filter((it) => !it.candidate);
    const patients = new Set(items.map((it) => it.candidate?.patientId).filter(Boolean));
    /** Every paper the clerk has ticked must have a signer named if CARE has no row
     *  for it. This is a completeness check on the form, not a clinical judgement —
     *  the server answers `WORD_REPORT_NOT_REGISTERED` if it is ever bypassed. */
    const missingSigner = selected.filter(
      (it) => it.candidate!.reportId == null && it.paperSignedByName.trim().length === 0,
    ).length;
    const canConfirm = selected.length > 0 && missingSigner === 0;

    const confirm = async () => {
      if (!canConfirm) return;
      if (!requestIdRef.current) requestIdRef.current = newKey();
      setConfirming(true);
      setNotice(null);
      try {
        const res = await api.post<{
          received: number;
          refused: number;
          results: Array<{ rowKey: string; ok: boolean; reason: string; message: string }>;
        }>("/api/report-custody/receive", {
          requestId: requestIdRef.current,
          items: selected.map((it) => ({
            // Two identities, one act: the row when CARE wrote the report, the
            // examination when the paper came out of Word.
            ...(it.candidate!.reportId != null
              ? { reportId: it.candidate!.reportId }
              : {
                  orderTestId: it.candidate!.orderTestId,
                  paperSignedByName: it.paperSignedByName.trim() || null,
                }),
            scannedCode: it.code,
          })),
        });
        const byKey = new Map(res.results.map((r) => [r.rowKey, r]));
        setItems((prev) => prev.map((it) => {
          const r = it.candidate ? byKey.get(it.candidate.rowKey) : undefined;
          return r ? { ...it, result: { ok: r.ok, reason: r.reason, message: r.message } } : it;
        }));
        setDone({ received: res.received, refused: res.refused });
        if (res.refused > 0) {
          const n = res.refused;
          setNotice(
            `${n} ${n === 1 ? "report was" : "reports were"} refused and stayed listed — read the line, `
            + "then remove it or take it back to the reporting desk.",
          );
        }
      } catch (err) {
        setNotice(err instanceof HttpError ? err.message : "Nothing was recorded — the server could not be reached.");
      } finally {
        setConfirming(false);
      }
    };

    const startNewBatch = () => {
      setItems([]);
      setDone(null);
      setNotice(null);
      requestIdRef.current = null;
    };

    return (
      <div className="space-y-3">
        <div className="bg-card border rounded-xl p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${busy ? "bg-amber-400 animate-pulse" : "bg-emerald-500"}`} />
              <div>
                <p className="text-sm font-medium">{busy ? "Reading label…" : "Ready to receive"}</p>
                <p className="text-xs text-muted-foreground">
                  Scan the patient's bill QR to list what it bought, or a report's RPT number for one sheet.
                  Nothing is recorded until you confirm the batch.
                </p>
              </div>
            </div>
            {items.length > 0 && (
              <Button variant="outline" size="sm" onClick={startNewBatch} className="gap-1">
                <Trash2 size={14} /> Discard batch
              </Button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 mt-4 text-center">
            <div className="rounded-lg bg-muted/40 p-2">
              <p className="text-lg font-bold leading-none">{selected.length}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Ticked to receive</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-2">
              <p className={`text-lg font-bold leading-none ${blocked.length + unread.length > 0 ? "text-red-600" : ""}`}>
                {blocked.length + unread.length}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">Cannot receive</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-2">
              <p className="text-lg font-bold leading-none">{patients.size || "—"}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Patients in this batch</p>
            </div>
          </div>

          {notice && (
            <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{notice}</span>
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <div className="border-2 border-dashed rounded-xl p-8 text-center text-muted-foreground bg-muted/10">
            <Inbox size={32} className="mx-auto opacity-30 mb-2" />
            <p className="text-sm font-medium text-foreground">No labels scanned yet</p>
            <p className="text-xs mt-1 max-w-sm mx-auto">
              Scan the bill QR from the receipt. It lists every examination that was bought, and you tick the
              papers that are actually on the counter.
            </p>
          </div>
        ) : (
          <div className="border rounded-xl bg-card divide-y max-h-[52vh] overflow-y-auto">
            {items.map((it) => {
              const c = it.candidate;
              if (!c) {
                return (
                  <div key={it.localKey} className="p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs break-all">{it.code}</p>
                      <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">{it.rejection}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className={VERDICT_TONE.NOT_A_REPORT_CODE}>Unread</Badge>
                      <button onClick={() => remove(it.localKey)} className="text-muted-foreground hover:text-foreground" aria-label="Remove">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              }
              const wordOnly = c.reportId == null;
              const selectable = isSelectable(it);
              const tone = VERDICT_TONE[c.verdict] ?? "bg-gray-100 text-gray-800";
              return (
                <div key={it.localKey} className="p-3 flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={it.include}
                    disabled={!selectable || Boolean(it.result)}
                    onChange={() => toggle(it.localKey)}
                    aria-label={`Receive ${c.reportNumber ?? c.testName}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold">{c.reportNumber ?? "Word report"}</span>
                      {wordOnly && (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">not in CARE</span>
                      )}
                      {c.totalVersions > 1 && (
                        <span className="text-[10px] text-muted-foreground">v{c.revision}/{c.totalVersions}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate">{c.patientLabel}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.testName ?? c.status} · Signed: {c.signedByName ?? "—"}
                    </p>
                    {/* The reason first, then who already did it — a clerk resolving
                        "already received" needs the name without another click. */}
                    <p className="text-xs mt-1">
                      {it.result ? it.result.message : c.message}
                      {c.alreadyReceived && (
                        <span className="text-muted-foreground">
                          {" "}— {c.alreadyReceived.actorName}
                        </span>
                      )}
                    </p>
                    {wordOnly && !it.result && (
                      <div className="mt-2 space-y-1">
                        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <PenLine size={12} />
                          {c.signedByName
                            ? `Signed by ${c.signedByName}, as received by ${c.alreadyReceived?.actorName ?? "the counter"}`
                            : "Who signed this paper? Required before it can be ticked."}
                        </label>
                        <Input
                          value={it.paperSignedByName}
                          maxLength={120}
                          disabled={Boolean(c.signedByName)}
                          onChange={(e) => setSignedBy(it.localKey, e.target.value)}
                          placeholder="e.g. Dr Sugandha Agarwal"
                          aria-label={`Who signed the report for ${c.testName ?? "this examination"}`}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {it.result ? (
                      it.result.ok ? (
                        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 size={14} /> Received
                        </span>
                      ) : (
                        <Badge className={VERDICT_TONE[it.result.reason] ?? tone}>{it.result.reason.replaceAll("_", " ")}</Badge>
                      )
                    ) : (
                      <Badge className={tone}>{c.verdict.replaceAll("_", " ")}</Badge>
                    )}
                    {!it.result && (
                      <button onClick={() => remove(it.localKey)} className="text-muted-foreground hover:text-foreground" aria-label="Remove">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {done ? (
          <div className="rounded-xl border bg-emerald-50/60 dark:bg-emerald-950/20 p-4 space-y-2">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <PackageCheck size={16} />
              {done.received} report{done.received === 1 ? "" : "s"} received at the counter
              {done.refused > 0 ? ` · ${done.refused} refused below` : ""}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={startNewBatch}>Start next batch</Button>
            </div>
          </div>
        ) : (
          <Button
            size="lg"
            className="w-full gap-2"
            onClick={confirm}
            disabled={confirming || !canConfirm}
          >
            {confirming ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
            {selected.length === 0
              ? "Scan the bill QR, then tick the papers on the counter"
              : missingSigner > 0
                ? `Name who signed ${missingSigner} Word report${missingSigner === 1 ? "" : "s"}`
                : `Confirm ${selected.length} report${selected.length === 1 ? "" : "s"} received`}
          </Button>
        )}
      </div>
    );
  },
);
