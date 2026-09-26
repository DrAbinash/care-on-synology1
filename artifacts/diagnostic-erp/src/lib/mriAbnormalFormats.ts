/**
 * MRI abnormal Full Report Formats — top clinic patterns for Brain / LS /
 * Cervical / Dorsal. Ranking uses region + billed test name + referring-doctor
 * preference counts. Never auto-applies; UI calls applyFormatById on click.
 */

import type { ReportingStudyContext } from "@/lib/reportingStudyContext";
import { canonicalContentRegion } from "@/lib/reportingStudyContext";
import type { ReportFormat } from "@/lib/zai-workspace/types";
import { formatContextRank, type FormatLookupExtras } from "@/lib/zai-workspace/fullReportFormat";

/** Curated top clinic patterns (display order within region when scores tie). */
export const MRI_TOP_ABNORMAL_NAMES: Record<string, string[]> = {
  brain: [
    "MRI Brain — Fazekas 1",
    "MRI Brain — Fazekas Grade 1 + Senile Changes",
    "MRI Brain — Acute infarct (MCA)",
    "MRI Brain — Acute Hemorrhage",
    "MRI Brain — Chronic Infarct (Gliotic Changes)",
    "MRI Brain — Senile/Atrophic Changes",
    "MRI Brain — Hydrocephalus",
    "MRI Brain — Demyelination (MS)",
    "MRI Brain — Subdural Hematoma (SDH)",
    "MRI Brain — Glioma recurrence",
  ],
  "ls-spine": [
    "MRI LS Spine — Disc herniation L4-L5",
    "MRI LS Spine — Multilevel Degenerative",
    "MRI LS Spine — Spondylolisthesis (Grade I)",
    "MRI LS Spine — Compression Fracture",
    "MRI LS Spine + Whole Spine Screening",
  ],
  cervical: [
    "MRI Cervical Spine — Degenerative (Disc Bulge)",
    "MRI Cervical Spine — Loss of Lordosis",
    "MRI Cervical Spine — Cord Signal Change (Myelopathy)",
  ],
  dorsal: [
    "MRI Dorsal Spine — Compression Fracture",
    "MRI Dorsal Spine — Spondylodiscitis",
  ],
};

const NORMALISH = /\bnormal\b|\bscreening\b/i;
const PATHOLOGY_TAG = /fazekas|infarct|stroke|hemorrhage|haemorrhage|tumor|glioma|disc|herniation|stenosis|fracture|spondyl|myelopath|demyelin|hydrocephalus|senile|atrophy|infection|critical|bulge|listhesis/i;

export function isMriAbnormalFormat(format: Pick<ReportFormat, "name" | "diagnosisTags" | "modality">): boolean {
  if ((format.modality ?? "").toUpperCase() !== "MR") return false;
  const tags = (format.diagnosisTags ?? []).join(" ");
  if (PATHOLOGY_TAG.test(tags) || PATHOLOGY_TAG.test(format.name)) {
    // "… Screening — Normal" / plain Normal with only normal tags → exclude
    if (NORMALISH.test(format.name) && !PATHOLOGY_TAG.test(format.name) && !PATHOLOGY_TAG.test(tags)) {
      return false;
    }
    return true;
  }
  return false;
}

export function mriRegionKey(ctx: ReportingStudyContext | null | undefined): string | null {
  if (!ctx) return null;
  const region = canonicalContentRegion(ctx.region || ctx.bodyPart || "");
  const r = region.toLowerCase();
  if (r.includes("brain") || r.includes("head")) return "brain";
  if (r.includes("ls") || r.includes("lumbar") || r.includes("lumbosacral")) return "ls-spine";
  if (r.includes("cervical")) return "cervical";
  if (r.includes("dorsal") || r.includes("thoracic")) return "dorsal";
  return null;
}

