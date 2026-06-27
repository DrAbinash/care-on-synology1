/**
 * FazekasGuide — Phase A5
 *
 * Inline SVG visual reference for Fazekas white matter grading (0–3).
 * Shown inside NeuroPromptPanel when "MRI Brain White Matter" category is selected.
 *
 * Clicking a grade cell inserts a pre-formatted Fazekas grading line into the
 * impression via the onSelectGrade callback.
 *
 * SVG drawn from scratch — no copyright. Schematic representation only.
 * No reproduction of any published image or atlas.
 *
 * Clinical reference:
 *   Fazekas F et al. MR signal abnormalities at 1.5T in Alzheimer's dementia
 *   and normal aging. AJR 1987; 149:351-356.
 *
 *   Grade 0: Absent
 *   Grade 1: Punctate foci
 *   Grade 2: Beginning confluence
 *   Grade 3: Large confluent areas
 *
 * Two scales assessed independently:
 *   Periventricular (PV)  — caps and bands around ventricles
 *   Subcortical (SC)      — deep and subcortical WM foci
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

interface Props {
  onSelectGrade: (text: string) => void;
}

type GradeKey = 0 | 1 | 2 | 3;

// ── SVG brain cross-section schematic per grade ───────────────────────────────

function BrainSliceSVG({ pvGrade, scGrade }: { pvGrade: GradeKey; scGrade: GradeKey }) {
  // Ventricle horn positions (schematic)
  const vx = 50; const vy = 42; const vw = 40; const vh = 18;

  // Periventricular WM dots/bands based on grade
  const pvMarks: React.ReactNode[] = [];
  if (pvGrade >= 1) {
    // Grade 1: punctate caps
    pvMarks.push(<ellipse key="pv-top" cx={70} cy={28} rx={8} ry={4} fill="#e2e8f0" opacity={0.85} />);
    pvMarks.push(<ellipse key="pv-bot" cx={70} cy={68} rx={8} ry={4} fill="#e2e8f0" opacity={0.85} />);
  }
  if (pvGrade >= 2) {
    // Grade 2: halos around ventricle
    pvMarks.push(<ellipse key="pv-halo" cx={70} cy={48} rx={28} ry={14} fill="none" stroke="#e2e8f0" strokeWidth={4} opacity={0.7} />);
  }
  if (pvGrade >= 3) {
    // Grade 3: large confluent band
    pvMarks.push(<ellipse key="pv-conf" cx={70} cy={48} rx={34} ry={18} fill="#cbd5e1" opacity={0.5} />);
  }

  // Subcortical WM dots based on grade
  const scDots: { cx: number; cy: number }[] = [];
  if (scGrade >= 1) {
    scDots.push({ cx: 22, cy: 38 }, { cx: 118, cy: 42 });
  }
  if (scGrade >= 2) {
    scDots.push({ cx: 18, cy: 55 }, { cx: 122, cy: 56 }, { cx: 25, cy: 68 }, { cx: 115, cy: 67 });
  }
  if (scGrade >= 3) {
    scDots.push(
      { cx: 20, cy: 48 }, { cx: 120, cy: 50 },
      { cx: 28, cy: 28 }, { cx: 112, cy: 32 },
      { cx: 30, cy: 75 }, { cx: 110, cy: 74 },
    );
  }

  return (
    <svg viewBox="0 0 140 96" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {/* Brain outline */}
      <ellipse cx={70} cy={48} rx={62} ry={44} fill="#1e293b" stroke="#334155" strokeWidth={1.5} />
      {/* Brain surface gyri hints */}
      <path d="M 18 36 Q 12 24 22 18" stroke="#334155" strokeWidth={1} fill="none" />
      <path d="M 122 36 Q 128 24 118 18" stroke="#334155" strokeWidth={1} fill="none" />
      <path d="M 12 52 Q 10 62 16 70" stroke="#334155" strokeWidth={1} fill="none" />
      <path d="M 128 52 Q 130 62 124 70" stroke="#334155" strokeWidth={1} fill="none" />
      {/* White matter body */}
      <ellipse cx={70} cy={48} rx={44} ry={32} fill="#1e3a5f" />
      {/* Periventricular marks */}
      {pvMarks}
      {/* Lateral ventricles (schematic) */}
      <ellipse cx={60} cy={46} rx={10} ry={7} fill="#0f172a" />
      <ellipse cx={80} cy={46} rx={10} ry={7} fill="#0f172a" />
      {/* Subcortical dots */}
      {scDots.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r={4} fill="#e2e8f0" opacity={0.75} />
      ))}
    </svg>
  );
}

