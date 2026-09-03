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
import { writeFile, unlink, mkdir, rename } from "node:fs/promises";
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
const DICOM_UID_RE = /^[0-9]+(\.[0-9]+)+$/;

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

/** Staging dir for dump2dcm output before atomic rename into Orthanc's watched folder.
 *
 * Must be on the SAME Docker bind mount as the live worklists directory so
 * `rename()` is atomic. Separate binds (historical `/worklists-staging` vs
 * `/orthanc-worklists`) cause EXDEV and are refused — never copyFile.
 *
 * Default: `<ORTHANC_WORKLIST_DIR>/staging` (subdirectory). Orthanc's worklists
 * plugin uses a non-recursive directory_iterator and only loads `*.wl`, so
 * staging/*.tmp files are not published to modalities.
 *
 * Override with ORTHANC_WORKLIST_STAGING_DIR when staging is a sibling under the
 * same parent mount (e.g. /orthanc-mwl/worklists-staging next to …/worklists).
 */
export function resolveMwlStagingDir(liveDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ORTHANC_WORKLIST_STAGING_DIR?.trim();
  if (override) return path.resolve(override);
  return path.resolve(path.join(liveDir, "staging"));
}

function stagingDir(): string {
  const live = worklistDir();
  if (live) return resolveMwlStagingDir(live);
  return os.tmpdir();
}

/** Public accessor for diagnostics / Settings MWL panel (same rules as publish). */
export function getMwlStagingDir(): string {
  return stagingDir();
}

/**
 * Refuse dumps that Orthanc's worklist housekeeper would reject (empty/invalid UIDs).
 * Exported for unit tests.
 */
export function assertValidMwlDump(dumpText: string): void {
  if (EMPTY_UID_TAG.test(dumpText)) {
    throw new Error("MWL dump contains empty Study/Series/SOP Instance UID — refusing write");
  }
  for (const tag of ["(0008,0016)", "(0008,0018)", "(0020,000D)", "(0020,000E)"]) {
    const re = new RegExp(tag.replace(/[()]/g, "\\$&") + "\\s+UI\\s+\\[([^\\]]*)\\]");
    const m = dumpText.match(re);
    const uid = m?.[1]?.trim() ?? "";
    if (!uid) {
      throw new Error(`MWL dump missing non-empty UID for ${tag}`);
    }
    if (uid.length > 64 || !DICOM_UID_RE.test(uid)) {
      throw new Error(`MWL dump has invalid DICOM UID for ${tag}: ${uid}`);
    }
  }
  if (!dumpText.includes("(0040,0100) SQ")) {
    throw new Error("MWL dump missing ScheduledProcedureStepSequence");
  }
}

/** Ensure generated UIDs themselves always meet DICOM rules (defense in depth). */
export function assertValidGeneratedUid(uid: string, label: string): void {
  if (!uid || uid.length > 64 || !DICOM_UID_RE.test(uid)) {
    throw new Error(`Invalid generated ${label}: ${uid}`);
  }
}

/** Deterministic DICOM UID suffix from accession + role (stable across MWL re-sync). */
function uidSuffix(accession: string, role: string): string {
  const hash = createHash("sha256").update(`${accession}\0${role}`).digest("hex");
  return BigInt(`0x${hash.slice(0, 15)}`).toString();
}

/** Pre-allocated StudyInstanceUID for the scheduled procedure (Orthanc housekeeper requires this). */
export function mwlStudyInstanceUid(accession: string): string {
  const uid = `${CARE_MWL_ROOT}.${UID_ROLE.study}.${uidSuffix(accession, "study")}`;
  assertValidGeneratedUid(uid, "StudyInstanceUID");
  return uid;
}

export function mwlSeriesInstanceUid(accession: string): string {
  const uid = `${CARE_MWL_ROOT}.${UID_ROLE.series}.${uidSuffix(accession, "series")}`;
  assertValidGeneratedUid(uid, "SeriesInstanceUID");
  return uid;
}

