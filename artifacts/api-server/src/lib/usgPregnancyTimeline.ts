/**
 * usgPregnancyTimeline — assemble a pregnancy timeline + trend series (P4.4).
 *
 * Reuses the canonical obstetricCalculations engine (GA, EDD, EFW) — it does NOT
 * reimplement any obstetric formula or embed reference charts. GA-by-ultrasound
 * is established once (earliest CRL/LMP) and projected forward to each scan date;
 * GA-by-dates comes from the LMP. Pure + testable.
 */

import {
  establishGa, projectGaForwardDays, gaDaysToWeeksDays,
  calcGaDaysFromLmp, calcEfwGrams,
} from "./obstetricCalculations";

export interface TimelineScanInput {
  studyInstanceUID: string;
  studyDate: string;         // YYYYMMDD or ISO
  lmp?: string | null;
  crlMm?: number | null;
  bpdMm?: number | null;
  hcMm?: number | null;
  acMm?: number | null;
  flMm?: number | null;
  afiCm?: number | null;
  efwGrams?: number | null;
  placenta?: string | null;
  presentation?: string | null;
}

export interface TimelinePoint {
  studyInstanceUID: string;
  date: string;                     // ISO date
  gaByDatesDays: number | null;
  gaByUltrasoundDays: number | null;
  gaDisplay: string | null;         // "28w 3d"
  efwGrams: number | null;
  crlMm: number | null;
  bpdMm: number | null;
  hcMm: number | null;
  acMm: number | null;
  flMm: number | null;
  afiCm: number | null;
  placenta: string | null;
  presentation: string | null;
}

export interface Trend {
  key: string;
  label: string;
  unit: string;
  points: { date: string; value: number }[];
}

export interface PregnancyTimeline {
  points: TimelinePoint[];
  trends: Trend[];
  established: { gaDays: number; method: string; date: string } | null;
}

function parseDate(d: string | null | undefined): number | null {
  if (!d) return null;
  const s = d.trim();
  const ymd = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymd) return Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3]);
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function gaDisplay(days: number | null): string | null {
  if (days == null) return null;
  const { weeks, days: d } = gaDaysToWeeksDays(days);
  return `${weeks}w ${d}d`;
}

export function buildPregnancyTimeline(scans: TimelineScanInput[]): PregnancyTimeline {
  const withMs = scans
    .map((s) => ({ s, ms: parseDate(s.studyDate) }))
    .filter((x): x is { s: TimelineScanInput; ms: number } => x.ms != null)
    .sort((a, b) => a.ms - b.ms);

  // Establish GA-by-ultrasound once, from the earliest scan carrying CRL or LMP.
  let established: PregnancyTimeline["established"] = null;
  for (const { s, ms } of withMs) {
    const estLmpMs = parseDate(s.lmp);
    const est = establishGa({ crlMm: s.crlMm ?? null, lmp: estLmpMs != null ? iso(estLmpMs) : null, asOfDate: new Date(ms) });
    if (est) { established = { gaDays: est.gaDays, method: est.method, date: iso(ms) }; break; }
  }

  const points: TimelinePoint[] = withMs.map(({ s, ms }) => {
    // Normalise LMP to ISO — the canonical engine parses ISO, not raw YYYYMMDD.
    const lmpMs = parseDate(s.lmp);
    const gaByDates = lmpMs != null ? calcGaDaysFromLmp(iso(lmpMs), new Date(ms)).value : null;
    const gaByUs = established ? projectGaForwardDays(established.gaDays, established.date, new Date(ms)) : null;
    const efw = s.efwGrams ?? (s.hcMm != null && s.acMm != null && s.flMm != null
      ? calcEfwGrams(s.hcMm, s.acMm, s.flMm).value
      : null);
    return {
      studyInstanceUID: s.studyInstanceUID,
      date: iso(ms),
      gaByDatesDays: gaByDates,
      gaByUltrasoundDays: gaByUs,
      gaDisplay: gaDisplay(gaByUs ?? gaByDates),
      efwGrams: efw,
      crlMm: s.crlMm ?? null,
      bpdMm: s.bpdMm ?? null,
      hcMm: s.hcMm ?? null,
      acMm: s.acMm ?? null,
      flMm: s.flMm ?? null,
      afiCm: s.afiCm ?? null,
      placenta: s.placenta ?? null,
      presentation: s.presentation ?? null,
    };
  });

  const series: { key: keyof TimelinePoint; label: string; unit: string }[] = [
    { key: "bpdMm", label: "BPD", unit: "mm" },
    { key: "hcMm", label: "HC", unit: "mm" },
    { key: "acMm", label: "AC", unit: "mm" },
    { key: "flMm", label: "FL", unit: "mm" },
    { key: "efwGrams", label: "EFW", unit: "g" },
    { key: "afiCm", label: "AFI", unit: "cm" },
  ];
  const trends: Trend[] = series.map(({ key, label, unit }) => ({
    key: String(key), label, unit,
    points: points
      .map((p) => ({ date: p.date, value: p[key] as number | null }))
      .filter((x): x is { date: string; value: number } => typeof x.value === "number"),
  })).filter((t) => t.points.length > 0);

  return { points, trends, established };
}