const GRADE_LABELS: Record<GradeKey, string> = {
  0: "Absent",
  1: "Punctate",
  2: "Early confluent",
  3: "Confluent",
};

const GRADE_DESCRIPTIONS: Record<GradeKey, { pv: string; sc: string }> = {
  0: { pv: "No periventricular hyperintensity", sc: "No subcortical foci" },
  1: { pv: "Pencil-thin lining / caps", sc: "Punctate foci" },
  2: { pv: "Smooth halo around ventricles", sc: "Beginning confluence" },
  3: { pv: "Irregular extension into WM", sc: "Large confluent areas" },
};

export default function FazekasGuide({ onSelectGrade }: Props) {
  const [pvGrade, setPvGrade] = useState<GradeKey | null>(null);
  const [scGrade, setScGrade] = useState<GradeKey | null>(null);
  const [inserted, setInserted] = useState(false);

  const canInsert = pvGrade !== null && scGrade !== null;

  const handleInsert = () => {
    if (!canInsert) return;
    const pv = pvGrade as GradeKey;
    const sc = scGrade as GradeKey;
    const text = [
      `Fazekas periventricular grade ${pv} (${GRADE_LABELS[pv]}) — ${GRADE_DESCRIPTIONS[pv].pv}.`,
      `Fazekas subcortical grade ${sc} (${GRADE_LABELS[sc]}) — ${GRADE_DESCRIPTIONS[sc].sc}.`,
    ].join(" ");
    onSelectGrade(text);
    setInserted(true);
    setTimeout(() => setInserted(false), 2000);
  };

  return (
    <div className="border border-indigo-800/40 bg-indigo-950/10 rounded-lg p-3 flex flex-col gap-3">
      <div className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">
        Fazekas Scale — White Matter Grading
      </div>

      {/* Grade selector grid */}
      {(["Periventricular (PV)", "Subcortical (SC)"] as const).map((scale) => {
        const isPV = scale === "Periventricular (PV)";
        const current = isPV ? pvGrade : scGrade;
        const setter = isPV ? setPvGrade : setScGrade;

        return (
          <div key={scale}>
            <div className="text-[9px] text-slate-400 font-semibold mb-1.5">{scale}</div>
            <div className="grid grid-cols-4 gap-1.5">
              {([0, 1, 2, 3] as GradeKey[]).map((grade) => {
                const active = current === grade;
                return (
                  <button
                    key={grade}
                    onClick={() => { setter(grade); setInserted(false); }}
                    className={`flex flex-col items-center gap-1 p-1.5 rounded border transition-colors ${
                      active
                        ? "bg-indigo-700/40 border-indigo-500 ring-1 ring-indigo-500/50"
                        : "bg-slate-900/60 border-slate-700 hover:border-slate-500"
                    }`}
                  >
                    <div className="w-full" style={{ height: 44 }}>
                      <BrainSliceSVG
                        pvGrade={isPV ? grade : (pvGrade ?? 0)}
                        scGrade={!isPV ? grade : (scGrade ?? 0)}
                      />
                    </div>
                    <span className={`text-[9px] font-bold ${active ? "text-indigo-300" : "text-slate-400"}`}>
                      {grade}
                    </span>
                    <span className={`text-[7px] leading-tight text-center ${active ? "text-indigo-400" : "text-slate-600"}`}>
                      {GRADE_LABELS[grade]}
                    </span>
                  </button>
                );
              })}
            </div>
            {current !== null && (
              <div className="text-[9px] text-slate-400 mt-1 pl-1">
                {isPV ? GRADE_DESCRIPTIONS[current].pv : GRADE_DESCRIPTIONS[current].sc}
              </div>
            )}
          </div>
        );
      })}

      {/* Insert button */}
      <Button
        size="sm"
        className="h-6 text-[9px] bg-indigo-700 hover:bg-indigo-600 text-white disabled:opacity-40"
        disabled={!canInsert}
        onClick={handleInsert}
      >
        {inserted ? (
          <><CheckCircle2 size={9} className="mr-1 text-emerald-300" /> Inserted</>
        ) : (
          "Insert Fazekas grades into impression"
        )}
      </Button>

      <div className="text-[8px] text-slate-600 leading-relaxed">
        Fazekas F et al. AJR 1987. PV: periventricular caps/bands.
        SC: deep/subcortical foci. Grade independently for each region.
      </div>
    </div>
  );
}
