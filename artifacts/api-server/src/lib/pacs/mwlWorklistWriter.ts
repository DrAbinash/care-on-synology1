/**
 * mwlWorklistWriter.ts — push scheduled procedures to the PACS Modality Worklist.
 *
 * The gap this closes (PACS_CURRENT_STATE_REPORT.md): scheduled procedures were
 * stored and shown in the staff dashboard, but nothing made them queryable by
 * modalities via DICOM MWL C-FIND, so technologists re-key patient data at the
 * scanner. This writes each scheduled procedure as an Orthanc **worklist file**
 * (a DICOM dataset the Orthanc "worklists" plugin serves over MWL C-FIND) into a
 * shared folder.
 *
 * Deployment (all required to ACTIVATE — the module is completely inert without
 * ORTHANC_WORKLIST_DIR, so existing deployments are unaffected):
 *   1. Install DCMTK in the API image (done in Dockerfile — provides dump2dcm).
 *   2. Mount a folder shared between the API container and Orthanc; set
 *      ORTHANC_WORKLIST_DIR to the API-side path.
 *   3. Enable Orthanc's worklists plugin pointing "Database" at the Orthanc-side
 *      path of the same folder.
 * Because the generated files are real DICOM, VALIDATE on-site (query with
 * `findscu` / a modality) before relying on it clinically.
 *
 * Safety: every operation is best-effort and never throws into a request — a
 * missing dump2dcm, a bad value, or an I/O error is logged and swallowed. The
 * scheduling flow is the source of truth; a failed worklist write never blocks
 * it (the periodic/manual sync re-generates the folder from the DB).
 */

import { spawn } from "node:child_process";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { logger } from "../logger";

export interface MwlProcedure {
  accessionNumber: string;
  patientId?: string | null;
  patientName?: string | null;
  patientSex?: string | null;
  patientDob?: string | null;
  modality?: string | null;
  studyDescription?: string | null;
  procedureName?: string | null;
  referringDoctor?: string | null;
  scheduledDate?: string | null; // YYYYMMDD
  scheduledTime?: string | null; // HHMMSS
  stationAeTitle?: string | null;
  bodyPartExamined?: string | null;
}

/** The shared worklist folder, or null when the feature isn't configured. */
export function worklistDir(): string | null {
  const dir = process.env.ORTHANC_WORKLIST_DIR?.trim();
  return dir || null;
}

export function isMwlEnabled(): boolean {
  return worklistDir() !== null;
}

// DICOM value hygiene: backslash is the multi-value / PN-component separator and
// "]" would break the dump2dcm bracket syntax — strip both, plus control chars.
function esc(v: string | null | undefined): string {
  return (v ?? "").replace(/[\\\]\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
}
function toPn(name: string | null | undefined): string {
  return esc(name) || "ANONYMOUS";
}
function digits(v: string | null | undefined): string {
  return (v ?? "").replace(/[^0-9]/g, "");
}
function fileFor(accession: string): string | null {
  const dir = worklistDir();
  if (!dir) return null;
  return path.join(dir, accession.replace(/[^A-Za-z0-9._-]/g, "_") + ".wl");
}

// dump2dcm textual dump for one worklist item. StudyInstanceUID is left empty so
// the modality assigns it; the accession number is the linking key.
function buildDump(p: MwlProcedure): string {
  const modality = esc(p.modality).toUpperCase() || "OT";
  const desc = esc(p.studyDescription || p.procedureName || "");
  return [
    `(0008,0005) CS [ISO_IR 100]`,
    `(0008,0050) SH [${esc(p.accessionNumber)}]`,
    `(0010,0010) PN [${toPn(p.patientName)}]`,
    `(0010,0020) LO [${esc(p.patientId)}]`,
    `(0010,0030) DA [${digits(p.patientDob)}]`,
    `(0010,0040) CS [${esc(p.patientSex)}]`,
    `(0020,000D) UI []`,
    `(0032,1060) LO [${desc}]`,
    `(0008,0090) PN [${toPn(p.referringDoctor)}]`,
    `(0018,0015) CS [${esc(p.bodyPartExamined)}]`,
    `(0040,1001) SH [${esc(p.accessionNumber)}]`,
    `(0040,0100) SQ`,
    `  (fffe,e000) na`,
    `    (0008,0060) CS [${modality}]`,
    `    (0040,0001) AE [${esc(p.stationAeTitle) || "ANY"}]`,
    `    (0040,0002) DA [${digits(p.scheduledDate)}]`,
    `    (0040,0003) TM [${digits(p.scheduledTime)}]`,
    `    (0040,0007) LO [${desc}]`,
    `    (0040,0009) SH [${esc(p.accessionNumber)}]`,
    `  (fffe,e00d) na`,
    `(fffe,e0dd) na`,
    ``,
  ].join("\n");
}

function runDump2Dcm(dumpText: string, outPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const tmp = path.join(os.tmpdir(), `mwl_${path.basename(outPath)}_${process.pid}.txt`);
    writeFile(tmp, dumpText, "utf8")
      .then(() => {
        const proc = spawn("dump2dcm", [tmp, outPath], { stdio: "ignore" });
        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          unlink(tmp).catch(() => {});
          resolve(ok);
        };
        proc.on("error", () => finish(false)); // dump2dcm not installed / not on PATH
        proc.on("close", (code) => finish(code === 0));
        setTimeout(() => { try { proc.kill(); } catch { /* already gone */ } finish(false); }, 15_000);
      })
      .catch(() => resolve(false));
  });
}

/** Write/refresh the worklist file for one scheduled procedure. Best-effort. */
export async function writeWorklistFile(p: MwlProcedure): Promise<boolean> {
  try {
    const dir = worklistDir();
    if (!dir || !p.accessionNumber) return false;
    const out = fileFor(p.accessionNumber);
    if (!out) return false;
    await mkdir(dir, { recursive: true }).catch(() => {});
    const ok = await runDump2Dcm(buildDump(p), out);
    if (!ok) logger.warn({ accession: p.accessionNumber }, "mwl: dump2dcm failed (is DCMTK installed?)");
    return ok;
  } catch (err) {
    logger.warn({ err, accession: p.accessionNumber }, "mwl: writeWorklistFile failed");
    return false;
  }
}

/** Remove the worklist file for a procedure (completed / cancelled). Best-effort. */
export async function removeWorklistFile(accessionNumber: string): Promise<void> {
  try {
    const out = fileFor(accessionNumber);
    if (out) await unlink(out).catch(() => {}); // ignore missing file
  } catch (err) {
    logger.warn({ err, accession: accessionNumber }, "mwl: removeWorklistFile failed");
  }
}

/** Terminal statuses whose procedures should NOT appear on the modality worklist. */
export const MWL_TERMINAL_STATUSES = new Set(["COMPLETED", "CANCELLED", "CANCELED", "DISCONTINUED", "ARRIVED"]);

/** Reconcile one procedure's worklist file with its status. */
export async function syncWorklistForStatus(p: MwlProcedure, status: string): Promise<void> {
  if (MWL_TERMINAL_STATUSES.has((status || "").toUpperCase())) {
    await removeWorklistFile(p.accessionNumber);
  } else {
    await writeWorklistFile(p);
  }
}
