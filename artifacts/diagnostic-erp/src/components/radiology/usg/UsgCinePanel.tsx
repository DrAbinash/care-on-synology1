import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { isFeatureEnabled } from "@/lib/staffSession";

/**
 * UsgCinePanel — P7 cine UI (wires the orphaned /api/usg-cine endpoints).
 * Flag-gated by ff_radiology_usg_cine. Lists saved key frames (DICOM references)
 * for the study and exposes an "Open in OHIF" affordance. Actual multi-frame
 * PLAYBACK and key-frame capture require the embedded OHIF viewer; when the
 * viewer isn't available this panel says so honestly and never blocks reporting.
 */

interface KeyFrame { id: number; sopInstanceUID: string | null; frameNumber: number; label: string; source: string | null }

export default function UsgCinePanel({
  studyInstanceUID, onOpenViewer,
}: { studyInstanceUID: string | null | undefined; onOpenViewer?: () => void }) {
  const enabled = isFeatureEnabled("ff_radiology_usg_cine") && !!studyInstanceUID;

  const q = useQuery<{ keyFrames: KeyFrame[] }>({
    queryKey: ["usg-cine-keyframes", studyInstanceUID],
    queryFn: () => api.get(`/api/usg-cine/studies/${encodeURIComponent(studyInstanceUID!)}/key-frames`),
    enabled,
  });

  if (!enabled) return null;

  return (
    <div className="text-xs space-y-1.5" data-testid="usg-cine-panel">
      <div className="font-medium text-sm">Cine / key frames</div>

      {q.isLoading && <p className="text-muted-foreground">Loading key frames…</p>}
      {q.isError && <p className="text-amber-600">Cine unavailable — viewer not connected. Reporting is unaffected.</p>}
      {q.data && q.data.keyFrames.length === 0 && <p className="text-muted-foreground">No key frames captured for this study yet.</p>}

      {q.data && q.data.keyFrames.length > 0 && (
        <ul className="space-y-0.5">
          {q.data.keyFrames.map((k) => (
            <li key={k.id} className="flex items-center gap-2">
              <span className="flex-1">{k.label || `Frame ${k.frameNumber}`}</span>
              <span className="text-muted-foreground">SOP {k.sopInstanceUID ? `${k.sopInstanceUID.slice(0, 8)}…` : "—"} · f{k.frameNumber}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        {onOpenViewer && <button className="px-2 py-0.5 rounded border" onClick={onOpenViewer}>Open in viewer</button>}
      </div>
      <p className="text-[10px] text-muted-foreground">Playback + key-frame capture run in the embedded OHIF viewer. Key frames are stored as DICOM references (SOP + frame), never image blobs.</p>
    </div>
  );
}
