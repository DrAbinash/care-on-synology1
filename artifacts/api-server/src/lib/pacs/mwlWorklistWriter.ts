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
import { formatDicomPersonNameForDisplay } from "./dicomNameNormalize";

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
  /** ERP display age, e.g. "26 years" / "8 months" — becomes (0010,1010). */
  patientAge?: string | null;
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

/** A DICOM SH (Short Text) value holds 16 bytes. */
export const DICOM_SH_MAX_BYTES = 16;

/**
 * The accession as a modality may legally carry it.
 *
 * CARE's canonical accession is `ACC-YYYYMMDD-MOD-NNN` — 19 bytes — and the
 * worklist writes it into three SH fields. The unit does not complain, it
 * truncates: measured on the live PACS, every ultrasound study of 2026-11-04
 * came back as the identical `ACC-20261104-US-`, and 453 November studies
 * collapsed onto 5 such strings — one per day. Nothing can be matched on that,
 * and it is what the console shows the sonographer while he scans.
 *
 * The fix is to drop the punctuation, not the information: `ACC20261104US001`
 * is exactly 16 bytes for every two-letter modality CARE issues (CR, US, MR,
 * CT, MG), and because the intake compares accessions after stripping
 * non-alphanumerics on both sides, this form is the SAME key as the canonical
 * one. Ultrasound therefore becomes matchable by accession for the first time —
 * today the truncated value matches nothing, and `uid_by_accession = 0` in the
 * studio's own probe says so.
 *
 * The canonical value is untouched everywhere CARE owns it — the bill, the
 * printed report, `radiology_studies`, the barcode, and the deterministic UIDs
 * below — and the full string still travels in the LO comments field
 * (`CARE-ACC:`), where 64 bytes are allowed.
 *
 * A three-letter modality (BMD, 17 bytes) cannot fit with its prefix intact. It
 * keeps the tail, which is the date, the modality and the sequence: still unique
 * per study, and those studies link by StudyInstanceUID as they always have.
 */
export function mwlAccession(canonical: string | null | undefined): string {
  const raw = (canonical ?? "").trim();
  const compact = raw.replace(/[^A-Za-z0-9]/g, "");
  if (Buffer.byteLength(compact, "utf8") <= DICOM_SH_MAX_BYTES) return compact;
  return Array.from(compact).slice(-DICOM_SH_MAX_BYTES).join("");
}

/**
 * DICOM Person Name for MWL — bill-desk display order, one component.
 *
 * Consoles paint component 0 verbatim, so `Family^Given` made the GE Voluson
 * and the UIH MRI read "KESHRI RAM" while the bill desk and the printed report
 * both say "RAM KESHRI". A caret-less value also survives the return trip:
 * `formatDicomPersonNameForDisplay` keeps a name without carets exactly as
 * written, so nothing reorders it in the ERP either.
 */
function toPn(name: string | null | undefined): string {
  const cleaned = esc(name);
  if (!cleaned) return "ANONYMOUS";
  // Rows that already hold caret PN are ERP-side family^given, so flip them.
  const display = cleaned.includes("^") ? formatDicomPersonNameForDisplay(cleaned) : cleaned;
  return esc(display) || "ANONYMOUS";
}

/**
 * (0010,1010) PatientAge, VR AS: three digits + D(ays)/M(onths)/Y(ears).
 * Prefers the stored ERP age (so the console matches the bill desk), falls back
 * to whole years from DOB. Returns "" rather than inventing an age.
 */
