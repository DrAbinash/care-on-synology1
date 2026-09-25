/**
 * Generalized WhatsApp share dialog (Lane 1 = wa.me).
 * Used from Bill tab (and reusable for reports). Never silent auto-send.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageCircle, Copy, ExternalLink } from "lucide-react";
import {
  type DeliveryRouting,
  type DeliveryTarget,
  WA_STATION_MEMORY_KEY,
  WA_STATION_REMEMBER_KEY,
  buildWaLink,
  deliveryMessage,
  maskPhoneForAudit,
  parseStationChoice,
  resolveDeliveryTargets,
} from "@/lib/whatsappDelivery";

export type WhatsAppDeliveryKind = "bill" | "report" | "booking";

export interface WhatsAppDeliveryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: WhatsAppDeliveryKind;
  recordId: number | string;
  clinicName?: string;
  patientPhone?: string | null;
  doctorPhone?: string | null;
  patientName?: string | null;
  /** Patient master whatsapp_consent — false forces override click. */
  whatsappConsent?: boolean;
  defaultRouting?: DeliveryRouting;
  /** When false, station memory is ignored (clinic setting). */
  rememberStationAllowed?: boolean;
  bookingRef?: string | null;
  slotLabel?: string | null;
  /** Called after a successful wa.me open (for Print & Send tests / hooks). */
  onSent?: () => void;
}

type DeliverySettings = {
  whatsappDeliveryRouting?: DeliveryRouting;
  whatsappAutoOfferAfterPrint?: boolean;
  whatsappRememberStationChoice?: boolean;
  clinicName?: string;
};

