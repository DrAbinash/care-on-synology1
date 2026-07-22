import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { isFeatureEnabled } from "@/lib/staffSession";

/**
 * UsgPacsReturnPanel — P6 report→PACS return UI (wires the orphaned
 * /api/usg-pacs-return endpoints). Flag-gated by ff_radiology_usg_report_to_pacs.
 * Shows eligibility (never sends a draft / superseded / PCPNDT-non-compliant
 * report), a Send-to-PACS button (enqueues the durable job), and live status.
 * Degrades honestly when Orthanc is unavailable — reporting is never blocked.
 */

interface Eligibility { eligible: boolean; blockReasons: string[]; errors: string[]; reportId: number | null }
interface Status { pacsArchiveStatus: string | null; pacsInstanceId: string | null; revisions: { id: number; status: string; sequenceNumber: number | null; orthancInstanceId: string | null }[] }

export default function UsgPacsReturnPanel({ studyId }: { studyId: number | null | undefined }) {
  const enabled = isFeatureEnabled("ff_radiology_usg_report_to_pacs") && studyId != null;
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);

  const elig = useQuery<Eligibility>({
    queryKey: ["usg-pacs-elig", studyId],
    queryFn: () => api.get(`/api/usg-pacs-return/studies/${studyId}/eligibility`),
    enabled,
  });
  const status = useQuery<Status>({
    queryKey: ["usg-pacs-status", studyId],
    queryFn: () => api.get(`/api/usg-pacs-return/studies/${studyId}/status`),
    enabled,
  });

  if (!enabled) return null;

  const send = async () => {
    setSending(true); setSendMsg(null);
    try {
      const r = await api.post<{ enqueued: boolean; alreadyQueued: boolean }>(`/api/usg-pacs-return/studies/${studyId}/return`, {});
      setSendMsg(r.alreadyQueued ? "Already queued for PACS." : "Queued for PACS delivery.");
      status.refetch();
    } catch {
      setSendMsg("Send failed — the report stays finalized; Admin will see the failure.");
    } finally { setSending(false); }
  };

  return (
    <div className="text-xs space-y-1.5" data-testid="usg-pacs-return-panel">
      <div className="font-medium text-sm">Report → PACS</div>

      {elig.isLoading && <p className="text-muted-foreground">Checking eligibility…</p>}
      {elig.isError && <p className="text-amber-600">PACS return unavailable — Orthanc not connected. Reporting is unaffected.</p>}

      {elig.data && !elig.data.eligible && (
        <p className="text-amber-600">Not eligible yet: {(elig.data.errors.length ? elig.data.errors : elig.data.blockReasons).join("; ")}</p>
      )}
      {elig.data && elig.data.eligible && (
        <button className="px-2 py-0.5 rounded bg-primary text-primary-foreground" disabled={sending} onClick={send}>
          {sending ? "Sending…" : "Send signed report to PACS"}
        </button>
      )}
      {sendMsg && <p className="text-muted-foreground">{sendMsg}</p>}

      {status.data && (
        <p className="text-muted-foreground">
          Status: <strong>{status.data.pacsArchiveStatus ?? "none"}</strong>
          {status.data.pacsInstanceId ? ` · instance ${status.data.pacsInstanceId.slice(0, 8)}…` : ""}
          {status.data.revisions?.length ? ` · ${status.data.revisions.length} revision(s)` : ""}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">Drafts are never sent; a failed push leaves the report finalized; retries are idempotent.</p>
    </div>
  );
}
