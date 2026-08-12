/**
 * Deep-link landing page for external systems (Hope OPD).
 *
 * URL: /radiology/open?orderId=&patientId=&uhid=&modality=MR&patientName=
 *
 * Resolves to the Reporting Workspace (with the matching DICOM study selected)
 * when a worklist row exists; otherwise lands on the modality-filtered worklist
 * so the radiologist can pick the study once PACS has pushed it.
 * Requires an active Care staff session (Bearer JWT).
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { api } from "@/lib/fetchApi";
import { Loader2 } from "lucide-react";

type ResolveOpenResponse = {
  worklistId?: number;
  reportPath?: string;
  fallbackPath?: string;
  error?: string;
};

function readQuery(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export default function RadiologyOpenRedirect() {
  const [, navigate] = useLocation();
  const [message, setMessage] = useState("Opening radiology reporting…");

  useEffect(() => {
    let cancelled = false;
    const q = readQuery();
    const orderId = q.get("orderId");
    const patientId = q.get("patientId");
    const uhid = q.get("uhid");
    const modalityRaw = q.get("modality");
    const modality = modalityRaw === "MRI" ? "MR" : modalityRaw;
    const patientName = q.get("patientName");

    const params = new URLSearchParams();
    if (orderId) params.set("orderId", orderId);
    if (patientId) params.set("patientId", patientId);
    if (uhid) params.set("uhid", uhid);
    if (modality) params.set("modality", modality);
    if (patientName) params.set("patientName", patientName);

    const fallbackParams = new URLSearchParams();
    if (modality) fallbackParams.set("modality", modality);
    if (patientName) fallbackParams.set("q", patientName);
    const fallbackQs = fallbackParams.toString();
    const fallback = fallbackQs ? `/radiology/worklist?${fallbackQs}` : "/radiology/worklist";

    if (!orderId && !patientId && !uhid) {
      navigate(fallback, { replace: true });
      return;
    }

    (async () => {
      try {
        const data = await api.get<ResolveOpenResponse>(
          `/api/internal/radiology/resolve-open?${params.toString()}`,
        );
        if (cancelled) return;
        if (data.reportPath) {
          navigate(data.reportPath, { replace: true });
          return;
        }
        navigate(data.fallbackPath || fallback, { replace: true });
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "";
        setMessage(msg && !msg.includes("Failed") ? msg : "Study not ready — opening worklist…");
        window.setTimeout(() => {
          if (!cancelled) navigate(fallback, { replace: true });
        }, 600);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p>{message}</p>
    </div>
  );
}
