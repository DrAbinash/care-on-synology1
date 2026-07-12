import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/fetchApi";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Baby, ClipboardPlus } from "lucide-react";
import CollapsibleSection from "@/components/radiology/CollapsibleSection";

/**
 * ObDashboardStrip — R2.0 Canonical Ultrasound Integration.
 *
 * Compact obstetric "dashboard strip" mounted above the report editor in the
 * canonical RadiologyReportingWorkspace for obstetric/pregnancy ultrasound
 * studies. Auto-populated from approved FetalUsgLevel4 measurements
 * (GET /api/fetal-usg-dashboard/strip/:studyId), but each chip is editable
 * in place — edits only affect the text this component compiles into the
 * report, never the underlying fetal_usg_measurements data (that correction
 * flow belongs to FetalUsgLevel4 / UsgMeasurementReview, out of scope here).
 *
 * Silent by design: renders nothing while loading, on error, or when the
 * backend reports `found: false` (non-OB study, or an OB study that hasn't
 * been through FetalUsgLevel4 yet) — this must never clutter the workspace.
 */

interface ObDashboardStripProps {
  studyId: number | null | undefined;
  onApplyToReport?: (summaryText: string) => void; // "insert OB summary into findings" button
}

interface ObStripResponse {
  found: boolean;
  fetalStudyId?: number;
  requestedStudyId?: number;
  isFallback?: boolean;
  measurementDate?: string | null;
  ga?: { weeks: number | null; days: number | null; label: string | null };
  edd?: string | null;
  bpd?: number | null;
  hc?: number | null;
  ac?: number | null;
  fl?: number | null;
  efw?: number | null;
  afi?: number | null;
  afiInterpretation?: string | null;
  fhr?: number | null;
  placentaLocation?: string | null;
  placentaGrade?: string | null;
  presentation?: string | null;
}

type ChipKey = "ga" | "edd" | "bpd" | "hc" | "ac" | "fl" | "efw" | "fhr" | "placenta" | "liquor" | "presentation";

const CHIP_LABELS: Record<ChipKey, string> = {
  ga: "GA",
  edd: "EDD",
  bpd: "BPD",
  hc: "HC",
  ac: "AC",
  fl: "FL",
  efw: "EFW",
  fhr: "FHR",
  placenta: "Placenta",
  liquor: "Liquor",
  presentation: "Presentation",
};

const CHIP_ORDER: ChipKey[] = ["ga", "edd", "bpd", "hc", "ac", "fl", "efw", "fhr", "placenta", "liquor", "presentation"];

function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function formatGa(ga?: { weeks: number | null; days: number | null; label: string | null }): string | null {
  if (!ga || ga.weeks == null) return null;
  // R2.0 fix: prefer the server's own label (pregnancyDashboard.ts's
  // /strip endpoint already computes "22w 3d") instead of re-deriving a
  // differently-formatted string here — the two had already drifted
  // ("22w 3d" vs "22w3d", no space) within this same feature.
  return ga.label ?? `${ga.weeks}w${ga.days ?? 0}d`;
}

function formatEdd(edd?: string | null): string | null {
  if (!edd) return null;
  // R2.0 fix: `edd` is a date-ONLY string ("2026-03-15"), which the ISO-8601
  // spec parses as UTC midnight. Reading it back with local getters
  // (getDate/getMonth/getFullYear) shifts the displayed date by one day for
  // any browser timezone west of UTC. Use the UTC getters so the displayed
  // calendar date always matches the stored string, independent of the
  // viewer's timezone.
  const d = new Date(edd);
  if (isNaN(d.getTime())) return edd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getUTCDate()).padStart(2, "0")}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

function formatPlacenta(location?: string | null, grade?: string | null): string | null {
  if (!location && !grade) return null;
  const parts: string[] = [];
  if (location) parts.push(capitalize(location));
  if (grade) parts.push(`Grade ${grade}`);
  return parts.join(", ");
}

function formatLiquor(afi?: number | null, interpretation?: string | null): string | null {
  if (afi == null && !interpretation) return null;
  if (interpretation && afi != null) return `${capitalize(interpretation)} (AFI ${afi})`;
  if (interpretation) return capitalize(interpretation);
  return `AFI ${afi}`;
}

