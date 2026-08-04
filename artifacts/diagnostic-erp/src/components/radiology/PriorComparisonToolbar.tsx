import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { GitCompare } from "lucide-react";
import {
  INTERVAL_CHANGES,
  buildComparisonSentence,
  comparisonBanner,
  formatStudyDate,
  type IntervalChange,
} from "@/lib/radiologyComparison";
import { buildPriorStudiesPath } from "@/lib/priorStudiesPanelState";

type PriorStudy = {
  id: number;
  studyDate: string;
  testName: string;
  modality: string;
  bodyPart: string | null;
  status: string;
};

const REGION_WORDS = ["brain", "head", "spine", "lumbar", "cervical", "dorsal", "thoracic", "knee", "shoulder", "abdomen", "pelvis"];

function isCompatible(prior: PriorStudy, curMod: string, curDesc: string): boolean {
  const sameModality = (prior.modality || "").slice(0, 2).toUpperCase() === (curMod || "").slice(0, 2).toUpperCase();
  if (!sameModality) return false;
  const cur = new Set(REGION_WORDS.filter((w) => curDesc.toLowerCase().includes(w)));
  const pri = new Set(REGION_WORDS.filter((w) => `${prior.testName} ${prior.bodyPart ?? ""}`.toLowerCase().includes(w)));
  if (cur.size === 0 || pri.size === 0) return true;
  for (const t of cur) if (pri.has(t)) return true;
  return false;
}

interface Props {
  patientId?: number;
  excludeStudyId?: number;
  modality: string;
  studyDescription: string;
  comparisonMissing: boolean;
  disabled?: boolean;
  onInsertFindings: (text: string) => void;
  onOpenPriorTab: () => void;
}

/** Compact prior-comparison strip in the main report column. */
export default function PriorComparisonToolbar({
  patientId,
  excludeStudyId,
  modality,
  studyDescription,
  comparisonMissing,
  disabled,
  onInsertFindings,
  onOpenPriorTab,
}: Props) {
  const { data } = useQuery<{ studies: PriorStudy[] }>({
    queryKey: ["radiology-prior-studies-toolbar", patientId, excludeStudyId ?? null],
    queryFn: () => api.get(buildPriorStudiesPath({ patientId: patientId!, limit: 10, excludeStudyId })),
    enabled: !!patientId,
    staleTime: 120_000,
  });

  const bestPrior = useMemo(() => {
    const all = data?.studies ?? [];
    if (all.length === 0) return null;
    const ranked = [...all].sort((a, b) => {
      const score = (s: PriorStudy) =>
        (isCompatible(s, modality, studyDescription) ? 1000 : 0) + (/final/i.test(s.status) ? 100 : 0);
      return score(b) - score(a) || (b.studyDate > a.studyDate ? 1 : -1);
    });
    return ranked[0] ?? null;
  }, [data, modality, studyDescription]);

  if (!patientId || !bestPrior) return null;

  function insertInterval(change: IntervalChange) {
    onInsertFindings(buildComparisonSentence(change, {
      priorDateIso: bestPrior!.studyDate,
      priorStudyName: bestPrior!.testName,
    }));
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 p-2 rounded-md border border-sky-200 bg-sky-50/80 text-[11px] shrink-0"
      data-testid="prior-comparison-toolbar"
    >
      <GitCompare size={14} className="text-sky-600 shrink-0" />
      <span className="text-sky-900">
        Prior: <span className="font-medium">{bestPrior.testName}</span>
        {" "}({formatStudyDate(bestPrior.studyDate)})
        {comparisonMissing && <span className="text-amber-700 ml-1">· comparison not in report</span>}
      </span>
      {comparisonMissing && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 text-[10px] border-sky-300"
          disabled={disabled}
          onClick={() => onInsertFindings(comparisonBanner(bestPrior.studyDate, bestPrior.testName))}
        >
          Insert comparison line
        </Button>
      )}
      {INTERVAL_CHANGES.slice(0, 4).map((c) => (
        <Button
          key={c.value}
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 text-[10px] px-1.5"
          disabled={disabled}
          title={`Insert: ${c.label}`}
          onClick={() => insertInterval(c.value)}
        >
          {c.label}
        </Button>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 text-[10px] ml-auto"
        onClick={onOpenPriorTab}
      >
        All priors →
      </Button>
    </div>
  );
}
