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

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile, unlink, mkdir, rename, copyFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { logger } from "../logger";

/** Modality Worklist Information Model — FIND (required SOP Class on .wl files). */
const MWL_SOP_CLASS = "1.2.840.10008.5.1.4.31";
/** Care numeric root — deterministic UIDs from accession (digits/dots only; DICOM UI). */
const CARE_MWL_ROOT = "1.2.840.9999.113";
/** Role component: 1=study, 2=series, 3=sop */
const UID_ROLE = { study: "1", series: "2", sop: "3" } as const;
/** Reject dumps that would crash Orthanc's worklist housekeeper. */
const EMPTY_UID_TAG = /\((?:0008,0018|0020,000D|0020,000E)\)\s+UI\s+\[\s*\]/;

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
  /** Free-text comments shown on many consoles; we stash CARE bill/order ids here. */
  comments?: string | null;
  sourceBillId?: string | null;
  sourceOrderId?: string | null;
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
/**
 * DICOM Person Name for MWL: Family^Given.
 * ERP stores "Given Family" (or already-caret PN) — convert so the modality
 * copies a standard PN that comes back matchable by accession + cleaned name.
 */
function toPn(name: string | null | undefined): string {
  const cleaned = esc(name);
  if (!cleaned) return "ANONYMOUS";
  if (cleaned.includes("^")) return cleaned;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const given = parts.slice(0, -1).join(" ");
  const family = parts[parts.length - 1];
  return `${family}^${given}`;
}

function buildComments(p: MwlProcedure): string {
  const bits: string[] = [];
  if (p.comments) bits.push(esc(p.comments));
  if (p.sourceBillId) bits.push(`CARE-BILL:${esc(p.sourceBillId)}`);
  if (p.sourceOrderId) bits.push(`CARE-ORDER:${esc(p.sourceOrderId)}`);
  bits.push(`CARE-ACC:${esc(p.accessionNumber)}`);
  return bits.filter(Boolean).join(" | ");
}
function digits(v: string | null | undefined): string {
  return (v ?? "").replace(/[^0-9]/g, "");
}
function fileFor(accession: string): string | null {
  const dir = worklistDir();
  if (!dir) return null;
  return path.join(dir, accession.replace(/[^A-Za-z0-9._-]/g, "_") + ".wl");
}

/** Staging dir outside Orthanc's watched folder (sibling `worklists-staging` or OS tmp). */
function stagingDir(): string {
  const live = worklistDir();
  if (live) {
    const sibling = path.join(path.dirname(live), "worklists-staging");
    return sibling;
  }
  return os.tmpdir();
}

/**
 * Refuse dumps that Orthanc's worklist housekeeper would reject (empty UIDs).
 * Exported for unit tests.
 */
export function assertValidMwlDump(dumpText: string): void {
  if (EMPTY_UID_TAG.test(dumpText)) {
    throw new Error("MWL dump contains empty Study/Series/SOP Instance UID — refusing write");
  }
  for (const tag of ["(0008,0016)", "(0008,0018)", "(0020,000D)", "(0020,000E)"]) {
    const re = new RegExp(tag.replace(/[()]/g, "\\$&") + "\\s+UI\\s+\\[([^\\]]*)\\]");
    const m = dumpText.match(re);
    if (!m || !m[1].trim()) {
      throw new Error(`MWL dump missing non-empty UID for ${tag}`);
    }
  }
  if (!dumpText.includes("(0040,0100) SQ")) {
    throw new Error("MWL dump missing ScheduledProcedureStepSequence");
  }
}

/** Deterministic DICOM UID suffix from accession + role (stable across MWL re-sync). */
function uidSuffix(accession: string, role: string): string {
  const hash = createHash("sha256").update(`${accession}\0${role}`).digest("hex");
  return BigInt(`0x${hash.slice(0, 15)}`).toString();
}

/** Pre-allocated StudyInstanceUID for the scheduled procedure (Orthanc housekeeper requires this). */
export function mwlStudyInstanceUid(accession: string): string {
  return `${CARE_MWL_ROOT}.${UID_ROLE.study}.${uidSuffix(accession, "study")}`;
}

export function mwlSeriesInstanceUid(accession: string): string {
  return `${CARE_MWL_ROOT}.${UID_ROLE.series}.${uidSuffix(accession, "series")}`;
}