export function mwlSopInstanceUid(accession: string): string {
  const uid = `${CARE_MWL_ROOT}.${UID_ROLE.sop}.${uidSuffix(accession, "sop")}`;
  assertValidGeneratedUid(uid, "SOPInstanceUID");
  return uid;
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
    // Never invent literal "ANY" — Orthanc matches AE titles as strings, so
    // "ANY" does not satisfy a modality querying for its own AE (e.g. UIH).
    // Empty = unconfigured station; configure dicom_modalities / study AE.
    `    (0040,0001) AE [${esc(p.stationAeTitle)}]`,
    `    (0040,0002) DA [${digits(p.scheduledDate)}]`,
    `    (0040,0003) TM [${digits(p.scheduledTime)}]`,
    `    (0040,0007) LO [${desc}]`,
    `    (0040,0009) SH [${esc(p.accessionNumber)}]`,
    `  (fffe,e00d) na`,
    `(fffe,e0dd) na`,
    ``,
  ].join("\n");
}

/** Exported for acceptance tests — same dump text Orthanc receives via dump2dcm. */
export function buildMwlDumpText(p: MwlProcedure): string {
  return buildDump(p);
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

/** Post-dump2dcm: confirm binary file exposes non-empty Study/Series/SOP UIDs via dcmdump. */
function validateDicomUidsWithDcmdump(filePath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const proc = spawn(
      "dcmdump",
      ["+P", "StudyInstanceUID", "+P", "SeriesInstanceUID", "+P", "SOPInstanceUID", filePath],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    proc.stdout?.on("data", (chunk: Buffer) => { out += chunk.toString("utf8"); });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    proc.on("error", () => finish(false)); // dcmdump missing — caller decides policy
    proc.on("close", (code) => {
      if (code !== 0) return finish(false);
      const has = (keyword: string) => {
        const re = new RegExp(`${keyword}\\s+[^\\[]*\\[([^\\]]+)\\]`);
        const m = out.match(re);
        const v = m?.[1]?.trim() ?? "";
        return v.length > 0 && v.length <= 64 && DICOM_UID_RE.test(v);
      };
      // dcmdump +P output varies; also accept lines containing the keywords with brackets
      const nonempty = (name: string) => {
        if (has(name)) return true;
        const idx = out.indexOf(name);
        if (idx < 0) return false;
        const slice = out.slice(idx, idx + 200);
        const m = slice.match(/\[([^\]]+)\]/);
        const v = m?.[1]?.trim() ?? "";
        return v.length > 0 && v.length <= 64 && DICOM_UID_RE.test(v);
      };
      finish(nonempty("StudyInstanceUID") && nonempty("SeriesInstanceUID") && nonempty("SOPInstanceUID"));
    });
    setTimeout(() => { try { proc.kill(); } catch { /* gone */ } finish(false); }, 10_000);
  });
}

export type MwlPublishFailureReason =
  | "dump2dcm"
  | "validation"
  | "atomic_rename"
  | "staging_config"
  | "io";

export type MwlPublishResult =
  | { ok: true }
  | { ok: false; reason: MwlPublishFailureReason; detail: string; code?: string };

/**
 * Atomically publish a worklist into Orthanc's watched folder:
 *   validate dump → dump2dcm into staging (outside Orthanc flat scan) →
 *   validate DICOM → rename into live .wl (same filesystem required).
 *
 * Never copyFile into the watched folder (non-atomic; Orthanc could read a partial file).
 */
