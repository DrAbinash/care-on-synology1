/**
 * Probe atomic rename from staging → live worklists (detects EXDEV).
 * No DB imports — safe for unit tests.
 */

import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function probeAtomicPublish(
  liveDir: string,
  staging: string,
): Promise<{ ok: boolean; detail: string; code?: string }> {
  if (path.resolve(staging) === path.resolve(liveDir)) {
    return {
      ok: false,
      detail: "Staging directory must not equal the live Orthanc worklists directory",
      code: "SAME_DIR",
    };
  }
  try {
    await mkdir(staging, { recursive: true });
    await mkdir(liveDir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      detail: `Cannot create staging/live dirs: ${err instanceof Error ? err.message : String(err)}`,
      code: "MKDIR",
    };
  }
  const stagePath = path.join(staging, `.mwl_atomic_probe_${process.pid}.tmp`);
  const finalPath = path.join(liveDir, `.mwl_atomic_probe_${process.pid}.tmp`);
  try {
    await writeFile(stagePath, "atomic-probe", "utf8");
    await rename(stagePath, finalPath);
    await unlink(finalPath).catch(() => {});
    return {
      ok: true,
      detail: `Atomic rename OK (staging ${staging} → live ${liveDir})`,
    };
  } catch (err) {
    await unlink(stagePath).catch(() => {});
    await unlink(finalPath).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EXDEV" || /cross-device|EXDEV/i.test(msg)) {
      return {
        ok: false,
        detail: `EXDEV: staging and live worklists are on different filesystems — atomic publish refuses copy. staging=${staging} live=${liveDir}`,
        code: "EXDEV",
      };
    }
    return {
      ok: false,
      detail: `Atomic rename failed: ${msg}`,
      code: code || "RENAME",
    };
  }
}
