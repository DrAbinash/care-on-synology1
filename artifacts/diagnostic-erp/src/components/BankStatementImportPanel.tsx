/**
 * Bank statement import — CSV/text paste or JPEG/PDF scan with Ollama
 * (Tesseract fallback). Shared by Accounting and Banking.
 */
import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import IdCardScanPanel from "@/components/IdCardScanPanel";
import UnifiedScanCapture, { type ScanCaptureResult } from "@/components/UnifiedScanCapture";
import { blobToScanBase64 } from "@/lib/documentScanApi";
import { recognizeDocumentText } from "@/lib/tesseractDocumentOcr";
import { parseBankStatementText } from "@/lib/bankStatementTextParser";
import { Banknote, Camera, CheckCircle2, Download, FileText, ScanLine, Upload } from "lucide-react";

export type LedgerAccount = { id: number; name: string; type: string };

type BankTxn = {
  date: string; description: string; debit: number; credit: number;
  balance: number; reference: string; selected: boolean;
};

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

export default function BankStatementImportPanel({
  accounts,
  onImported,
}: {
  accounts: LedgerAccount[];
  onImported: () => void;
}) {
  const [inputMode, setInputMode] = useState<"text" | "image">("image");
  const [csvText, setCsvText] = useState("");
  const [imageBase64, setImageBase64] = useState("");
  const [imageMime, setImageMime] = useState("image/jpeg");
  const [imagePreview, setImagePreview] = useState("");
  const [parsing, setParsing] = useState(false);
  const [txns, setTxns] = useState<BankTxn[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [contraAccountId, setContraAccountId] = useState("");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(0);
  const [skippedDuplicates, setSkippedDuplicates] = useState(0);
  const [error, setError] = useState("");
  const [isBlurred, setIsBlurred] = useState(false);
  const [editing, setEditing] = useState<{ base64: string; mimeType: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const bankAccounts = accounts.filter((a) => a.type === "bank" || a.type === "cash");
  const expenseAccounts = accounts.filter(
    (a) => a.type === "expense" || a.type === "income" || a.type === "asset" || a.type === "liability",
  );

  const ingestImage = useCallback((base64: string, mt: string) => {
    setError(""); setTxns([]); setImported(0); setSkippedDuplicates(0); setIsBlurred(false);
    if (!ACCEPTED.includes(mt) && mt !== "image/jpg") {
      setError("Unsupported file type. Use JPEG, PNG, WebP, HEIC, or PDF.");
      return;
    }
    if (mt === "application/pdf") {
      setImageMime(mt);
      setImageBase64(base64);
      setImagePreview(`data:application/pdf;base64,${base64}`);
      return;
    }
    setEditing({ base64, mimeType: mt || "image/jpeg" });
  }, []);

  const handleImageFile = (file: File) => {
    const mt = file.type || "image/jpeg";
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = String(e.target?.result ?? "");
      ingestImage(dataUrl.split(",")[1] ?? "", mt);
    };
    reader.readAsDataURL(file);
  };

  const handleUnifiedCapture = async (cap: ScanCaptureResult) => {
    const mt = cap.mimeType || cap.file.type || "image/jpeg";
    const base64 = await blobToScanBase64(cap.file);
    if (base64) ingestImage(base64, mt);
  };

  const parse = async (override?: { imageBase64: string; mimeType: string }) => {
    setParsing(true); setError(""); setTxns([]); setImported(0); setSkippedDuplicates(0); setIsBlurred(false);
    try {
      const b64 = override?.imageBase64 ?? imageBase64;
      const mt = override?.mimeType ?? imageMime;
      const payload =
        inputMode === "text"
          ? { text: csvText }
          : { imageBase64: b64, mimeType: mt };
      const data = await api.post<{
        transactions: Omit<BankTxn, "selected">[];
        isBlurred?: boolean;
        tesseractFallbackSuggested?: boolean;
        geminiFallbackAvailable?: boolean;
      }>("/api/accounting/bank-statement/parse", payload);
      setIsBlurred(Boolean(data.isBlurred));
      let rows = (data.transactions ?? []).map((t) => ({ ...t, selected: true }));
      if (rows.length === 0 && data.tesseractFallbackSuggested && inputMode === "image" && b64) {
        const text = await recognizeDocumentText(b64, mt);
        rows = parseBankStatementText(text).map((t) => ({ ...t, selected: true }));
      }
      if (rows.length === 0 && data.geminiFallbackAvailable) {
        const gem = await api.post<{ transactions: Omit<BankTxn, "selected">[] }>(
          "/api/accounting/bank-statement/parse",
          { ...payload, useGeminiFallback: true },
        );
        rows = (gem.transactions ?? []).map((t) => ({ ...t, selected: true }));
      }
      setTxns(rows);
      if (rows.length === 0) {
        setError("No transactions found. Try a clearer JPEG, crop to the statement table, or paste CSV instead.");
      }
    } catch (e: unknown) {
      if (inputMode === "image" && b64) {
        try {
          const text = await recognizeDocumentText(b64, mt);
          const rows = parseBankStatementText(text).map((t) => ({ ...t, selected: true }));
          if (rows.length > 0) {
            setTxns(rows);
            return;
          }
        } catch { /* ignore */ }
      }
      setError((e as Error).message || "Parsing failed");
    } finally {
      setParsing(false);
    }
  };

  const toggleAll = (v: boolean) => setTxns((ts) => ts.map((t) => ({ ...t, selected: v })));

  const importTxns = async () => {
    if (!bankAccountId || !contraAccountId) { setError("Select both accounts before importing."); return; }
    setImporting(true); setError("");
    try {
      const data = await api.post<{ imported: number; skippedDuplicates?: number }>("/api/accounting/bank-statement/import", {
        bankAccountId: Number(bankAccountId),
        contraAccountId: Number(contraAccountId),
        transactions: txns,
      });
      setImported(data.imported);
      setSkippedDuplicates(data.skippedDuplicates ?? 0);
      onImported();
      setTxns([]);
    } catch (e: unknown) {
      setError((e as Error).message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const inr = (n: number) => n === 0 ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const selectedCount = txns.filter((t) => t.selected).length;

  return (
    <div className="space-y-4">
      {editing && (
        <IdCardScanPanel
          imageBase64={editing.base64}
          mimeType={editing.mimeType}
          docType="document"
          title="Bank Statement"
          onSave={(r) => {
            const enhanced = r.enhancedBase64 || r.croppedBase64 || r.originalBase64;
            setImageMime("image/jpeg");
            setImageBase64(enhanced);
            setImagePreview(`data:image/jpeg;base64,${enhanced}`);
            setEditing(null);
            setInputMode("image");
            void parse({ imageBase64: enhanced, mimeType: "image/jpeg" });
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {(imported > 0 || skippedDuplicates > 0) && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-green-500 shrink-0" />
          <div>
            <p className="font-semibold text-green-800">
              {imported > 0 ? `${imported} transaction${imported === 1 ? "" : "s"} imported successfully!` : "No new transactions imported."}
            </p>
            <p className="text-sm text-green-700">
              {imported > 0 && "They have been added to the vouchers ledger."}
              {skippedDuplicates > 0 && (imported > 0 ? " " : "") + `${skippedDuplicates} row${skippedDuplicates === 1 ? "" : "s"} skipped — already imported for this bank account (matched by date, amount, and reference/description).`}
            </p>
          </div>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => { setImported(0); setSkippedDuplicates(0); }}>Import More</Button>
        </div>
      )}

      {imported === 0 && (
        <>
          <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2"><Banknote size={15} /> Upload Bank Statement</h3>
              <div className="flex gap-1 text-xs">
                <button type="button" onClick={() => setInputMode("text")} className={`px-3 py-1 rounded-md border transition-colors ${inputMode === "text" ? "bg-primary text-primary-foreground border-primary" : "border-card-border hover:bg-accent"}`}>
                  CSV / Text
                </button>
                <button type="button" onClick={() => setInputMode("image")} className={`px-3 py-1 rounded-md border transition-colors ${inputMode === "image" ? "bg-primary text-primary-foreground border-primary" : "border-card-border hover:bg-accent"}`}>
                  JPEG / PDF scan
                </button>
              </div>
            </div>

            {inputMode === "text" ? (
              <div className="space-y-2">
                <Label className="text-xs">Paste CSV or copied statement text</Label>
                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  className="w-full border border-input rounded-lg p-3 text-xs font-mono bg-muted/30 resize-y"
                  rows={8}
                  placeholder={"Date,Description,Debit,Credit,Balance\n01-05-2026,Opening Balance,,,50000\n02-05-2026,NEFT Transfer Out,5000,,45000\n03-05-2026,Salary Credit,,20000,65000"}
                />
                <p className="text-xs text-muted-foreground">Supports CSV, tab-separated, or any standard Indian bank statement format. You can also paste directly from Excel or a PDF viewer.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs">Scan or upload a statement (JPEG, PNG, HEIC, or PDF)</Label>
                <div
                  onClick={() => fileRef.current?.click()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImageFile(f); }}
                  onDragOver={(e) => e.preventDefault()}
                  className="border-2 border-dashed border-card-border rounded-xl overflow-hidden cursor-pointer hover:border-primary transition-colors flex items-center justify-center min-h-32"
                >
                  {imagePreview ? (
                    imagePreview.startsWith("data:image") ? (
                      <img src={imagePreview} alt="Statement preview" className="max-h-48 object-contain" />
                    ) : (
                      <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                        <FileText size={24} /> <span className="text-sm">PDF ready for parsing</span>
                      </div>
                    )
                  ) : (
                    <div className="text-center p-6 text-muted-foreground">
                      <Camera size={28} className="mx-auto opacity-40 mb-2" />
                      <p className="text-sm">Click or drag a JPEG / PDF here</p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED.join(",")}
                  capture="environment"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }}
                />
                <div className="flex flex-wrap gap-2">
                  <UnifiedScanCapture
                    module="banking"
                    docType="bank-statement"
                    triggerLabel="Scanner / camera / phone"
                    onCapture={(cap) => void handleUnifiedCapture(cap)}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    <Upload size={14} className="mr-1" /> Upload file
                  </Button>
                </div>
                {isBlurred && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    This scan looks blurry — retake or crop tighter around the transaction table for better OCR.
                  </p>
                )}
              </div>
            )}

            {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded p-2">{error}</p>}

            <Button onClick={() => void parse()} disabled={parsing || (inputMode === "text" ? !csvText.trim() : !imageBase64)} className="w-full">
              <ScanLine size={14} className="mr-2" /> {parsing ? "Parsing with AI…" : "Parse Statement"}
            </Button>
          </div>

          {txns.length > 0 && (
            <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="font-semibold">{txns.length} Transactions Detected</h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggleAll(true)}>Select All</Button>
                  <Button size="sm" variant="outline" onClick={() => toggleAll(false)}>Deselect All</Button>
                </div>
              </div>

              <div className="bg-muted/30 border border-card-border rounded-lg p-4 grid md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Bank Account (this account)</Label>
                  <select className="mt-1 w-full h-8 text-sm border border-input rounded-md px-2 bg-background" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                    <option value="">Select bank account…</option>
                    {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Contra / Expense Account (the other side)</Label>
                  <select className="mt-1 w-full h-8 text-sm border border-input rounded-md px-2 bg-background" value={contraAccountId} onChange={(e) => setContraAccountId(e.target.value)}>
                    <option value="">Select account…</option>
                    {[...bankAccounts, ...expenseAccounts].map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-card-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 border-b border-card-border">
                    <tr>
                      <th className="w-8 px-3 py-2 text-left"><input type="checkbox" checked={selectedCount === txns.length} onChange={(e) => toggleAll(e.target.checked)} /></th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-right">Debit</th>
                      <th className="px-3 py-2 text-right">Credit</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                      <th className="px-3 py-2 text-left">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txns.map((t, i) => (
                      <tr key={i} className={`border-b border-card-border last:border-0 ${t.selected ? "" : "opacity-40"}`}>
                        <td className="px-3 py-1.5"><input type="checkbox" checked={t.selected} onChange={(e) => setTxns((ts) => ts.map((r, j) => j === i ? { ...r, selected: e.target.checked } : r))} /></td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{t.date}</td>
                        <td className="px-3 py-1.5 max-w-[200px] truncate" title={t.description}>{t.description}</td>
                        <td className="px-3 py-1.5 text-right text-red-600 font-medium">{inr(t.debit)}</td>
                        <td className="px-3 py-1.5 text-right text-green-600 font-medium">{inr(t.credit)}</td>
                        <td className="px-3 py-1.5 text-right">{inr(t.balance)}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{t.reference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-border">
                <p className="text-sm text-muted-foreground">{selectedCount} of {txns.length} selected for import</p>
                <Button onClick={() => void importTxns()} disabled={importing || selectedCount === 0 || !bankAccountId || !contraAccountId}>
                  <Download size={14} className="mr-2" /> {importing ? "Importing…" : `Import ${selectedCount} Transactions`}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