export async function publishWorklistAtomically(dumpText: string, finalPath: string): Promise<MwlPublishResult> {
  assertValidMwlDump(dumpText);
  const liveDir = path.dirname(finalPath);
  const stageRoot = resolveMwlStagingDir(liveDir);
  // Staging must not be the Orthanc Database/Directory folder itself.
  if (path.resolve(stageRoot) === path.resolve(liveDir)) {
    return {
      ok: false,
      reason: "staging_config",
      detail: "MWL staging dir must not equal Orthanc watched worklists dir",
      code: "SAME_DIR",
    };
  }
  await mkdir(stageRoot, { recursive: true }).catch(() => {});
  await mkdir(liveDir, { recursive: true }).catch(() => {});
  const stagePath = path.join(stageRoot, `${path.basename(finalPath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    const converted = await runDump2Dcm(dumpText, stagePath);
    if (!converted) {
      await unlink(stagePath).catch(() => {});
      return {
        ok: false,
        reason: "dump2dcm",
        detail: "dump2dcm failed or is not installed / not on PATH",
      };
    }

    const dicomOk = await validateDicomUidsWithDcmdump(stagePath);
    if (!dicomOk) {
      // If dcmdump is unavailable, dump text already passed assertValidMwlDump;
      // still refuse empty zero-byte outputs.
      const { stat } = await import("node:fs/promises");
      const st = await stat(stagePath).catch(() => null);
      if (!st || st.size <= 0) {
        await unlink(stagePath).catch(() => {});
        return {
          ok: false,
          reason: "validation",
          detail: "post-dump2dcm output missing or empty",
        };
      }
      if (st.size < 128) {
        await unlink(stagePath).catch(() => {});
        logger.warn({ stagePath, size: st.size }, "mwl: post-dump2dcm file too small — refusing publish");
        return {
          ok: false,
          reason: "validation",
          detail: `post-dump2dcm file too small (${st.size} bytes)`,
        };
      }
      logger.warn({ stagePath }, "mwl: dcmdump validation unavailable/failed — proceeding on dump-text validation + size check");
    }

    try {
      await rename(stagePath, finalPath);
    } catch (err) {
      // Cross-device rename is NOT atomically safe into Orthanc's watch folder.
      await unlink(stagePath).catch(() => {});
      const code = (err as NodeJS.ErrnoException)?.code;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err, stagePath, finalPath, code },
        "mwl: atomic publish/rename failed (staging must be on the same filesystem as worklists) — refusing non-atomic copy",
      );
      return {
        ok: false,
        reason: "atomic_rename",
        detail: msg,
        code,
      };
    }
    return { ok: true };
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
    const result = await publishWorklistAtomically(dump, out);
    if (!result.ok) {
      if (result.reason === "dump2dcm") {
        logger.warn(
          { accession: p.accessionNumber, detail: result.detail },
          "mwl: dump2dcm conversion failed (is DCMTK dump2dcm installed and on PATH?)",
        );
      } else if (result.reason === "validation") {
        logger.warn(
          { accession: p.accessionNumber, detail: result.detail },
          "mwl: post-conversion validation failed — refusing publish",
        );
      } else if (result.reason === "atomic_rename") {
        logger.warn(
          { accession: p.accessionNumber, detail: result.detail, code: result.code },
          "mwl: atomic publish/rename failed (EXDEV or I/O) — staging and live must share one Docker mount",
        );
      } else {
        logger.warn(
          { accession: p.accessionNumber, reason: result.reason, detail: result.detail },
          "mwl: worklist publish failed",
        );
      }
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err, accession: p.accessionNumber }, "mwl: writeWorklistFile failed");
    return false;
  }
}

/** Remove the worklist file for a procedure (completed / cancelled).
 *  Returns an accurate outcome — callers must not assume success. */
export type RemoveWorklistResult =
  | { outcome: "removed" }
  | { outcome: "already_absent" }
  | { outcome: "disabled" }
  | { outcome: "failed"; error: string };

/** True when there is nothing left to clean on disk (or MWL publishing is off). */
export function isRemoveWorklistSuccess(r: RemoveWorklistResult): boolean {
  return r.outcome === "removed" || r.outcome === "already_absent" || r.outcome === "disabled";
}

export async function removeWorklistFile(accessionNumber: string): Promise<RemoveWorklistResult> {
  const acc = (accessionNumber || "").trim();
  if (!acc) return { outcome: "already_absent" };
  try {
    const out = fileFor(acc);
    if (!out) return { outcome: "disabled" };
    try {
      await unlink(out);
      return { outcome: "removed" };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return { outcome: "already_absent" };
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err, accession: acc }, "mwl: removeWorklistFile failed");
      return { outcome: "failed", error: msg };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, accession: acc }, "mwl: removeWorklistFile failed");
    return { outcome: "failed", error: msg };
  }
}

/** Terminal statuses whose procedures should NOT appear on the modality worklist. */
export const MWL_TERMINAL_STATUSES = new Set(["COMPLETED", "CANCELLED", "CANCELED", "DISCONTINUED", "ARRIVED"]);

export type SyncWorklistResult = {
  action: "removed" | "written" | "skipped";
  remove?: RemoveWorklistResult;
  written?: boolean;
};

/** Reconcile one procedure's worklist file with its status. */
export async function syncWorklistForStatus(p: MwlProcedure, status: string): Promise<SyncWorklistResult> {
  if (MWL_TERMINAL_STATUSES.has((status || "").toUpperCase())) {
    const remove = await removeWorklistFile(p.accessionNumber);
    return { action: "removed", remove };
  }
  const written = await writeWorklistFile(p);
  return { action: "written", written };
}
