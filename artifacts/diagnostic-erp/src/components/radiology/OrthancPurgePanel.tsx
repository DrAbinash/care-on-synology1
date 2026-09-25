/**
 * Orthanc storage purge + auto-retention controls.
 * Rendered on Settings → Radiology → Advanced (admin-only page).
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { HardDrive, AlertTriangle, RefreshCw, Trash2 } from "lucide-react";

const CONFIRM_PHRASE = "DELETE STUDIES";

type PurgePreset =
  | "older_than_1_month"
  | "older_than_2_months"
  | "older_than_3_months"
  | "older_than_6_months"
  | "custom";

type PreviewSample = {
  orthancId: string;
  studyInstanceUID: string;
  accessionNumber: string;
  patientName: string;
  modality: string;
  studyDate: string;
  studyDescription: string | null;
};

type PreviewResult = {
  period: { label: string; dateFrom: string | null; dateTo: string };
  count: number;
  truncated: boolean;
  hardCap: number;
  requiresForceLarge: boolean;
  sample: PreviewSample[];
  note?: string;
};

type PurgeResult = {
  ok: boolean;
  orthancDeleted: number;
  orthancFailed: Array<{ orthancId: string; error: string }>;
  erp: Record<string, number>;
  label: string;
};

export type OrthancPurgePanelProps = {
  isAdmin: boolean;
  autoRetentionEnabled: boolean;
  onToggleAutoRetention: (enabled: boolean) => void;
};

export default function OrthancPurgePanel({
  isAdmin,
  autoRetentionEnabled,
  onToggleAutoRetention,
}: OrthancPurgePanelProps) {
  const { toast } = useToast();
  const [preset, setPreset] = useState<PurgePreset>("older_than_2_months");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [forceLarge, setForceLarge] = useState(false);

  const previewMutation = useMutation({
    mutationFn: () =>
      api.post<PreviewResult>("/api/radiology/orthanc/purge/preview", {
        preset,
        ...(preset === "custom" ? { dateFrom, dateTo } : {}),
      }),
    onSuccess: (data) => {
      setPreview(data);
      setForceLarge(false);
      toast({
        title: `${data.count} stud${data.count === 1 ? "y" : "ies"} match`,
        description: data.period.label,
      });
    },
    onError: (err: Error) => {
      setPreview(null);
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    },
  });

  const purgeMutation = useMutation({
    mutationFn: () =>
      api.post<PurgeResult>("/api/radiology/orthanc/purge", {
        preset,
        ...(preset === "custom" ? { dateFrom, dateTo } : {}),
        confirm: true,
        confirmPhrase: CONFIRM_PHRASE,
        forceLarge: forceLarge || undefined,
      }),
    onSuccess: (data) => {
      toast({
        title: `Deleted ${data.orthancDeleted} Orthanc studies`,
        description: `ERP scrubbed. Worklists with reports were preserved. Failed: ${data.orthancFailed?.length ?? 0}`,
      });
      setConfirmPhrase("");
      setPreview(null);
    },
    onError: (err: Error) => {
      toast({ title: "Purge failed", description: err.message, variant: "destructive" });
    },
  });

  function runPurge() {
    if (!preview) {
      toast({ title: "Preview first", description: "Run Preview before deleting.", variant: "destructive" });
      return;
    }
    if (confirmPhrase !== CONFIRM_PHRASE) {
      toast({
        title: "Type the confirmation phrase",
        description: `Enter exactly: ${CONFIRM_PHRASE}`,
        variant: "destructive",
      });
      return;
    }
    if (preview.requiresForceLarge && !forceLarge) {
      toast({
        title: "Large purge blocked",
        description: `More than ${preview.hardCap} studies. Narrow the range or enable force.`,
        variant: "destructive",
      });
      return;
    }
    const ok = window.confirm(
      `Permanently delete ${preview.count} Orthanc studies (${preview.period.label}) and scrub matching ERP imaging cache?\n\nBilling, finalized reports, and Form F are preserved.`,
    );
    if (!ok) return;
    purgeMutation.mutate();
  }

  return (
    <div
      className="rounded-xl border border-destructive/30 bg-card p-5 space-y-4"
      data-testid="orthanc-purge-panel"
    >
      <div className="flex items-start gap-3">
        <HardDrive className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
        <div className="space-y-1 min-w-0">
          <h3 className="font-semibold text-sm">Orthanc storage purge</h3>
          <p className="text-xs text-muted-foreground">
            Deletes DICOM studies from the care-orthanc container and scrubs matching ERP
            imaging/worklist cache rows. Billing orders, finalized reports, and Form F are never deleted.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
        <div className="space-y-0.5">
          <Label htmlFor="orthanc-auto-retention" className="text-sm font-medium">
            Auto-retention (keep ~500 newest)
          </Label>
          <p className="text-[11px] text-muted-foreground">
            When on, the care-pacs retention sidecar deletes oldest Orthanc studies by arrival time
            once the store exceeds ~520, then reconciles ERP cache. Requires the sidecar deployed on the NAS.
          </p>
        </div>
        <Switch
          id="orthanc-auto-retention"
          checked={autoRetentionEnabled}
          disabled={!isAdmin}
          onCheckedChange={(v) => onToggleAutoRetention(v)}
          data-testid="orthanc-auto-retention-switch"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Period</Label>
          <Select
            value={preset}
            onValueChange={(v) => {
              setPreset(v as PurgePreset);
              setPreview(null);
            }}
            disabled={!isAdmin}
          >
            <SelectTrigger data-testid="orthanc-purge-preset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="older_than_1_month">Older than 1 month</SelectItem>
              <SelectItem value="older_than_2_months">Older than 2 months</SelectItem>
              <SelectItem value="older_than_3_months">Older than 3 months</SelectItem>
              <SelectItem value="older_than_6_months">Older than 6 months</SelectItem>
              <SelectItem value="custom">Custom from–to dates</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPreview(null); }}
                disabled={!isAdmin}
                data-testid="orthanc-purge-from"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPreview(null); }}
                disabled={!isAdmin}
                data-testid="orthanc-purge-to"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!isAdmin || previewMutation.isPending}
          onClick={() => previewMutation.mutate()}
          data-testid="orthanc-purge-preview"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${previewMutation.isPending ? "animate-spin" : ""}`} />
          Preview
        </Button>
      </div>

      {preview && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3" data-testid="orthanc-purge-preview-result">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{preview.count} studies match</p>
              <p className="text-xs text-muted-foreground">{preview.period.label}</p>
              {preview.note && <p className="text-xs text-amber-700 mt-1">{preview.note}</p>}
            </div>
          </div>

          {preview.sample.length > 0 && (
            <div className="overflow-x-auto max-h-48 overflow-y-auto">
              <table className="min-w-full text-[11px]">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-1 pr-2">Date</th>
                    <th className="py-1 pr-2">Patient</th>
                    <th className="py-1 pr-2">Acc</th>
                    <th className="py-1 pr-2">Mod</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row) => (
                    <tr key={row.orthancId} className="border-b border-border/50">
                      <td className="py-1 pr-2 whitespace-nowrap">{row.studyDate || "—"}</td>
                      <td className="py-1 pr-2">{row.patientName || "—"}</td>
                      <td className="py-1 pr-2">{row.accessionNumber || "—"}</td>
                      <td className="py-1 pr-2">{row.modality || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.requiresForceLarge && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={forceLarge}
                onChange={(e) => setForceLarge(e.target.checked)}
                disabled={!isAdmin}
              />
              Allow deleting more than {preview.hardCap} studies (forceLarge)
            </label>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">
              Type <span className="font-mono font-semibold">{CONFIRM_PHRASE}</span> to enable delete
            </Label>
            <Input
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              disabled={!isAdmin || purgeMutation.isPending}
              className="font-mono text-sm max-w-xs"
              data-testid="orthanc-purge-confirm-phrase"
            />
          </div>

          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={!isAdmin || purgeMutation.isPending || confirmPhrase !== CONFIRM_PHRASE}
            onClick={runPurge}
            data-testid="orthanc-purge-execute"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            {purgeMutation.isPending ? "Deleting…" : "Delete matching studies"}
          </Button>
        </div>
      )}
    </div>
  );
}
