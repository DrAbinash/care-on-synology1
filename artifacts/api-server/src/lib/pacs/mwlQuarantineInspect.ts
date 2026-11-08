/**
 * Inspect mwl-guard quarantine folders (worklists-bad) without touching the DB.
 */
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveWorklistBadDirs, sanitizeQuarantineReason } from "./mwlDeploymentStatusPure";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function inspectWorklistQuarantine(
  liveDir: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  count: number;
  dir: string | null;
  sampleReason: string | null;
}> {
  const candidates = resolveWorklistBadDirs(liveDir, env);
  let best: { count: number; dir: string | null; sampleReason: string | null } = {
    count: 0,
    dir: null,
    sampleReason: null,
  };
  const now = Date.now();
  for (const dir of candidates) {
    try {
      await access(dir);
      const entries = await readdir(dir);
      const wlFiles = entries.filter(
        (f) => f.endsWith(".wl") || f.endsWith(".dcm") || f.endsWith(".bad"),
      );
      // Only count files modified in the last 30 days (ignore old acceptance-test residue)
      let recentCount = 0;
      for (const f of wlFiles) {
        try {
          const st = await stat(path.join(dir, f));
          if (now - st.mtimeMs < THIRTY_DAYS_MS) {
            recentCount++;
          }
        } catch {
          // If we can't stat, don't count it
        }
      }
      let sampleReason: string | null = null;
      const reasonFile = entries.find((f) => f.endsWith(".reason.txt"));
      if (reasonFile) {
        try {
          const text = await readFile(path.join(dir, reasonFile), "utf8");
          sampleReason = sanitizeQuarantineReason(text);
        } catch {
          /* unreadable */
        }
      }
      if (recentCount > best.count || (best.dir === null && recentCount === 0)) {
        best = { count: recentCount, dir, sampleReason };
      }
    } catch {
      /* not present */
    }
  }
  return best;
}