export function WhatsAppDeliveryDialog({
  open,
  onOpenChange,
  kind,
  recordId,
  clinicName: clinicNameProp,
  patientPhone,
  doctorPhone,
  patientName,
  whatsappConsent = false,
  defaultRouting,
  rememberStationAllowed = true,
  bookingRef,
  slotLabel,
  onSent,
}: WhatsAppDeliveryDialogProps) {
  const { toast } = useToast();
  const [routing, setRouting] = useState<DeliveryRouting>("patient_only");
  const [busy, setBusy] = useState(false);
  const [tokenUrl, setTokenUrl] = useState<string | null>(null);
  const [tokenExpiry, setTokenExpiry] = useState<string | null>(null);
  const [expiryDays, setExpiryDays] = useState(7);
  const [clinicName, setClinicName] = useState(clinicNameProp || "Care Diagnostics");
  const [remember, setRemember] = useState(true);
  const [overrideConsent, setOverrideConsent] = useState(false);
  const [manualPhone, setManualPhone] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const s = await api.get<DeliverySettings>("/api/whatsapp-delivery/settings");
        if (!alive) return;
        const clinicRouting = (s.whatsappDeliveryRouting || "patient_only") as DeliveryRouting;
        setClinicName(clinicNameProp || s.clinicName || "Care Diagnostics");
        const allowRemember = rememberStationAllowed && (s.whatsappRememberStationChoice !== false);
        let chosen = defaultRouting || clinicRouting;
        if (allowRemember && typeof localStorage !== "undefined") {
          const rem = localStorage.getItem(WA_STATION_REMEMBER_KEY);
          setRemember(rem !== "0");
          if (rem !== "0") {
            const parsed = parseStationChoice(localStorage.getItem(WA_STATION_MEMORY_KEY));
            if (parsed?.routing) chosen = parsed.routing;
          }
        }
        setRouting(chosen);
      } catch {
        setRouting(defaultRouting || "patient_only");
      }

      if (kind === "bill" || kind === "report") {
        try {
          const minted = await api.post<{ url: string; expiresAt: string; expiryDays: number }>(
            "/api/whatsapp-delivery/share-token",
            { kind, recordId: Number(recordId) },
          );
          if (!alive) return;
          setTokenUrl(minted.url);
          setTokenExpiry(minted.expiresAt);
          setExpiryDays(minted.expiryDays ?? 7);
        } catch (e) {
          if (!alive) return;
          toast({
            title: "Could not create share link",
            description: e instanceof Error ? e.message : "Share token mint failed",
            variant: "destructive",
          });
          setTokenUrl(null);
        }
      } else {
        setTokenUrl(null);
        setTokenExpiry(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, kind, recordId, clinicNameProp, defaultRouting, rememberStationAllowed, toast]);

  const message = deliveryMessage(kind, {
    clinicName,
    tokenUrl,
    bookingRef,
    patientName,
    slotLabel,
    expiryDays,
  });

  const targets: DeliveryTarget[] = resolveDeliveryTargets({
    routing,
    patientPhone: manualPhone.trim() || patientPhone,
    doctorPhone,
  });

  function persistStationChoice() {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(WA_STATION_REMEMBER_KEY, remember ? "1" : "0");
    if (remember) {
      localStorage.setItem(WA_STATION_MEMORY_KEY, JSON.stringify({ routing }));
    }
  }

  async function auditSend(phone: string | null, channel: string, consentOverride: boolean) {
    try {
      await api.post("/api/whatsapp-delivery/audit", {
        kind,
        recordId: String(recordId),
        phone: phone || "",
        channel,
        consentOverride,
        tokenExpiry,
        notes: consentOverride ? "no-consent override" : "",
      });
    } catch {
      /* audit failure must not block send — toast honesty */
    }
  }

  async function sendTarget(t: DeliveryTarget) {
    if (!whatsappConsent && !overrideConsent) {
      toast({
        title: "No WhatsApp consent",
        description: "Patient has not consented. Tick the one-time override to proceed (logged).",
        variant: "destructive",
      });
      return;
    }
    if (t.kind === "missing" || !t.phone) {
      try {
        await navigator.clipboard.writeText(message);
        await auditSend(null, "clipboard", !whatsappConsent && overrideConsent);
        toast({
          title: `No ${t.role} phone on file`,
          description: "Message copied to clipboard — paste into WhatsApp manually.",
        });
      } catch {
        toast({
          title: `No ${t.role} phone on file`,
          description: "Add a phone number or copy the message manually.",
          variant: "destructive",
        });
      }
      return;
    }
    const link = buildWaLink(t.phone, message);
    if (!link) {
      toast({ title: "Invalid phone", description: "Could not build a WhatsApp link.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      persistStationChoice();
      await auditSend(t.phone, "wa-me", !whatsappConsent && overrideConsent);
      window.open(link, "_blank", "noopener,noreferrer");
      toast({
        title: "WhatsApp opened",
        description: `Sending to ${t.role} (${maskPhoneForAudit(t.phone)}). Confirm send in WhatsApp.`,
      });
      onSent?.();
    } finally {
      setBusy(false);
    }
  }

  async function sendAll() {
    for (const t of targets) {
      await sendTarget(t);
    }
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      toast({ title: "Copied", description: "Message copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Could not access clipboard.", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle size={18} /> Share via WhatsApp
          </DialogTitle>
          <DialogDescription>
            Staff-initiated only — opens WhatsApp with a prefilled message. No silent auto-send.
            {kind !== "booking" ? " Link expires in 7 days." : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">Delivery routing</Label>
            <select
              className="mt-1 w-full h-9 border rounded-md px-2 bg-background"
              value={routing}
              onChange={(e) => setRouting(e.target.value as DeliveryRouting)}
              data-testid="wa-delivery-routing"
            >
              <option value="patient_only">Patient only</option>
              <option value="patient_and_doctor">Patient and doctor</option>
              <option value="doctor_only">Doctor only</option>
            </select>
          </div>

          <div>
            <Label className="text-xs">Patient phone (override)</Label>
            <Input
              className="mt-1 h-9"
              value={manualPhone}
              onChange={(e) => setManualPhone(e.target.value)}
              placeholder={patientPhone || "Use patient master phone"}
              data-testid="wa-delivery-phone"
            />
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap" data-testid="wa-delivery-message">
            {message}
          </div>

          {tokenUrl && (
            <a
              href={tokenUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
            >
              <ExternalLink size={12} /> Preview share link
            </a>
          )}

          {!whatsappConsent && (
            <label className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
              <Checkbox
                checked={overrideConsent}
                onCheckedChange={(v) => setOverrideConsent(Boolean(v))}
                data-testid="wa-consent-override"
              />
              <span>
                Patient has no WhatsApp consent on file. One-time override (will be audited).
              </span>
            </label>
          )}

          {rememberStationAllowed && (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={remember}
                onCheckedChange={(v) => setRemember(Boolean(v))}
                data-testid="wa-remember-choice"
              />
              Remember my choice on this station
            </label>
          )}

          <ul className="text-xs space-y-1">
            {targets.map((t, i) => (
              <li key={`${t.role}-${i}`} className="flex items-center justify-between gap-2">
                <span>
                  {t.role}:{" "}
                  {t.kind === "missing"
                    ? <span className="text-amber-700">missing phone</span>
                    : maskPhoneForAudit(t.phone)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={busy}
                  onClick={() => void sendTarget(t)}
                  data-testid={`wa-send-${t.role}`}
                >
                  {t.kind === "missing" ? "Copy" : "Send"}
                </Button>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => void copyMessage()}>
            <Copy size={14} className="mr-1" /> Copy message
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void sendAll()} data-testid="wa-send-all">
            <MessageCircle size={14} className="mr-1" /> Open WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Pure helper exported for Print & Send unit tests. */
export function runPrintThenOfferWhatsApp(opts: {
  printOnce: () => void | Promise<void>;
  autoOffer: boolean;
  openDialog: () => void;
}): Promise<"printed_and_offered" | "printed_only"> {
  return Promise.resolve(opts.printOnce()).then(() => {
    if (opts.autoOffer) {
      opts.openDialog();
      return "printed_and_offered" as const;
    }
    return "printed_only" as const;
  });
}

export function isBillIssuableForWhatsApp(status: string | null | undefined): boolean {
  const s = String(status || "").toLowerCase();
  if (!s || s === "draft" || s === "cancelled") return false;
  return true;
}
