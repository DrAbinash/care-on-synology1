/**
 * Compact PCPNDT Form F step inside Reporting Workspace finalize flow.
 * Reuses POST /api/form-f/save + compliance check — no second Form F system.
 */
import { useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/fetchApi";

export type PcpndtFormFFinalizePrefill = {
  patientId: number;
  patientName: string;
  age?: string;
  mobile?: string;
  address?: string;
  husbandFatherName?: string;
  centreName?: string;
  registrationNo?: string;
  doctorName?: string;
  procedure?: string;
  procedureDate?: string;
  referredBy?: string;
  billId?: number;
  fetalUsgStudyId?: number;
};

type Props = {
  prefill: PcpndtFormFFinalizePrefill;
  missing?: string[];
  onSaved: () => void;
  onCancel: () => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PcpndtFormFFinalizeStep({ prefill, missing, onSaved, onCancel }: Props) {
  const [husbandFatherName, setHusbandFatherName] = useState(prefill.husbandFatherName ?? "");
  const [address, setAddress] = useState(prefill.address ?? "");
  const [procedureDate, setProcedureDate] = useState(prefill.procedureDate || todayIso());
  const [consentDate, setConsentDate] = useState("");
  const [idCardVerified, setIdCardVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sources = useMemo(
    () => ({
      patient: "From worklist / patient record",
      clinic: "From clinic settings when available",
    }),
    [],
  );

  const save = async () => {
    setError(null);
    if (!idCardVerified) {
      setError("ID Card must be verified (explicit confirmation required).");
      return;
    }
    if (!husbandFatherName.trim()) {
      setError("Husband/Father Name is required.");
      return;
    }
    if (!address.trim()) {
      setError("Address is required.");
      return;
    }
    if (!consentDate.trim() && !procedureDate.trim()) {
      setError("Consent Date or Procedure Date is required.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/form-f/save", {
        patientId: prefill.patientId,
        billId: prefill.billId,
        fetalUsgStudyId: prefill.fetalUsgStudyId ?? null,
        centreName: (prefill.centreName ?? "").trim() || "Care Diagnostics",
        registrationNo: (prefill.registrationNo ?? "").trim() || "N/A",
        patientName: prefill.patientName,
        age: (prefill.age ?? "").trim() || "0",
        husbandFatherName: husbandFatherName.trim(),
        address: address.trim(),
        mobile: prefill.mobile ?? "",
        referredBy: prefill.referredBy ?? "Self",
        doctorName: (prefill.doctorName ?? "").trim() || "Radiologist",
        procedure: (prefill.procedure ?? "").trim() || "Obstetric Ultrasound",
        procedureDate: procedureDate.trim() || todayIso(),
        consentDate: consentDate.trim(),
        date: todayIso(),
        place: "",
        idCardVerified: true,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Form F — finalize will not proceed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="pcpndt-form-f-finalize-step">
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">PCPNDT Form F required before finalize</p>
          <p className="text-[11px] opacity-90">
            Obstetric/fetal ultrasound — complete the fields below. Medico-legal declarations are not auto-ticked.
            {missing?.length ? ` Missing: ${missing.join(", ")}.` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-2 text-xs">
        <div>
          <Label className="text-[10px] text-muted-foreground">Patient <span className="opacity-70">({sources.patient})</span></Label>
          <Input value={prefill.patientName} readOnly className="h-8 text-xs bg-muted/40" />
        </div>
        <div>
          <Label className="text-[10px]">Husband / Father name</Label>
          <Input
            value={husbandFatherName}
            onChange={(e) => setHusbandFatherName(e.target.value)}
            className="h-8 text-xs"
            data-testid="form-f-husband"
          />
        </div>
        <div>
          <Label className="text-[10px]">Address</Label>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="h-8 text-xs"
            data-testid="form-f-address"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px]">Procedure date</Label>
            <Input type="date" value={procedureDate} onChange={(e) => setProcedureDate(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-[10px]">Consent date</Label>
            <Input type="date" value={consentDate} onChange={(e) => setConsentDate(e.target.value)} className="h-8 text-xs" />
          </div>
        </div>
        <label className="flex items-center gap-2 pt-1">
          <Checkbox
            checked={idCardVerified}
            onCheckedChange={(v) => setIdCardVerified(v === true)}
            data-testid="form-f-id-verified"
          />
          <span className="text-[11px]">I confirm the patient ID card has been verified</span>
        </label>
      </div>

      {error && <p className="text-[11px] text-destructive" data-testid="form-f-error">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" size="sm" className="h-8 text-xs" onClick={() => void save()} disabled={busy} data-testid="form-f-save-continue">
          {busy ? "Saving…" : "Save Form F & continue"}
        </Button>
      </div>
    </div>
  );
}

/** Pure gate helper for tests — decide whether finalize should open Form F step. */
export { shouldOpenFormFFinalizeStep } from "@/lib/pcpndtFinalizeGate";
