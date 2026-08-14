/**
 * PurchaseInvoiceScannerPanel.tsx — scan a supplier invoice (photo/upload,
 * image or PDF), review the OCR-extracted header + line items (each
 * fuzzy-matched against the inventory catalog server-side), then post it as
 * stock-in. Mirrors BillReceiptScannerPanel.tsx's scan-then-review-then-save
 * shape, but for a multi-line invoice instead of a single expense amount —
 * so the middle step is a line-item table with a catalog-match picker per
 * row instead of a handful of flat fields.
 *
 * Nothing is written to the database until "Save as Draft"; nothing affects
 * stock until "Post to Stock" — matching the backend's draft -> posted split
 * (routes/purchaseInvoices.ts) so staff can review before either commitment.
 */
import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import DocumentScanCapture from "@/components/DocumentScanCapture";
import { CheckCircle2, AlertTriangle, Trash2, WifiOff } from "lucide-react";
import { parseInvoiceText } from "@/lib/invoiceTextParser";
import { recognizeDocumentText } from "@/lib/tesseractDocumentOcr";

type Vendor = { id: number; name: string; code: string; isActive: boolean };
type CatalogItem = { id: number; name: string; unit: string; isActive: boolean };

interface ScanLineItem {
  descriptionRaw: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
  suggestedItemId: number | null;
  suggestedItemName: string | null;
  matchConfidence: number;
}

interface ScanResult {
  vendor: string;
  vendorId: number | null;
  invoiceNumber: string;
  date: string;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  confidence: "high" | "medium" | "low";
  confidencePercent: number;
  lineItems: ScanLineItem[];
  blurScore: number;
  isBlurred: boolean;
  tesseractFallbackSuggested?: boolean;
}

