/**
 * Phase 4: composition root is thin — source-grep contracts must scan
 * pages/RadiologyReportingWorkspace.tsx + hooks/radiology-workspace/* +
 * components/radiology/workspace/*.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ERP_SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

export function readModularWorkspaceSrc(erpSrc: string = ERP_SRC): string {
  const chunks = [readFileSync(join(erpSrc, "pages/RadiologyReportingWorkspace.tsx"), "utf8")];
  for (const dir of ["hooks/radiology-workspace", "components/radiology/workspace"]) {
    for (const name of readdirSync(join(erpSrc, dir))) {
      if (name.endsWith(".ts") || name.endsWith(".tsx")) {
        chunks.push(readFileSync(join(erpSrc, dir, name), "utf8"));
      }
    }
  }
  return chunks.join("\n");
}

export { ERP_SRC };
