import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { isFeatureEnabled } from "@/lib/staffSession";

/**
 * UsgPregnancyTimeline — P4 pregnancy-timeline UI for the obstetric mode
 * (final-integration GAP 2). Flag-gated by ff_radiology_usg_pregnancy_timeline;
 * shows episode grouping + per-scan biometry/GA/EFW/AFI trends from
 * /api/usg-prior/patients/:id/timeline (same-patient only). Reference standards
 * are named. Fields not sourced by the timeline are disclosed, never invented.
 * "Accept summary" appends to the CURRENT draft's impression only.
 */

interface TimelinePoint {
  studyInstanceUID: string; date: string;
  gaByDatesDays: number | null; gaByUltrasoundDays: number | null; gaDisplay: string | null;
  efwGrams: number | null; crlMm: number | null; bpdMm: number | null; hcMm: number | null;
  acMm: number | null; flMm: number | null; afiCm: number | null;
  placenta: string | null; presentation: string | null;
}
interface Trend { key: string; label: string; unit: string; points: { date: string; value: number }[] }
interface Episode { episodeId: string; anchorEdd: string | null; scans: { studyInstanceUID: string; studyDate: string }[]; startDate: string | null; endDate: string | null }
interface TimelineResp {
  episodes: Episode[];
  timeline: { points: TimelinePoint[]; trends: Trend[]; established: { gaDays: number; method: string; date: string } | null };
}

const wd = (days: number | null) => days == null ? "—" : `${Math.floor(days / 7)}w${days % 7}d`;
const n = (v: number | null, u = "") => v == null ? "—" : `${v}${u}`;

export default function UsgPregnancyTimeline({
  patientId, isObstetric, onAccept,
}: { patientId: number | null | undefined; isObstetric: boolean; onAccept: (t: string) => void }) {
  const enabled = isFeatureEnabled("ff_radiology_usg_pregnancy_timeline") && isObstetric && patientId != null;

  const q = useQuery<TimelineResp>({
    queryKey: ["usg-timeline", patientId],
    queryFn: () => api.get(`/api/usg-prior/patients/${patientId}/timeline`),
    enabled,
  });

  if (!enabled) return null;

  const points = q.data?.timeline.points ?? [];
  const established = q.data?.timeline.established ?? null;
  const trends = q.data?.timeline.trends ?? [];

  const acceptSummary = () => {
    if (!points.length) return;
    const last = points[points.length - 1];
    const parts = [
      last.gaDisplay ? `GA ~${last.gaDisplay}` : null,
      last.efwGrams != null ? `EFW ${last.efwGrams} g` : null,
      last.afiCm != null ? `AFI ${last.afiCm} cm` : null,
    ].filter(Boolean);
    if (parts.length) onAccept(`Interval growth on serial scans; latest: ${parts.join(", ")}.`);
  };

  return (
    <div className="text-xs space-y-2" data-testid="usg-pregnancy-timeline">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">Pregnancy timeline</span>
        {points.length > 0 && <button className="px-2 py-0.5 rounded border" onClick={acceptSummary}>Accept summary</button>}
      </div>

      {q.isLoading && <p className="text-muted-foreground">Loading timeline…</p>}
      {q.isError && <p className="text-destructive">Couldn’t load the timeline. <button className="underline" onClick={() => q.refetch()}>Retry</button></p>}
      {q.data && points.length === 0 && <p className="text-muted-foreground">No obstetric scans with measurements for this patient yet.</p>}

      {established && (
        <p className="text-muted-foreground">
          GA established by <strong>{established.method.toUpperCase()}</strong> on {established.date} ({wd(established.gaDays)}).
        </p>
      )}

      {q.data && q.data.episodes.length > 1 && (
        <p className="text-amber-600">⚠ {q.data.episodes.length} pregnancy episodes detected — separate pregnancies are never combined. Verify grouping below.</p>
      )}

      {points.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="text-muted-foreground">
              <tr className="[&>th]:text-left [&>th]:font-normal [&>th]:pr-2">
                <th>Date</th><th>GA(dates)</th><th>GA(US)</th><th>CRL</th><th>BPD</th><th>HC</th><th>AC</th><th>FL</th><th>EFW</th><th>AFI</th><th>Placenta</th><th>Presn</th>
              </tr>
            </thead>
            <tbody className="[&>tr>td]:pr-2 tabular-nums">
              {points.map((p) => (
                <tr key={p.studyInstanceUID}>
                  <td>{p.date}</td><td>{wd(p.gaByDatesDays)}</td><td>{wd(p.gaByUltrasoundDays)}</td>
                  <td>{n(p.crlMm)}</td><td>{n(p.bpdMm)}</td><td>{n(p.hcMm)}</td><td>{n(p.acMm)}</td><td>{n(p.flMm)}</td>
                  <td>{n(p.efwGrams)}</td><td>{n(p.afiCm)}</td><td>{p.placenta ?? "—"}</td><td>{p.presentation ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {trends.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {trends.map((t) => {
            const first = t.points[0]?.value, last = t.points[t.points.length - 1]?.value;
            const delta = first != null && last != null ? last - first : null;
            return <span key={t.key} className="text-muted-foreground">{t.label}: {last}{t.unit}{delta != null && t.points.length > 1 ? ` (${delta >= 0 ? "+" : ""}${Math.round(delta * 10) / 10})` : ""}</span>;
          })}
        </div>
      )}

      {points.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Reference: EFW by Hadlock (1985); GA established by CRL (Hadlock) or LMP. NT, cervical length and UA/MCA/CPR are recorded in the anomaly/Doppler sources and are not yet joined into this timeline.
        </p>
      )}
    </div>
  );
}
