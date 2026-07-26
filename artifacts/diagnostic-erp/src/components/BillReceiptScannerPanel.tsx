import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, ScanLine, Upload, X, CheckCircle2, FileText } from "lucide-react";
import IdCardScanPanel from "@/components/IdCardScanPanel";

type BillOcrResult = {
  vendor: string; date: string; amount: number; gstAmount: number;
  category: string; description: string; paymentMode: string;
  confidence: "high" | "medium" | "low";
  confidencePercent?: number;
};

// Same tiering convention as Form F's ID-card OCR (ocrConfidenceTier in
// pages/FormF.tsx): >=95% high-trust, 80-94% needs a closer look, <80%
// should be treated as a starting point only. Unlike Form F, every field
// here already requires an explicit "Save to Expense Ledger" click before
// touching the actual ledger — nothing auto-commits at any tier — so this
// tiering only drives the visual warning, not a separate auto-fill gate.
function billConfidenceTier(confidencePercent: number | undefined): "auto" | "confirm" | "manual" {
  const pct = confidencePercent ?? 0;
  if (pct >= 95) return "auto";
  if (pct >= 80) return "confirm";
  return "manual";
}

const EXPENSE_CATEGORIES = [
  "Salaries", "Rent", "Utilities", "Office Supplies", "Medical Supplies",
  "Lab Reagents", "Equipment", "Maintenance", "Travel", "Food",
  "Marketing", "Professional Fees", "Taxes", "Insurance", "Miscellaneous",
];