/** Derive the initial (uneditable-until-clicked) chip values from the fetched snapshot. */
function deriveChipValues(data: ObStripResponse): Record<ChipKey, string | null> {
  return {
    ga: formatGa(data.ga),
    edd: formatEdd(data.edd),
    bpd: data.bpd != null ? `${data.bpd}mm` : null,
    hc: data.hc != null ? `${data.hc}mm` : null,
    ac: data.ac != null ? `${data.ac}mm` : null,
    fl: data.fl != null ? `${data.fl}mm` : null,
    efw: data.efw != null ? `${data.efw}g` : null,
    fhr: data.fhr != null ? `${data.fhr}bpm` : null,
    placenta: formatPlacenta(data.placentaLocation, data.placentaGrade),
    liquor: formatLiquor(data.afi, data.afiInterpretation),
    presentation: data.presentation ? capitalize(data.presentation) : null,
  };
}

export default function ObDashboardStrip({ studyId, onApplyToReport }: ObDashboardStripProps) {
  const { data, isError, isLoading } = useQuery<ObStripResponse>({
    queryKey: ["ob-dashboard-strip", studyId],
    queryFn: () => fetchApi(`/api/fetal-usg-dashboard/strip/${studyId}`),
    enabled: !!studyId,
  });

  const baseValues = useMemo(() => (data && data.found ? deriveChipValues(data) : null), [data]);

  // Radiologist's in-place edits, keyed by chip. Presentation-only — never
  // written back to fetal_usg_measurements.
  const [overrides, setOverrides] = useState<Partial<Record<ChipKey, string>>>({});
  const [editingKey, setEditingKey] = useState<ChipKey | null>(null);
  const [editDraft, setEditDraft] = useState("");

  // Reset local edits whenever the underlying study changes.
  useEffect(() => {
    setOverrides({});
    setEditingKey(null);
  }, [studyId]);

  if (!studyId || isLoading || isError || !data || !data.found || !baseValues) {
    return null;
  }

  function displayValue(key: ChipKey): string | null {
    return overrides[key] ?? baseValues![key];
  }

  function startEdit(key: ChipKey) {
    setEditingKey(key);
    setEditDraft(displayValue(key) ?? "");
  }

  function saveEdit(key: ChipKey) {
    setOverrides((prev) => ({ ...prev, [key]: editDraft }));
    setEditingKey(null);
  }

  function handleApply() {
    if (!onApplyToReport) return;
    const parts = CHIP_ORDER.map((key) => {
      const v = displayValue(key);
      return v ? `${CHIP_LABELS[key]}: ${v}` : null;
    }).filter((s): s is string => !!s);
    onApplyToReport(parts.join("  "));
  }

  return (
    <CollapsibleSection
      layoutKey="radiology_report_layout"
      id="ob_dashboard_strip"
      title="Pregnancy Dashboard"
      headerExtra={
        onApplyToReport && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px]"
            onClick={handleApply}
          >
            <ClipboardPlus size={10} className="mr-1" /> Insert OB Summary into Findings
          </Button>
        )
      }
    >
      <div className="flex items-center flex-wrap gap-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
        <Baby size={13} className="text-pink-500 shrink-0" />
        {CHIP_ORDER.map((key) => {
          const value = displayValue(key);
          const editing = editingKey === key;
          return (
            <div
              key={key}
              onClick={() => !editing && startEdit(key)}
              className="flex items-center gap-1 rounded border border-border/50 bg-background px-1.5 py-0.5 text-xs cursor-pointer hover:border-primary/50 transition-colors"
              title="Click to edit for this report"
            >
              <span className="text-muted-foreground font-semibold">{CHIP_LABELS[key]}:</span>
              {editing ? (
                <Input
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={() => saveEdit(key)}
                  onKeyDown={(e) => e.key === "Enter" && saveEdit(key)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-5 w-24 text-[11px] px-1 py-0"
                  autoFocus
                />
              ) : (
                <span className={value ? "font-medium" : "text-muted-foreground/60"}>{value ?? "—"}</span>
              )}
            </div>
          );
        })}
        {data.isFallback && (
          <span className="text-[10px] text-muted-foreground/70 italic ml-1">
            (from prior scan{data.measurementDate ? ` · ${data.measurementDate}` : ""})
          </span>
        )}
      </div>
    </CollapsibleSection>
  );
}
