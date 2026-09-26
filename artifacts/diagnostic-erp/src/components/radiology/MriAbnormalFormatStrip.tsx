/**
 * One-click MRI abnormal Full Report Formats for Brain / LS / Cervical / Dorsal.
 * Ranked by region + billed test name + referring-doctor history.
 */

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  favoriteFormatIdsForDoctor,
  mriRegionKey,
  rankTopMriAbnormalFormats,
  recordDoctorFormatApply,
} from "@/lib/mriAbnormalFormats";
import { trackWorkspaceEvent } from "@/lib/reportingTelemetry";
import {
  formatDoctorWithDegree,
  resolveDoctorDegreeFromCatalog,
  type DoctorCatalogRow,
} from "@/lib/reportDemography";
import type { ReportingStudyContext } from "@/lib/reportingStudyContext";
import { useWorkspace } from "@/lib/zai-workspace/store";
import type { ReportFormat } from "@/lib/zai-workspace/types";

export type MriAbnormalFormatStripProps = {
  studyId?: number | null;
  reportingContext: ReportingStudyContext | null | undefined;
  modality?: string | null;
  billedTestName?: string | null;
  studyDescription?: string | null;
  referringDoctorId?: number | null;
  referringDoctorName?: string | null;
  /** Settings → Doctors → degree (preferred when order is linked). */
  referringDoctorDegree?: string | null;
  /** Settings → Doctors catalog — used to resolve degree by name when id/degree missing. */
  doctorsCatalog?: DoctorCatalogRow[] | null;
  disabled?: boolean;
};

export function MriAbnormalFormatStrip({
  studyId,
  reportingContext,
  modality,
  billedTestName,
  studyDescription,
  referringDoctorId,
  referringDoctorName,
  referringDoctorDegree,
  doctorsCatalog,
  disabled,
}: MriAbnormalFormatStripProps) {
  const reportFormats = useWorkspace((s) => s.reportFormats) as ReportFormat[];
  const region = mriRegionKey(reportingContext);
  const mod = (modality ?? "").toUpperCase();
  const doctorFavorites = useMemo(
    () => favoriteFormatIdsForDoctor({ referringDoctorId, referringDoctorName }),
    [referringDoctorId, referringDoctorName],
  );

  const doctorLabel = useMemo(() => {
    const name = (referringDoctorName ?? "").trim();
    if (!name) return "";
    const fromSettings =
      (referringDoctorDegree ?? "").trim()
      || resolveDoctorDegreeFromCatalog(name, doctorsCatalog);
    return formatDoctorWithDegree(name, fromSettings || null);
  }, [referringDoctorName, referringDoctorDegree, doctorsCatalog]);

  const ranked = useMemo(() => {
    if (mod !== "MR" && mod !== "MRI") return [];
    if (!region) return [];
    return rankTopMriAbnormalFormats({
      formats: reportFormats,
      ctx: reportingContext,
      billedTestName,
      studyDescription,
      doctorFavoriteFormatIds: doctorFavorites,
      limit: 10,
    });
  }, [mod, region, reportFormats, reportingContext, billedTestName, studyDescription, doctorFavorites]);

  if (ranked.length === 0) return null;

  const hint = [billedTestName, doctorLabel].filter(Boolean).join(" · ");

  return (
    <div
      className="rounded-md border border-amber-200/80 bg-amber-50/40 p-1.5 space-y-1"
      data-testid="mri-abnormal-format-strip"
    >
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900">
          Top abnormal ({region})
        </span>
        {hint ? (
          <span className="truncate text-[9px] text-amber-800/80" title={hint} data-testid="mri-abnormal-billdesk-hint">
            {hint}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {ranked.map((f) => (
          <Button
            key={f.id}
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            data-testid={`mri-abnormal-format-${f.id}`}
            className="h-6 max-w-[14rem] truncate px-1.5 text-[10px] border-amber-300 bg-white text-amber-950 hover:bg-amber-100"
            title={f.name}
            onClick={() => {
              useWorkspace.getState().applyFormatById(f.id);
              recordDoctorFormatApply({ referringDoctorId, referringDoctorName, formatId: f.id });
              trackWorkspaceEvent({
                type: "abnormal_strip_click",
                studyId,
                modality: modality ?? null,
                region,
                billedTestName: billedTestName ?? null,
                referringDoctorId: referringDoctorId ?? null,
                formatId: f.id,
                formatName: f.name,
              });
            }}
          >
            {f.name.replace(/^MRI\s+/i, "").replace(/^Brain\s+[—-]\s+/i, "Brain · ").replace(/^LS Spine\s+[—-]\s+/i, "LS · ").replace(/^Cervical Spine\s+[—-]\s+/i, "Cervical · ").replace(/^Dorsal Spine\s+[—-]\s+/i, "Dorsal · ")}
          </Button>
        ))}
      </div>
    </div>
  );
}