// Shared Bill / Receipt Scanner panel — used by both the Accounting
// "Scan & Import" tab and the Expenses "Bill/Receipt Scanner" tab.
export default function BillReceiptScannerPanel() {
  const [preview, setPreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState("");
  const [mimeType, setMimeType] = useState("image/jpeg");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<BillOcrResult | null>(null);
  const [draft, setDraft] = useState<BillOcrResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  // Captured image awaiting the crop/enhance editor before it becomes the scan input.
  const [editing, setEditing] = useState<{ base64: string; mimeType: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const handleFile = useCallback((file: File) => {
    setError(""); setResult(null); setDraft(null); setSaved(false);
    const mt = file.type || "image/jpeg";
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const base64 = dataUrl.split(",")[1] ?? "";
      if (mt === "application/pdf") {
        // The crop/enhance editor is canvas-based and can't decode PDF bytes
        // as an image — send it straight through to OCR instead.
        setMimeType(mt);
        setImageBase64(base64);
        setPreview(dataUrl);
        return;
      }
      // Open the crop/enhance editor first — the enhanced image scans far better.
      setEditing({ base64, mimeType: mt });
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const scan = async () => {
    if (!imageBase64) return;
    setScanning(true); setError("");
    try {
      const data = await api.post<BillOcrResult>("/api/expenses/scan-bill", { imageBase64, mimeType });
      setResult(data);
      setDraft({ ...data });
    } catch (e: unknown) {
      setError((e as Error).message || "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const saveExpense = async () => {
    if (!draft) return;
    setSaving(true); setError("");
    try {
      await api.post("/api/expenses", {
        category: draft.category,
        description: draft.description || draft.vendor || "Scanned bill",
        amount: draft.amount,
        expenseDate: draft.date || new Date().toISOString().slice(0, 10),
        paymentMode: draft.paymentMode || "cash",
        paidTo: draft.vendor || undefined,
        notes: draft.gstAmount > 0 ? `GST: ₹${draft.gstAmount}` : undefined,
        // Keep the scanned (enhanced) bill image for audit.
        receiptImageUrl: preview || undefined,
      });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      setSaved(true);
    } catch (e: unknown) {
      setError((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setPreview(null); setImageBase64(""); setResult(null); setDraft(null);
    setSaved(false); setError(""); setScanning(false);
  };

  const confidenceColor = (c: string) => c === "high" ? "text-green-600" : c === "medium" ? "text-amber-600" : "text-red-500";

  return (
    <>
    {editing && (
      <IdCardScanPanel
        imageBase64={editing.base64}
        mimeType={editing.mimeType}
        docType="receipt"
        title="Bill / Receipt"
        onSave={(r) => {
          const enhanced = r.enhancedBase64 || r.croppedBase64 || r.originalBase64;
          setMimeType("image/jpeg");
          setImageBase64(enhanced);
          setPreview(`data:image/jpeg;base64,${enhanced}`);
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    )}
    <div className="grid md:grid-cols-2 gap-6">
      {/* Left — upload / camera */}
      <div className="space-y-3">
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
          <h3 className="font-semibold flex items-center gap-2"><Camera size={15} /> Capture Bill Image</h3>
          <p className="text-xs text-muted-foreground">Take a photo on your mobile or upload an existing file. Supports JPG, PNG, WebP, HEIC, PDF.</p>

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="relative border-2 border-dashed border-card-border rounded-xl overflow-hidden cursor-pointer hover:border-primary transition-colors"
            style={{ minHeight: 200 }}
          >
            {preview ? (
              <>
                {preview.startsWith("data:image") ? (
                  <img src={preview} alt="Bill preview" className="w-full object-contain max-h-72" />
                ) : (
                  <div className="flex items-center justify-center gap-2 h-52 text-muted-foreground">
                    <FileText size={24} /> <span className="text-sm">PDF ready for scanning</span>
                  </div>
                )}
                <button onClick={e => { e.stopPropagation(); reset(); }} className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1">
                  <X size={14} />
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-52 gap-3 text-muted-foreground">
                <Upload size={32} className="opacity-40" />
                <div className="text-center text-sm">
                  <p className="font-medium">Drag &amp; drop or click to upload</p>
                  <p className="text-xs mt-1">Or use your phone camera to take a photo</p>
                </div>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
            capture="environment"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => fileRef.current?.click()} disabled={scanning}>
              <Upload size={14} className="mr-1" /> Upload
            </Button>
            <Button className="flex-1" onClick={scan} disabled={!imageBase64 || scanning}>
              <ScanLine size={14} className="mr-1" /> {scanning ? "Scanning…" : "Scan with AI"}
            </Button>
          </div>
          {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded p-2">{error}</p>}
        </div>

        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-xs text-blue-800 dark:text-blue-300 space-y-1">
          <p className="font-semibold">Tips for best results</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>Place the bill on a flat, well-lit surface</li>
            <li>Ensure all four corners of the bill are visible</li>
            <li>Avoid glare and shadows on the text</li>
            <li>Printed invoices work better than handwritten ones</li>
          </ul>
        </div>
      </div>

      {/* Right — extracted data */}
      <div className="space-y-3">
        {saved ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center space-y-3">
            <CheckCircle2 size={40} className="text-green-500 mx-auto" />
            <p className="font-bold text-green-800">Expense Saved!</p>
            <p className="text-sm text-green-700">The expense has been added to your records.</p>
            <Button onClick={reset} variant="outline">Scan Another Bill</Button>
          </div>
        ) : draft ? (
          <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2"><CheckCircle2 size={15} className="text-green-500" /> Extracted Data</h3>
              <span className={`text-xs font-semibold ${confidenceColor(draft.confidence)}`}>
                {draft.confidencePercent != null ? `${draft.confidencePercent}%` : draft.confidence.toUpperCase()} confidence
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Review and edit the extracted fields before saving to expenses.</p>
            {billConfidenceTier(draft.confidencePercent) === "manual" && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                Low OCR confidence — verify every field against the original bill before saving, don't rely on this extraction as-is.
              </p>
            )}

            <div className="grid gap-3">
              <div>
                <Label className="text-xs">Vendor / Supplier</Label>
                <Input className="mt-1 h-8 text-sm" value={draft.vendor} onChange={e => setDraft({ ...draft, vendor: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Date</Label>
                  <Input className="mt-1 h-8 text-sm" type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Total Amount (₹)</Label>
                  <Input className="mt-1 h-8 text-sm" type="number" step="0.01" value={draft.amount} onChange={e => setDraft({ ...draft, amount: Number(e.target.value) })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">GST Amount (₹)</Label>
                  <Input className="mt-1 h-8 text-sm" type="number" step="0.01" value={draft.gstAmount} onChange={e => setDraft({ ...draft, gstAmount: Number(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Payment Mode</Label>
                  <select className="mt-1 h-8 text-sm w-full border border-input rounded-md px-2 bg-background" value={draft.paymentMode} onChange={e => setDraft({ ...draft, paymentMode: e.target.value })}>
                    {["cash", "card", "upi", "cheque", "other"].map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Category</Label>
                <select className="mt-1 h-8 text-sm w-full border border-input rounded-md px-2 bg-background" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Input className="mt-1 h-8 text-sm" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} />
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={reset} className="flex-1">Clear</Button>
              <Button onClick={saveExpense} disabled={saving} className="flex-1">
                {saving ? "Saving…" : "Save to Expense Ledger"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-card border border-dashed border-card-border rounded-xl p-10 text-center text-muted-foreground space-y-2">
            <ScanLine size={36} className="mx-auto opacity-30" />
            <p className="text-sm font-medium">Upload a bill image and click Scan</p>
            <p className="text-xs">AI will extract vendor, date, amount, GST, and category automatically.</p>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