function normalizeHay(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function testNameBoost(format: ReportFormat, billedTestName: string | null | undefined): number {
  const hay = normalizeHay(billedTestName ?? "");
  if (!hay) return 0;
  const name = normalizeHay(format.name);
  const tags = normalizeHay((format.diagnosisTags ?? []).join(" "));
  let score = 0;
  if (hay.includes("brain") && name.includes("brain")) score += 80;
  if ((hay.includes("ls") || hay.includes("lumbar") || hay.includes("lumbosacral")) && (name.includes("ls") || name.includes("lumbar"))) score += 80;
  if (hay.includes("cervical") && name.includes("cervical")) score += 80;
  if ((hay.includes("dorsal") || hay.includes("thoracic")) && (name.includes("dorsal") || name.includes("thoracic"))) score += 80;
  if (hay.includes("contrast") && /contrast|ce.?mri|gad/i.test(format.name + tags)) score += 40;
  if (hay.includes("screen") && /screen/i.test(format.name + tags)) score += 30;
  // Tag tokens from billed test (e.g. "stroke protocol")
  for (const token of hay.split(" ")) {
    if (token.length < 4) continue;
    if (tags.includes(token) || name.includes(token)) score += 15;
  }
  return score;
}

export type RankMriAbnormalOpts = {
  formats: ReportFormat[];
  ctx: ReportingStudyContext | null | undefined;
  billedTestName?: string | null;
  studyDescription?: string | null;
  protocolName?: string | null;
  /** Format ids the referring doctor has applied before (most → least). */
  doctorFavoriteFormatIds?: string[];
  limit?: number;
};

/**
 * Top abnormal MRI formats for the open study region, ranked for one-click apply.
 */
export function rankTopMriAbnormalFormats(opts: RankMriAbnormalOpts): ReportFormat[] {
  const region = mriRegionKey(opts.ctx);
  if (!region) return [];
  const curated = MRI_TOP_ABNORMAL_NAMES[region] ?? [];
  const curatedIndex = new Map(curated.map((n, i) => [n, i]));
  const extras: FormatLookupExtras = {
    protocolName: opts.protocolName ?? opts.ctx?.protocolName,
    studyDescription: [opts.billedTestName, opts.studyDescription, opts.ctx?.studyDescription]
      .filter(Boolean)
      .join(" "),
  };
  const doctorRank = new Map((opts.doctorFavoriteFormatIds ?? []).map((id, i) => [id, i]));

  const regionBody = (opts.ctx?.bodyPart || opts.ctx?.region || "").toLowerCase();
  const candidates = opts.formats.filter((f) => {
    if (!isMriAbnormalFormat(f)) return false;
    const bp = (f.bodyPart || "").toLowerCase();
    if (region === "brain") return bp.includes("brain") || bp.includes("head") || bp.includes("orbit");
    if (region === "ls-spine") return bp.includes("ls") || bp.includes("lumbar");
    if (region === "cervical") return bp.includes("cervical");
    if (region === "dorsal") return bp.includes("dorsal") || bp.includes("thoracic");
    return regionBody && bp.includes(regionBody.slice(0, 4));
  });

  const scored = candidates.map((f) => {
    let score = formatContextRank(f, extras);
    score += testNameBoost(f, opts.billedTestName);
    const ci = curatedIndex.get(f.name);
    if (ci != null) score += 500 - ci * 10;
    const di = doctorRank.get(f.id);
    if (di != null) score += 300 - di * 5;
    return { f, score };
  });

  scored.sort((a, b) => b.score - a.score || a.f.name.localeCompare(b.f.name));
  const limit = opts.limit ?? 10;
  const out: ReportFormat[] = [];
  const seen = new Set<string>();
  for (const { f } of scored) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
    if (out.length >= limit) break;
  }
  return out;
}

const DOCTOR_PREFS_KEY = "care_mri_abnormal_doctor_prefs_v1";

export type DoctorFormatPrefs = Record<string, Record<string, number>>;

export function doctorPrefKey(opts: {
  referringDoctorId?: number | null;
  referringDoctorName?: string | null;
}): string | null {
  if (opts.referringDoctorId != null && Number.isFinite(opts.referringDoctorId)) {
    return `id:${opts.referringDoctorId}`;
  }
  const name = (opts.referringDoctorName ?? "").trim().toLowerCase();
  return name ? `name:${name}` : null;
}

export function readDoctorFormatPrefs(storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null): DoctorFormatPrefs {
  if (!storage) return {};
  try {
    const raw = storage.getItem(DOCTOR_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DoctorFormatPrefs;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function recordDoctorFormatApply(
  opts: {
    referringDoctorId?: number | null;
    referringDoctorName?: string | null;
    formatId: string;
  },
  storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null,
): void {
  const key = doctorPrefKey(opts);
  if (!key || !storage || !opts.formatId) return;
  try {
    const all = readDoctorFormatPrefs(storage);
    const bucket = { ...(all[key] ?? {}) };
    bucket[opts.formatId] = (bucket[opts.formatId] ?? 0) + 1;
    all[key] = bucket;
    storage.setItem(DOCTOR_PREFS_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

/** Most-used format ids for a doctor (desc). */
export function favoriteFormatIdsForDoctor(
  opts: { referringDoctorId?: number | null; referringDoctorName?: string | null },
  storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null,
): string[] {
  const key = doctorPrefKey(opts);
  if (!key) return [];
  const bucket = readDoctorFormatPrefs(storage)[key] ?? {};
  return Object.entries(bucket)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}
