/**
 * Compact supporting-document panel for Expense Entry V2.
 * Documentary only — never touches bill / paid / due / vouchers.
 */
import { useEffect, useRef, useState } from "react";
import { api, HttpError, getStaffToken } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Camera,
  Download,
  Eye,
  FileText,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ExpenseAttachmentDto = {
  id: number;
  expensePk: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  documentType: string;
  contentHash: string;
  source: string;
  uploadedBy?: string | null;
  createdAt?: string | null;
  isImage: boolean;
  isPdf: boolean;
  viewUrl: string;
  downloadUrl: string;
};

export type PendingExpenseAttachment = {
  fileName: string;
  mimeType: string;
  base64Data: string;
  previewUrl: string;
  source: "MANUAL_UPLOAD" | "CAMERA";
  sizeBytes: number;
};

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf";
const MAX_BYTES = 15 * 1024 * 1024;

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function authFileUrl(path: string): string {
  const token = getStaffToken();
  if (!token) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}staffToken=${encodeURIComponent(token)}`;
}

function mimeFromFile(file: File): string {
  if (file.type) return file.type;
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function isAllowedFile(file: File): boolean {
  const mime = mimeFromFile(file);
  if (["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime)) return true;
  const lower = file.name.toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp", ".pdf"].some((e) => lower.endsWith(e));
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

type Props = {
  /** Existing expense — enables server list/upload/delete. */
  expenseId?: number | null;
  /** Local pending file for New Expense form (saved with receiptImageUrl). */
  pending?: PendingExpenseAttachment | null;
  onPendingChange?: (pending: PendingExpenseAttachment | null) => void;
  showAiHint?: boolean;
  onChanged?: () => void;
};

export default function ExpenseAttachmentsPanel({
  expenseId = null,
  pending = null,
  onPendingChange,
  showAiHint = false,
  onChanged,
}: Props) {
  const { toast } = useToast();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ExpenseAttachmentDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<ExpenseAttachmentDto | null>(null);
  const [dupPrompt, setDupPrompt] = useState<{
    fileName: string;
    mimeType: string;
    base64Data: string;
    source: "MANUAL_UPLOAD" | "CAMERA";
  } | null>(null);

  async function refresh() {
    if (!expenseId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const data = await api.get<ExpenseAttachmentDto[]>(`/api/expenses/${expenseId}/attachments`);
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseId]);

  async function uploadToExpense(opts: {
    fileName: string;
    mimeType: string;
    base64Data: string;
    source: "MANUAL_UPLOAD" | "CAMERA";
    attachAnyway: boolean;
  }) {
    if (!expenseId) return;
    setBusy(true);
    try {
      await api.post(`/api/expenses/${expenseId}/attachments`, {
        fileName: opts.fileName,
        mimeType: opts.mimeType,
        base64Data: opts.base64Data,
        source: opts.source,
        documentType: "supporting_document",
        attachAnyway: opts.attachAnyway,
      });
      toast({ title: "Document attached" });
      setDupPrompt(null);
      await refresh();
      onChanged?.();
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        setDupPrompt({
          fileName: opts.fileName,
          mimeType: opts.mimeType,
          base64Data: opts.base64Data,
          source: opts.source,
        });
        toast({
          title: "Duplicate document detected",
          description: "Same content already exists. Attach anyway only if intentional.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Attach failed",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function ingestFile(file: File, source: "MANUAL_UPLOAD" | "CAMERA") {
    if (!isAllowedFile(file)) {
      toast({ title: "Unsupported file type", description: "Use JPG, PNG, WEBP, or PDF.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "File too large", description: "Maximum size is 15 MB.", variant: "destructive" });
      return;
    }
    const mimeType = mimeFromFile(file);
    const base64Data = await fileToBase64(file);
    const previewUrl = mimeType.startsWith("image/") ? `data:${mimeType};base64,${base64Data}` : "";

    if (!expenseId) {
      onPendingChange?.({
        fileName: file.name,
        mimeType,
        base64Data,
        previewUrl,
        source,
        sizeBytes: file.size,
      });
      return;
    }

    await uploadToExpense({
      fileName: file.name,
      mimeType,
      base64Data,
      source,
      attachAnyway: false,
    });
  }

  async function removeAttachment(att: ExpenseAttachmentDto) {
    if (!expenseId) return;
    if (!window.confirm(`Remove ${att.originalFilename}? Kept for audit (soft-delete).`)) return;
    setBusy(true);
    try {
      await api.delete(`/api/expenses/${expenseId}/attachments/${att.id}`);
      toast({ title: "Attachment removed" });
      await refresh();
      onChanged?.();
    } catch (err) {
      toast({
        title: "Remove failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const empty = !pending && rows.length === 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Paperclip size={14} /> Supporting Document / Bill
          <span className="text-[10px] font-normal text-muted-foreground">(optional)</span>
        </h3>
        {loading ? <Loader2 size={14} className="animate-spin text-muted-foreground" /> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera size={12} className="mr-1" /> Take Photo
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={12} className="mr-1" /> Upload Bill
        </Button>
        {showAiHint ? (
          <span className="text-[10px] text-muted-foreground self-center">AI Scan above also attaches the bill.</span>
        ) : null}
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void ingestFile(f, "CAMERA");
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void ingestFile(f, "MANUAL_UPLOAD");
        }}
      />

      {empty ? <p className="text-xs text-muted-foreground">No bill attached</p> : null}

      {pending ? (
        <div className="flex items-center gap-2 rounded-lg border border-card-border p-2">
          {pending.previewUrl ? (
            <img src={pending.previewUrl} alt="" className="h-12 w-12 object-cover rounded border" />
          ) : (
            <div className="h-12 w-12 rounded border flex items-center justify-center bg-muted">
              <FileText size={16} />
            </div>
          )}
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-medium truncate">{pending.fileName}</div>
            <div className="text-muted-foreground">
              {pending.mimeType} · {formatSize(pending.sizeBytes)} ·{" "}
              {pending.source === "CAMERA" ? "Camera" : "Upload"}
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onPendingChange?.(null)}>
            <X size={12} />
          </Button>
        </div>
      ) : null}

      {rows.map((att) => (
        <div key={att.id} className="flex items-center gap-2 rounded-lg border border-card-border p-2">
          {att.isImage ? (
            <img src={authFileUrl(att.viewUrl)} alt="" className="h-12 w-12 object-cover rounded border bg-muted" />
          ) : (
            <div className="h-12 w-12 rounded border flex items-center justify-center bg-muted">
              <FileText size={16} />
            </div>
          )}
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-medium truncate">{att.originalFilename}</div>
            <div className="text-muted-foreground">
              {att.mimeType} · {formatSize(att.sizeBytes)} · {att.source}
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="View" onClick={() => setViewer(att)}>
            <Eye size={12} />
          </Button>
          <a href={authFileUrl(att.downloadUrl)} target="_blank" rel="noreferrer">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Download">
              <Download size={12} />
            </Button>
          </a>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            title="Remove"
            disabled={busy}
            onClick={() => void removeAttachment(att)}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}

      <Dialog open={!!viewer} onOpenChange={(o) => !o && setViewer(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="truncate text-sm">{viewer?.originalFilename}</DialogTitle>
          </DialogHeader>
          {viewer?.isPdf ? (
            <iframe title={viewer.originalFilename} src={authFileUrl(viewer.viewUrl)} className="w-full h-[70vh] rounded border" />
          ) : viewer ? (
            <img src={authFileUrl(viewer.viewUrl)} alt={viewer.originalFilename} className="max-w-full mx-auto rounded border" />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!dupPrompt} onOpenChange={(o) => !o && setDupPrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate document detected</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This file matches an existing bill/receipt by content hash. Attach anyway only when you intentionally need
            a second copy.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDupPrompt(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!dupPrompt) return;
                void uploadToExpense({ ...dupPrompt, attachAnyway: true });
              }}
            >
              Attach Anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
