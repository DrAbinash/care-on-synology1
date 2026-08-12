/**
 * WhatsApp report share from Radiology Reporting Workspace.
 * Prefills patient phone, requires verified report (or verify-then-send),
 * and checks share API ok before toasting success.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageCircle, RefreshCw, ShieldCheck } from "lucide-react";

export interface WhatsAppShareReportInfo {
  id: number;
  reportNumber?: string | null;
  status?: string | null;
  patientName?: string | null;
  patientPhone?: string | null;
  testName?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: number | null;
  /** Fallback phone when report payload has none (e.g. worklist). */
  fallbackPhone?: string | null;
  fallbackPatientName?: string | null;
  canVerify?: boolean;
  verifierName?: string | null;
  onSent?: () => void;
}

export function WhatsAppReportShareDialog({
  open,
  onOpenChange,
  reportId,
  fallbackPhone,
  fallbackPatientName,
  canVerify = false,
  verifierName,
  onSent,
}: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<WhatsAppShareReportInfo | null>(null);
  const [phone, setPhone] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !reportId) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    api
      .get<WhatsAppShareReportInfo>(`/api/patient-reports/${reportId}`)
      .then((r) => {
        if (!alive) return;
        setReport(r);
        setPhone(String(r.patientPhone || fallbackPhone || "").trim());
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load report");
        setPhone(String(fallbackPhone || "").trim());
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, reportId, fallbackPhone]);

  const status = String(report?.status ?? "").toLowerCase();
  const isDeliverable =
    status === "verified" || status === "delivered" || status === "pending_verification";
  const needsVerify = Boolean(report) && !isDeliverable && status !== "" && status !== "draft";
  // Only offer verify-then-send when still unsigned / not yet pending (rare).
  const offerVerifyThenSend = needsVerify && canVerify;

  async function sendShare(targetReportId: number) {
    const result = await api.post<{ ok: boolean; error?: string; reportUrl?: string }>(
      `/api/patient-reports/${targetReportId}/share`,
      { channel: "whatsapp", recipient: phone.trim() },
    );
    if (!result.ok) {
      throw new Error(result.error || "WhatsApp send failed");
    }
    return result;
  }

  async function handleSend() {
    if (!reportId) return;
    if (!phone.trim()) {
      toast({ title: "Phone required", description: "Enter the patient’s WhatsApp number.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      let id = reportId;
      if (offerVerifyThenSend) {
        await api.post(`/api/patient-reports/${id}/verify`, {
          verifiedByName: verifierName ?? undefined,
        });
        toast({ title: "Report verified" });
      } else if (!isDeliverable) {
        toast({
          title: "Finalize required",
          description: "Sign the report with Finalize before WhatsApp send.",
          variant: "destructive",
        });
        return;
      }
      const result = await sendShare(id);
      toast({
        title: "Sent on WhatsApp",
        description: `${phone.trim()}${result.reportUrl ? " · patient PDF link included" : ""}`,
      });
      onSent?.();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "WhatsApp send failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="whatsapp-report-share-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-emerald-600" />
            Send report on WhatsApp
          </DialogTitle>
          <DialogDescription>
            {report?.reportNumber
              ? `${report.reportNumber}${report.patientName ? ` — ${report.patientName}` : fallbackPatientName ? ` — ${fallbackPatientName}` : ""}`
              : "Patient receives a downloadable report link."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <RefreshCw className="h-4 w-4 animate-spin" /> Loading report…
          </div>
        ) : loadError ? (
          <p className="text-sm text-destructive py-2">{loadError}</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground space-y-0.5">
              <div>
                Status:{" "}
                <span className="font-semibold text-foreground">{report?.status ?? "unknown"}</span>
              </div>
              {status === "pending_verification" && (
                <div className="text-emerald-700 dark:text-emerald-400">
                  Signed report — WhatsApp send is allowed (countersign optional).
                </div>
              )}
              {offerVerifyThenSend && (
                <div className="text-amber-700 dark:text-amber-400">
                  Will verify (countersign) this report, then send on WhatsApp.
                </div>
              )}
              {needsVerify && !canVerify && (
                <div className="text-amber-700 dark:text-amber-400">
                  Report is not signed yet. Finalize first, then send on WhatsApp.
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-phone">WhatsApp number</Label>
              <Input
                id="wa-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91XXXXXXXXXX"
                inputMode="tel"
                autoComplete="tel"
              />
              <p className="text-[10px] text-muted-foreground">
                Uses the clinic WhatsApp Cloud API. Patient gets a public PDF link (no staff login).
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            disabled={busy || loading || !phone.trim() || !reportId || (!isDeliverable && !offerVerifyThenSend)}
            onClick={() => void handleSend()}
            data-testid="btn-send-whatsapp-report"
          >
            {busy ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : offerVerifyThenSend ? (
              <ShieldCheck className="h-3.5 w-3.5" />
            ) : (
              <MessageCircle className="h-3.5 w-3.5" />
            )}
            {busy ? "Sending…" : offerVerifyThenSend ? "Verify & Send" : "Send WhatsApp"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default WhatsAppReportShareDialog;
