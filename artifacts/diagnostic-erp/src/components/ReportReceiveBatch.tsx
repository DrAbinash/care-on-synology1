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
 */
import { useCallback, useImperativeHandle, forwardRef, useRef, useState } from "react";
import { api, HttpError } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Trash2, AlertTriangle, PackageCheck, Inbox, Loader2 } from "lucide-react";

/** Mirrors RECEIVE_BATCH_LIMIT in api-server/src/lib/reportCustodyReceive.ts.
 *  A source-contract test asserts the two stay equal; the server's refusal is the
 *  one that binds, this is the one that saves the clerk's list. */
export const RECEIVE_BATCH_LIMIT = 100;

export type ReportReceiveBatchHandle = {
  /** Called by Scan Station's existing scanner capture, and by its manual field. */
  scan: (code: string) => void;
};

type Candidate = {
  reportId: number;
  reportNumber: string;
  patientId: number;
  patientLabel: string;
  testName: string | null;
  status: string;
  signedByName: string | null;
  revision: number;
  totalVersions: number;
  physicalState: string | null;
  billId: number | null;
  verdict: string;
  message: string;
  alreadyReceived: { actorName: string; at: string } | null;
};

type Item = {
  localKey: string;
  code: string;
  /** null while the server is still answering, or when the code meant nothing. */
  candidate: Candidate | null;
  /** The sentence for a code that named no report — kept so the clerk can see
   *  what the scanner actually read. */
  rejection?: string;
  result?: { ok: boolean; reason: string; message: string };
};

const VERDICT_TONE: Record<string, string> = {
  RECEIVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  NOT_SIGNED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  SUPERSEDED_REVISION: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  ALREADY_AT_COUNTER: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  ALREADY_HANDED_OVER: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  REPORT_NOT_FOUND: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  NOT_A_REPORT_CODE: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

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
        // Duplicate: the same report already in the list. Refusing to add it twice
        // is kinder than letting Confirm refuse the second one.
        const clash = prev.find((it) => it.candidate?.reportId === candidate.reportId);
        if (clash) {
          setNotice(`${candidate.reportNumber} is already in this batch.`);
          return prev;
        }
        if (prev.length >= RECEIVE_BATCH_LIMIT) {
          setNotice(`A batch holds at most ${RECEIVE_BATCH_LIMIT} reports. Confirm this one, then start the next.`);
          return prev;
        }
        invalidateConfirm();
        return [...prev, { localKey: newKey(), code, candidate }];
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
          candidates?: Candidate[];
        }>("/api/report-custody/scan", { code });
        if (res.outcome === "report" && res.candidate) {
          addCandidate(code, res.candidate);
        } else if (res.outcome === "bill" && res.candidates) {
          // A bill scan pulls every report billed on it. Each is judged on its own;
          // the clerk still confirms, and nothing is written by the scan.
          setItems((prev) => {
            const fresh = res.candidates!.filter(
              (c) => !prev.some((it) => it.candidate?.reportId === c.reportId),
            );
            if (fresh.length === 0) setNotice(`No new reports on bill ${code}.`);
            invalidateConfirm();
            return [...prev, ...fresh.map((c) => ({ localKey: newKey(), code, candidate: c }))].slice(0, RECEIVE_BATCH_LIMIT);
          });
        }
      } catch (err) {
        // 422/404 carry the sentence the server chose. Keeping the code on screen
        // is the point: "the same label rejected four times" is a barcode problem,
        // and it disappears if the scan just beeps.
        const message = err instanceof HttpError ? err.message : "Could not reach the server.";
        setItems((prev) =>
          prev.length >= RECEIVE_BATCH_LIMIT
            ? prev
            : [...prev, { localKey: newKey(), code, candidate: null, rejection: message }],
        );
        invalidateConfirm();
      } finally {
        setBusy(false);
      }
    }, [addCandidate, disabled]);

    useImperativeHandle(ref, () => ({ scan: (code: string) => { void runScan(code); } }), [runScan]);

    const remove = (localKey: string) => {
      setItems((prev) => prev.filter((it) => it.localKey !== localKey));
      invalidateConfirm();
    };

    const receivable = items.filter((it) => it.candidate?.verdict === "RECEIVED" && !it.result);
    const blocked = items.filter((it) => it.candidate && it.candidate.verdict !== "RECEIVED");
    const unread = items.filter((it) => !it.candidate);
    const patients = new Set(items.map((it) => it.candidate?.patientId).filter(Boolean));

    const confirm = async () => {
      if (receivable.length === 0) return;
      if (!requestIdRef.current) requestIdRef.current = newKey();
      setConfirming(true);
      setNotice(null);
      try {
        const res = await api.post<{
          received: number;
          refused: number;
          results: Array<{ reportId: number; ok: boolean; reason: string; message: string }>;
        }>("/api/report-custody/receive", {
          requestId: requestIdRef.current,
          items: receivable.map((it) => ({ reportId: it.candidate!.reportId, scannedCode: it.code })),
        });
        const byId = new Map(res.results.map((r) => [r.reportId, r]));
        setItems((prev) => prev.map((it) => {
          const r = it.candidate ? byId.get(it.candidate.reportId) : undefined;
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
                  Scan each signed report's label. Nothing is recorded until you confirm the batch.
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
              <p className="text-lg font-bold leading-none">{receivable.length}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Ready to receive</p>
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
              Scan a report label, or type its RPT number in the field above. A bill QR adds every report
              billed on it at once.
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
              const tone = VERDICT_TONE[c.verdict] ?? "bg-gray-100 text-gray-800";
              return (
                <div key={it.localKey} className="p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold">{c.reportNumber}</span>
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
            disabled={confirming || receivable.length === 0}
          >
            {confirming ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
            {receivable.length === 0
              ? "Scan a report to begin"
              : `Confirm ${receivable.length} report${receivable.length === 1 ? "" : "s"} received`}
          </Button>
        )}
      </div>
    );
  },
);