interface DraftLine {
  itemId: number | null;
  descriptionRaw: string;
  matchConfidence: number | null;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

interface Draft {
  vendorId: number | null;
  invoiceNumber: string;
  invoiceDate: string;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  ocrConfidence: "high" | "medium" | "low";
  ocrConfidencePercent: number;
  lineItems: DraftLine[];
}

export default function PurchaseInvoiceScannerPanel() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sourceImage, setSourceImage] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [savedInvoiceId, setSavedInvoiceId] = useState<number | null>(null);
  const [postResult, setPostResult] = useState<{ posted: number[]; skipped: { descriptionRaw: string; reason: string }[] } | null>(null);
  const [error, setError] = useState("");
  // Offline (Tesseract.js) scan — runs OCR entirely in the browser (no Gemini/
  // cloud call for the extraction itself), then only hits the server for
  // catalog matching (which needs the live DB catalog regardless of OCR engine).
  const [offlineScanning, setOfflineScanning] = useState(false);
  const [offlineProgress, setOfflineProgress] = useState("");
  const offlineFileRef = useRef<HTMLInputElement>(null);

  const { data: vendors = [] } = useQuery<Vendor[]>({ queryKey: ["vendors-for-invoice-scan"], queryFn: () => api.get("/api/vendors") });
  const { data: items = [] } = useQuery<CatalogItem[]>({ queryKey: ["inventory-items-for-invoice-scan"], queryFn: () => api.get("/api/inventory") });
  const activeItems = items.filter((i) => i.isActive);

  const reset = useCallback(() => {
    setDraft(null); setSourceImage(""); setSavedInvoiceId(null); setPostResult(null); setError("");
  }, []);

  // "Discard" after a draft was already saved must cancel it server-side too
  // — otherwise it's silently left as an orphaned open draft the staff can
  // never see again (there's no draft-list UI in v1). Before saving, there's
  // nothing server-side yet, so it's just a local reset.
  const discard = async () => {
    if (savedInvoiceId) {
      try { await api.post(`/api/purchase-invoices/${savedInvoiceId}/cancel`, {}); } catch { /* best-effort */ }
    }
    reset();
  };

  const handleScanResult = (result: ScanResult) => {
    setDraft({
      vendorId: result.vendorId,
      invoiceNumber: result.invoiceNumber,
      invoiceDate: result.date,
      subtotal: result.subtotal,
      gstAmount: result.gstAmount,
      totalAmount: result.totalAmount,
      ocrConfidence: result.confidence,
      ocrConfidencePercent: result.confidencePercent,
      lineItems: result.lineItems.map((li) => ({
        itemId: li.suggestedItemId,
        descriptionRaw: li.descriptionRaw,
        matchConfidence: li.matchConfidence,
        quantity: li.quantity,
        unitCost: li.unitCost,
        lineTotal: li.lineTotal,
      })),
    });
  };

  // ── Offline scan: Tesseract.js runs entirely client-side. Assets
  // (worker/core/traineddata) are served from this app's own /tesseract/
  // origin — not tesseract.js's CDN defaults — so this genuinely has no
  // internet dependency at scan time, not just an aspirational claim.
  const OFFLINE_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const OFFLINE_MAX_BYTES = 15 * 1024 * 1024;

  /** Plain Tesseract does no EXIF-orientation correction, so a phone photo
   *  taken in portrait (which carries an orientation flag rather than
   *  physically rotated pixels) gets OCR'd sideways — same real-world issue
   *  IdCardScanPanel.tsx's loadOrientedImage() already fixes for camera
   *  captures. Draws through createImageBitmap({ imageOrientation:
   *  "from-image" }) onto a canvas Tesseract can read upright; returns null
   *  (caller falls back to the raw File) if the browser can't decode it. */
  async function loadOrientedCanvas(file: File): Promise<HTMLCanvasElement | null> {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0);
      return canvas;
    } catch {
      return null;
    }
  }

  const scanOffline = async (file: File) => {
    setError("");
    if (!OFFLINE_ACCEPTED_TYPES.includes(file.type)) {
      // The input's `accept` attribute is advisory only — some file pickers
      // let staff override it (e.g. an "All Files" toggle) — so a PDF or
      // other non-image can still reach here. Tesseract only reads raster
      // images, so fail with a clear message instead of a low-level error.
      setError("Offline scan only supports JPG, PNG, or WebP images (no PDF) — use the AI scan above for PDFs.");
      return;
    }
    if (file.size > OFFLINE_MAX_BYTES) {
      setError(`Image too large for offline scan. Maximum ${OFFLINE_MAX_BYTES / (1024 * 1024)} MB.`);
      return;
    }

    setOfflineScanning(true); setOfflineProgress("Loading OCR engine…");
    // Tracked outside the try block so a failure anywhere after the worker
    // is created (recognize(), or even an error thrown before this
    // function's own try/catch is reached) still gets torn down in
    // `finally` — otherwise a failed scan leaks a live Web Worker + loaded
    // WASM module every time staff retries after an error.
    let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
    try {
      const { createWorker } = await import("tesseract.js");
      worker = await createWorker("eng", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/tesseract-core.wasm.js",
        langPath: "/tesseract",
        cachePath: "/tesseract",
        gzip: true,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") setOfflineProgress(`Reading text… ${Math.round(m.progress * 100)}%`);
        },
      });
      const oriented = await loadOrientedCanvas(file);
      const { data } = await worker.recognize(oriented ?? file);

      const parsed = parseInvoiceText(data.text);
      if (parsed.lineItems.length === 0 && !parsed.invoiceNumber && !parsed.totalAmount) {
        setError("Couldn't read this invoice offline — try the AI scan above, or a clearer / higher-contrast photo.");
        return;
      }

      setOfflineProgress("Matching line items to your catalog…");
      const match = await api.post<{ vendorId: number | null; lineItems: ScanLineItem[] }>("/api/purchase-invoices/match-lines", {
        vendor: parsed.vendor,
        lineItems: parsed.lineItems.map((li) => ({ description: li.description, quantity: li.quantity, unitCost: li.unitCost, lineTotal: li.lineTotal })),
      });

      const reader = new FileReader();
      reader.onload = (e) => setSourceImage(e.target?.result as string);
      reader.readAsDataURL(file);

      handleScanResult({
        vendor: parsed.vendor,
        vendorId: match.vendorId,
        invoiceNumber: parsed.invoiceNumber,
        date: parsed.date,
        subtotal: parsed.subtotal,
        gstAmount: parsed.gstAmount,
        totalAmount: parsed.totalAmount,
        // Offline text parsing has no self-assessed confidence the way a
        // vision model does — always tag it "low" so staff review every
        // field rather than trusting a heuristic regex parse at face value.
        confidence: "low",
        confidencePercent: 0,
        lineItems: match.lineItems,
        blurScore: 0,
        isBlurred: false,
      });
    } catch (e: unknown) {
      setError((e as Error).message || "Offline scan failed");
    } finally {
      if (worker) { try { await worker.terminate(); } catch { /* best-effort cleanup */ } }
      setOfflineScanning(false); setOfflineProgress("");
    }
  };

  const updateLine = (idx: number, patch: Partial<DraftLine>) => {
    setDraft((d) => d ? { ...d, lineItems: d.lineItems.map((l, i) => (i === idx ? { ...l, ...patch } : l)) } : d);
  };
  const removeLine = (idx: number) => {
    setDraft((d) => d ? { ...d, lineItems: d.lineItems.filter((_, i) => i !== idx) } : d);
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.invoiceNumber.trim()) { setError("Invoice number is required."); return; }
    if (draft.lineItems.length === 0) { setError("Add at least one line item."); return; }
    setSaving(true); setError("");
    try {
      const res = await api.post<{ invoice: { id: number } }>("/api/purchase-invoices", {
        invoiceNumber: draft.invoiceNumber,
        invoiceDate: draft.invoiceDate || undefined,
        vendorId: draft.vendorId ?? undefined,
        subtotal: draft.subtotal,
        gstAmount: draft.gstAmount,
        totalAmount: draft.totalAmount,
        sourceImageUrl: sourceImage || undefined,
        ocrConfidence: draft.ocrConfidence,
        ocrConfidencePercent: draft.ocrConfidencePercent,
        lineItems: draft.lineItems.map((l) => ({
          itemId: l.itemId ?? undefined,
          descriptionRaw: l.descriptionRaw,
          matchConfidence: l.matchConfidence ?? undefined,
          quantity: l.quantity,
          unitCost: l.unitCost,
          lineTotal: l.lineTotal,
        })),
      });
      setSavedInvoiceId(res.invoice.id);
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to save invoice");
    } finally {
      setSaving(false);
    }
  };

  const postInvoice = async () => {
    if (!savedInvoiceId) return;
    setPosting(true); setError("");
    try {
      const res = await api.post<{ posted: number[]; skipped: { descriptionRaw: string; reason: string }[] }>(`/api/purchase-invoices/${savedInvoiceId}/post`, {});
      setPostResult(res);
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["inventory-low"] });
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to post invoice");
    } finally {
      setPosting(false);
    }
  };

  const matchedCount = draft?.lineItems.filter((l) => l.itemId).length ?? 0;
  const unmatchedCount = (draft?.lineItems.length ?? 0) - matchedCount;
  // Once saved as a draft, further local edits wouldn't reach the server-side
  // row that "Post to Stock" actually reads — lock the form so what's on
  // screen can't silently diverge from what gets posted.
  const locked = savedInvoiceId != null;

  if (postResult) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center space-y-3">
        <CheckCircle2 size={40} className="text-green-500 mx-auto" />
        <p className="font-bold text-green-800">Invoice posted — {postResult.posted.length} line{postResult.posted.length === 1 ? "" : "s"} added to stock.</p>
        {postResult.skipped.length > 0 && (
          <div className="text-left bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 max-w-md mx-auto">
            <p className="font-semibold mb-1">{postResult.skipped.length} line{postResult.skipped.length === 1 ? "" : "s"} skipped — post these via the ordinary Stock In form:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {postResult.skipped.map((s, i) => <li key={i}>{s.descriptionRaw} — {s.reason}</li>)}
            </ul>
          </div>
        )}
        <Button onClick={reset} variant="outline">Scan Another Invoice</Button>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="space-y-3">
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
          <h3 className="font-semibold">Scan Supplier Invoice</h3>
          <p className="text-xs text-muted-foreground">Photograph or upload the invoice (image or PDF) — vendor, invoice#, date, total, and every line item will be extracted and matched against your catalog for review before anything is saved.</p>
          <DocumentScanCapture<ScanResult>
            endpoint="/api/purchase-invoices/scan"
            triggerLabel="Scan Invoice with AI"
            editorTitle="Purchase Invoice"
            docType="document"
            helperText="Ollama on this clinic reads the invoice; Tesseract is used if Ollama is down. Review before saving."
            onImage={(b64, mime) => setSourceImage(`data:${mime};base64,${b64}`)}
            onResult={handleScanResult}
            onError={setError}
            tesseractFallback={async (b64, mime) => {
              const text = await recognizeDocumentText(b64, mime);
              const parsed = parseInvoiceText(text);
              if (parsed.lineItems.length === 0 && !parsed.invoiceNumber && !parsed.totalAmount) return null;
              const match = await api.post<{ vendorId: number | null; lineItems: ScanLineItem[] }>("/api/purchase-invoices/match-lines", {
                vendor: parsed.vendor,
                lineItems: parsed.lineItems.map((li) => ({
                  description: li.description,
                  quantity: li.quantity,
                  unitCost: li.unitCost,
                  lineTotal: li.lineTotal,
                })),
              });
              return {
                vendor: parsed.vendor,
                vendorId: match.vendorId,
                invoiceNumber: parsed.invoiceNumber,
                date: parsed.date,
                subtotal: parsed.subtotal,
                gstAmount: parsed.gstAmount,
                totalAmount: parsed.totalAmount,
                confidence: "low",
                confidencePercent: 0,
                lineItems: match.lineItems,
                blurScore: 0,
                isBlurred: false,
              };
            }}
          />

          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <WifiOff size={13} className="text-muted-foreground" />
              <p className="text-xs font-medium">No internet or AI provider configured?</p>
            </div>
            <p className="text-xs text-muted-foreground">Runs fully offline in your browser (Tesseract) — no cloud call, but less reliable at reading line items than the AI scan above. Image only, no PDF.</p>
            <Button
              variant="outline" size="sm" disabled={offlineScanning}
              onClick={() => offlineFileRef.current?.click()}
            >
              {offlineScanning ? (offlineProgress || "Scanning…") : "Scan Offline (No Cloud)"}
            </Button>
            <input
              ref={offlineFileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void scanOffline(f); e.target.value = ""; }}
            />
          </div>

          {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded p-2">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {draft.ocrConfidencePercent < 80 && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 flex items-center gap-1.5">
          <AlertTriangle size={13} /> Low OCR confidence ({draft.ocrConfidencePercent}%) — verify every field and line item against the original invoice before saving.
        </p>
      )}

      <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
        <h3 className="font-semibold">Invoice Details</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Vendor</Label>
            <select
              className="mt-1 h-9 w-full border border-input rounded-md px-2 text-sm bg-background disabled:opacity-60"
              value={draft.vendorId ?? ""}
              disabled={locked}
              onChange={(e) => setDraft({ ...draft, vendorId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Select vendor…</option>
              {vendors.filter((v) => v.isActive).map((v) => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
            </select>
          </div>
          <div><Label className="text-xs">Invoice #</Label><Input className="mt-1 h-9" value={draft.invoiceNumber} disabled={locked} onChange={(e) => setDraft({ ...draft, invoiceNumber: e.target.value })} /></div>
          <div><Label className="text-xs">Date</Label><Input className="mt-1 h-9" type="date" value={draft.invoiceDate} disabled={locked} onChange={(e) => setDraft({ ...draft, invoiceDate: e.target.value })} /></div>
          <div><Label className="text-xs">Total (₹)</Label><Input className="mt-1 h-9" type="number" step="0.01" value={draft.totalAmount} disabled={locked} onChange={(e) => setDraft({ ...draft, totalAmount: Number(e.target.value) })} /></div>
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Line Items ({draft.lineItems.length})</h3>
          <p className="text-xs text-muted-foreground">{matchedCount} matched to catalog{unmatchedCount > 0 ? `, ${unmatchedCount} need a manual pick` : ""}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="pb-2 pr-2">Invoice Description</th>
                <th className="pb-2 pr-2">Catalog Item</th>
                <th className="pb-2 pr-2 w-24">Qty</th>
                <th className="pb-2 pr-2 w-28">Unit Cost</th>
                <th className="pb-2 pr-2 w-28">Line Total</th>
                <th className="pb-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {draft.lineItems.map((line, idx) => (
                <tr key={idx} className="border-b border-border/50">
                  <td className="py-2 pr-2 align-top">
                    <p>{line.descriptionRaw}</p>
                    {line.itemId && line.matchConfidence != null && (
                      <span className={`text-[10px] ${line.matchConfidence >= 85 ? "text-green-600" : "text-amber-600"}`}>
                        {line.matchConfidence}% match
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2 align-top">
                    <select
                      className={`h-9 w-full border rounded-md px-2 text-sm bg-background disabled:opacity-60 ${line.itemId ? "border-input" : "border-amber-300 bg-amber-50"}`}
                      value={line.itemId ?? ""}
                      disabled={locked}
                      onChange={(e) => updateLine(idx, { itemId: e.target.value ? Number(e.target.value) : null, matchConfidence: null })}
                    >
                      <option value="">Not matched — pick one</option>
                      {activeItems.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>)}
                    </select>
                  </td>
                  <td className="py-2 pr-2 align-top"><Input className="h-9" type="number" step="any" value={line.quantity} disabled={locked} onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) })} /></td>
                  <td className="py-2 pr-2 align-top"><Input className="h-9" type="number" step="0.01" value={line.unitCost} disabled={locked} onChange={(e) => updateLine(idx, { unitCost: Number(e.target.value) })} /></td>
                  <td className="py-2 pr-2 align-top"><Input className="h-9" type="number" step="0.01" value={line.lineTotal} disabled={locked} onChange={(e) => updateLine(idx, { lineTotal: Number(e.target.value) })} /></td>
                  <td className="py-2 align-top">
                    <button type="button" onClick={() => removeLine(idx)} disabled={locked} className="text-muted-foreground hover:text-red-500 disabled:opacity-40 disabled:hover:text-muted-foreground" title="Remove line">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {unmatchedCount > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            {unmatchedCount} line{unmatchedCount === 1 ? "" : "s"} not matched to a catalog item — pick one above, or leave unmatched to skip it when posting (it won't affect stock, and can be entered later via the ordinary Stock In form).
          </p>
        )}
      </div>

      {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded p-2">{error}</p>}

      <div className="flex gap-2">
        <Button variant="outline" onClick={discard}>Discard</Button>
        {!savedInvoiceId ? (
          <Button onClick={saveDraft} disabled={saving} className="flex-1">{saving ? "Saving…" : "Save as Draft"}</Button>
        ) : (
          <Button onClick={postInvoice} disabled={posting} className="flex-1">{posting ? "Posting…" : `Post to Stock (${matchedCount} line${matchedCount === 1 ? "" : "s"})`}</Button>
        )}
      </div>
      {savedInvoiceId && (
        <p className="text-xs text-muted-foreground">Draft saved (invoice #{savedInvoiceId}). No stock changes yet — click "Post to Stock" to receive the matched lines.</p>
      )}
    </div>
  );
}
