/**
 * Inspect mwl-guard quarantine folders (worklists-bad) without touching the DB.
 */
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveWorklistBadDirs, sanitizeQuarantineReason } from "./mwlDeploymentStatusPure";

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
  for (const dir of candidates) {
    try {
      await access(dir);
      const entries = await readdir(dir);
      const count = entries.filter(
        (f) => f.endsWith(".wl") || f.endsWith(".dcm") || f.endsWith(".bad"),
      ).length;
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
      if (count > best.count || (best.dir === null && count === 0)) {
        best = { count, dir, sampleReason };
      }
    } catch {
      /* not present */
    }
  }
  return best;
}