export function formatMwlPatientAge(
  patientAge: string | null | undefined,
  patientDob: string | null | undefined,
  now: Date = new Date(),
): string {
  const as = (value: number, unit: "D" | "M" | "Y"): string =>
    value > 0 && value <= 999 ? `${String(value).padStart(3, "0")}${unit}` : "";

  const m = /^(\d{1,3})\s*(years?|yrs?|y|months?|mos?|m|days?|d)?$/i
    .exec(String(patientAge ?? "").trim());
  if (m) {
    const value = Number(m[1]);
    const unit = (m[2] ?? "y").toLowerCase();
    const code = unit.startsWith("m") ? "M" : unit.startsWith("d") ? "D" : "Y";
    const direct = as(value, code);
    if (direct) return direct;
  }

  const dob = digits(patientDob);
  if (/^\d{8}$/.test(dob)) {
    const y = Number(dob.slice(0, 4));
    const mo = Number(dob.slice(4, 6));
    const d = Number(dob.slice(6, 8));
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      let years = now.getFullYear() - y;
      let months = now.getMonth() + 1 - mo;
      let days = now.getDate() - d;
      if (days < 0) { months -= 1; days += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
      if (months < 0) { years -= 1; months += 12; }
      if (years >= 1) return as(Math.min(years, 999), "Y");
      if (months >= 1) return as(months, "M");
      return as(days, "D");
    }
  }
  return "";
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
  // The three SH fields below carry this, not `acc`: `acc` is 19 bytes for a
  // CARE accession and SH holds 16, so the unit silently cut the sequence off.
  const shAcc = esc(mwlAccession(p.accessionNumber));
  const modality = esc(p.modality).toUpperCase() || "OT";
  // Capitals on the machine, as the owner asked on 7 Nov 2026, and upper-case at
  // this boundary only: the bill, the printed report and radiology_studies keep
  // the case the desk typed. Consoles paint these fields verbatim, so a mixed
  // case test name or referrer is what the technologist reads.
  const desc = esc(p.studyDescription || p.procedureName || "").toUpperCase();
  const comments = buildComments(p);
  const age = formatMwlPatientAge(p.patientAge, p.patientDob);
  // Blank, never "ANONYMOUS": a walk-in with no referrer must not be shown to
  // the sonographer as if some anonymous clinician referred them.
  const refPn = esc(p.referringDoctor) ? toPn(p.referringDoctor).toUpperCase() : "";
  return [
    `(0008,0005) CS [ISO_IR 100]`,
    `(0008,0016) UI [${MWL_SOP_CLASS}]`,
    `(0008,0018) UI [${mwlSopInstanceUid(acc)}]`,
    `(0008,0050) SH [${shAcc}]`,
    `(0010,0010) PN [${toPn(p.patientName)}]`,
    `(0010,0020) LO [${esc(p.patientId)}]`,
    `(0010,0030) DA [${digits(p.patientDob)}]`,
    // Only when an age is actually known — an invented 000Y reads as a newborn.
    ...(age ? [`(0010,1010) AS [${age}]`] : []),
    `(0010,0040) CS [${esc(p.patientSex)}]`,
    `(0020,000D) UI [${mwlStudyInstanceUid(acc)}]`,
    `(0020,000E) UI [${mwlSeriesInstanceUid(acc)}]`,
    // The UIH console paints its "Study Description" box from the study-level
    // (0008,1030), not from (0032,1060)/(0040,0007)/(0040,0010) — those three
    // were already sent and the box stayed empty (owner screenshots 7 and 9 Nov
    // 2026). (0008,1030) is not part of the MWL-FIND model, but Orthanc's
    // worklists plugin serves whatever the file carries and UIH copies it into
    // the acquired study. Same reason the scheduled DA/TM are mirrored to the
    // study-level (0008,0020)/(0008,0030): the console reads those, not the SPS
    // sequence, for its Study Date/Time.
    `(0008,1030) LO [${desc}]`,
    ...(p.scheduledDate ? [`(0008,0020) DA [${digits(p.scheduledDate)}]`] : []),
    ...(p.scheduledTime ? [`(0008,0030) TM [${digits(p.scheduledTime)}]`] : []),
    `(0032,1060) LO [${desc}]`,
    `(0008,0090) PN [${refPn}]`,
    `(0018,0015) CS [${esc(p.bodyPartExamined)}]`,
    `(0040,1001) SH [${shAcc}]`,
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
    // The UIH MRI console shows accession, patient, sex and referring physician
    // from this file but leaves its own Study Description box empty (owner
    // screenshot 7 Nov 2026) — it does not map either description attribute.
    // The step comments are the third standard place a console can read the
    // exam from, and cost nothing when the other two are already correct.
    `    (0040,0010) LO [${desc}]`,
    `    (0040,0009) SH [${shAcc}]`,
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
