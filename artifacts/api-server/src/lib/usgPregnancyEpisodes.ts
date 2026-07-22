/**
 * usgPregnancyEpisodes — group obstetric scans into pregnancy episodes (P4.3).
 *
 * Uses safe identifiers (explicit EDD, LMP, or established GA + scan date) to
 * derive each scan's anchor EDD, then clusters scans with a close anchor EDD.
 * Two scans are NEVER merged into one pregnancy when their anchor EDDs differ
 * beyond tolerance (separate pregnancies stay separate). Deterministic — episode
 * ids are derived from the anchor EDD, not random. Manual regrouping is
 * supported via an override map (the caller audits the change). Pure + testable.
 */

const DAY = 86_400_000;
const TERM_DAYS = 280;
/** Anchor-EDD spread (days) within which scans belong to the same pregnancy. */
const SAME_EPISODE_EDD_TOLERANCE = 21;

export interface ObScan {
  studyInstanceUID: string;
  studyDate: string;            // YYYYMMDD or ISO
  lmp?: string | null;
  edd?: string | null;
  gaDays?: number | null;       // established GA at this scan, if known
}

export interface PregnancyEpisode {
  episodeId: string;
  anchorEdd: string | null;     // YYYY-MM-DD
  scans: ObScan[];
  startDate: string | null;
  endDate: string | null;
}

function parseDate(d: string | null | undefined): number | null {
  if (!d) return null;
  const s = d.trim();
  const ymd = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymd) return Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3]);
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}
function iso(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString().slice(0, 10);
}

/** Anchor EDD (ms) for a scan: explicit EDD > LMP+280 > scanDate+(280−GA). */
export function anchorEddMs(scan: ObScan): number | null {
  const edd = parseDate(scan.edd);
  if (edd != null) return edd;
  const lmp = parseDate(scan.lmp);
  if (lmp != null) return lmp + TERM_DAYS * DAY;
  const sd = parseDate(scan.studyDate);
  if (sd != null && scan.gaDays != null) return sd + (TERM_DAYS - scan.gaDays) * DAY;
  return null;
}

export function groupPregnancyEpisodes(
  scans: ObScan[],
  overrides: Record<string, string> = {},
): PregnancyEpisode[] {
  // Sort by scan date (stable, deterministic).
  const sorted = [...scans].sort((a, b) => (parseDate(a.studyDate) ?? 0) - (parseDate(b.studyDate) ?? 0));

  const episodes: { anchorEdd: number | null; scans: ObScan[] }[] = [];
  const byOverride = new Map<string, { anchorEdd: number | null; scans: ObScan[] }>();

  for (const scan of sorted) {
    const override = overrides[scan.studyInstanceUID];
    if (override) {
      let ep = byOverride.get(override);
      if (!ep) { ep = { anchorEdd: anchorEddMs(scan), scans: [] }; byOverride.set(override, ep); episodes.push(ep); }
      ep.scans.push(scan);
      continue;
    }
    const anchor = anchorEddMs(scan);
    // Find an episode whose anchor EDD is within tolerance (both known).
    let target = anchor != null
      ? episodes.find((e) => e.anchorEdd != null && Math.abs(e.anchorEdd - anchor) <= SAME_EPISODE_EDD_TOLERANCE * DAY)
      : undefined;
    // If this scan has no anchor, attach to the most recent episode only if the
    // scan date is within a single-pregnancy window of that episode's last scan.
    if (!target && anchor == null && episodes.length) {
      const last = episodes[episodes.length - 1];
      const lastScanMs = parseDate(last.scans[last.scans.length - 1].studyDate);
      const thisMs = parseDate(scan.studyDate);
      if (lastScanMs != null && thisMs != null && Math.abs(thisMs - lastScanMs) <= (TERM_DAYS + 30) * DAY) target = last;
    }
    if (!target) { target = { anchorEdd: anchor, scans: [] }; episodes.push(target); }
    else if (target.anchorEdd == null && anchor != null) target.anchorEdd = anchor;
    target.scans.push(scan);
  }

  return episodes.map((e, i) => {
    const dates = e.scans.map((s) => parseDate(s.studyDate)).filter((m): m is number => m != null);
    return {
      episodeId: e.anchorEdd != null ? `ep_edd_${iso(e.anchorEdd)}` : `ep_${i + 1}`,
      anchorEdd: iso(e.anchorEdd),
      scans: e.scans,
      startDate: dates.length ? iso(Math.min(...dates)) : null,
      endDate: dates.length ? iso(Math.max(...dates)) : null,
    };
  });
}