export function mwlSopInstanceUid(accession: string): string {
  return `${CARE_MWL_ROOT}.${UID_ROLE.sop}.${uidSuffix(accession, "sop")}`;
}

// dump2dcm textual dump for one worklist item. UIDs are pre-allocated from the
// accession so Orthanc's worklist housekeeper accepts the file; accession remains
// the clinical linking key when the modality assigns its own study UID on scan.
function buildDump(p: MwlProcedure): string {
  const acc = esc(p.accessionNumber);
  const modality = esc(p.modality).toUpperCase() || "OT";
  const desc = esc(p.studyDescription || p.procedureName || "");
  const comments = buildComments(p);
  return [
    `(0008,0005) CS [ISO_IR 100]`,
    `(0008,0016) UI [${MWL_SOP_CLASS}]`,
    `(0008,0018) UI [${mwlSopInstanceUid(acc)}]`,
    `(0008,0050) SH [${acc}]`,
    `(0010,0010) PN [${toPn(p.patientName)}]`,
    `(0010,0020) LO [${esc(p.patientId)}]`,
    `(0010,0030) DA [${digits(p.patientDob)}]`,
    `(0010,0040) CS [${esc(p.patientSex)}]`,
    `(0020,000D) UI [${mwlStudyInstanceUid(acc)}]`,
    `(0020,000E) UI [${mwlSeriesInstanceUid(acc)}]`,
    `(0032,1060) LO [${desc}]`,
    `(0008,0090) PN [${toPn(p.referringDoctor)}]`,
    `(0018,0015) CS [${esc(p.bodyPartExamined)}]`,
    `(0040,1001) SH [${esc(p.accessionNumber)}]`,
    // Work / bill ids — modality may copy into study; Care matches primarily on accession.
    `(0040,1400) LT [${comments}]`,
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

/** Exported for unit tests — DICOM PN formatting used on the wire to modalities. */
export function formatMwlPersonName(name: string | null | undefined): string {
  return toPn(name);
}

function runDump2Dcm(dumpText: string, outPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const tmpDump = path.join(os.tmpdir(), `mwl_${path.basename(outPath)}_${process.pid}.txt`);
    writeFile(tmpDump, dumpText, "utf8")
      .then(() => {
        const proc = spawn("dump2dcm", [tmpDump, outPath], { stdio: "ignore" });
        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          unlink(tmpDump).catch(() => {});
          resolve(ok);
        };
        proc.on("error", () => finish(false)); // dump2dcm not installed / not on PATH
        proc.on("close", (code) => finish(code === 0));
        setTimeout(() => { try { proc.kill(); } catch { /* already gone */ } finish(false); }, 15_000);
      })
      .catch(() => resolve(false));
  });
}

/**
 * Atomically publish a worklist into Orthanc's watched folder:
 *   validate dump → dump2dcm into staging (outside watch) → rename into live .wl
 * Orthanc must never observe a partially-written or empty-UID file.
 */
async function publishWorklistAtomically(dumpText: string, finalPath: string): Promise<boolean> {
  assertValidMwlDump(dumpText);
  const stageRoot = stagingDir();
  await mkdir(stageRoot, { recursive: true }).catch(() => {});
  await mkdir(path.dirname(finalPath), { recursive: true }).catch(() => {});
  const stagePath = path.join(stageRoot, `${path.basename(finalPath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    const ok = await runDump2Dcm(dumpText, stagePath);
    if (!ok) return false;
    try {
      await rename(stagePath, finalPath);
    } catch {
      // Cross-device rename can fail; copy then unlink staging.
      await copyFile(stagePath, finalPath);
      await unlink(stagePath).catch(() => {});
    }
    return true;
  } catch (err) {
    await unlink(stagePath).catch(() => {});
    throw err;
  }
}

/** Write/refresh the worklist file for one scheduled procedure. Best-effort. */
export async function writeWorklistFile(p: MwlProcedure): Promise<boolean> {
  try {
    const dir = worklistDir();
    if (!dir || !p.accessionNumber) return false;
    const out = fileFor(p.accessionNumber);
    if (!out) return false;
    const dump = buildDump(p);
    const ok = await publishWorklistAtomically(dump, out);
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
