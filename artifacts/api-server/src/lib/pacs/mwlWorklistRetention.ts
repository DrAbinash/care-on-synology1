/**
 * Modality Worklist retention — the from-our-side guard for consoles that do
 * not filter their MWL C-FIND by date.
 *
 * Why this exists: Orthanc's worklists plugin serves every `.wl` file in the
 * shared folder, so a console that queries without a date restriction is handed
 * the whole history. Measured on 2026-11-04 the clinic was carrying 11,426
 * items while only 52 were dated that day, and the GE Voluson console was
 * hanging while building its list. The vendor fix (query today only) is not
 * always available, so CARE stops publishing items the console has no business
 * showing: a worklist entry older than N days was either scanned (its file is
 * already removed on intake) or abandoned — either way it must not sit on a
 * modality.
 *
 * Scope limits, deliberately:
 *   - touches ONLY radiology_scheduled_procedures rows and the ERP's own
 *     worklist folder. It never calls Orthanc's REST API and never touches
 *     image storage, the archive, bills, studies or reports.
 *   - rows with no scheduled_date are left alone: age cannot be proven.
 *   - every run writes an INSERT-statement restore file first, mode 0600, under
 *     the API's data directory, and reports its path. Nothing is deleted unless
 *     that file was written.
 */

import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { db } from "@workspace/db";
import { radiologyScheduledProceduresTable } from "@workspace/db/schema";
import { and, asc, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { logger } from "../logger";
import { MWL_TERMINAL_STATUSES, removeWorklistFile, worklistDir } from "./mwlWorklistWriter";
import {
  MWL_PRUNE_CONFIRM_PHRASE,
  MWL_PRUNE_MAX_PER_RUN_DEFAULT,
  MWL_RETENTION_DEFAULT_DAYS,
  buildMwlRestoreSql,
  mwlRetentionCutoffYmd,
  resolveMwlPruneMaxPerRun,
  resolveMwlRetentionDays,
} from "./mwlWorklistRetentionPure";

export {
  MWL_PRUNE_CONFIRM_PHRASE,
  MWL_PRUNE_MAX_PER_RUN_DEFAULT,
  MWL_RETENTION_DEFAULT_DAYS,
  buildMwlRestoreSql,
  mwlRetentionCutoffYmd,
  resolveMwlPruneMaxPerRun,
  resolveMwlRetentionDays,
};

const RESTORE_DIRNAME = path.join("data", "mwl-prune-backups");

export type PruneStaleWorklistInput = {
  /** Items whose scheduled_date is strictly older than this many days. 0 = disabled. */
  days?: number;
  /** Restrict to these DICOM modality codes (e.g. ["US"]). Empty/undefined = all. */
  modalities?: string[];
  /** Report only. Default true — nothing is deleted until this is false. */
  dryRun?: boolean;
  /** Delete the DB rows instead of marking them terminal. */
  deleteRows?: boolean;
  /** Must equal MWL_PRUNE_CONFIRM_PHRASE for a non-dry run to proceed. */
  confirm?: string;
  maxPerRun?: number;
  now?: Date;
  env?: Record<string, string | undefined>;
};

export type PruneStaleWorklistReport = {
  dryRun: boolean;
  deleteRows: boolean;
  days: number;
  cutoffYmd: string;
  modalities: string[];
  maxPerRun: number;
  selected: number;
  byModality: Record<string, number>;
  filesRemoved: number;
  filesAlreadyAbsent: number;
  filesFailed: number;
  rowsDeleted: number;
  rowsMarkedTerminal: number;
  restoreFile: string | null;
  remainingBeyondCap: number;
  refused?: string;
  error?: string;
};

/** Written before any delete so an aborted run still leaves a loadable file. */
function writeRestoreFile(rows: Array<Record<string, unknown>>, now: Date): string | null {
  if (rows.length === 0) return null;
  const dir = path.resolve(process.cwd(), RESTORE_DIRNAME);
  const file = path.join(dir, `mwl_prune_${now.toISOString().replace(/[-:.]/g, "")}.sql`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, buildMwlRestoreSql(rows, now), { encoding: "utf8", mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* Windows reports no mode support */ }
    return file;
  } catch (err) {
    logger.warn({ err }, "mwl-retention: could not write restore file — run refused");
    return null;
  }
}

export async function pruneStaleWorklist(
  input: PruneStaleWorklistInput = {},
): Promise<PruneStaleWorklistReport> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const days = input.days ?? resolveMwlRetentionDays(env);
  const maxPerRun = input.maxPerRun ?? resolveMwlPruneMaxPerRun(env);
  const modalities = (input.modalities ?? []).map((m) => m.trim().toUpperCase()).filter(Boolean);
  const dryRun = input.dryRun !== false;
  const deleteRows = input.deleteRows === true;
  const cutoffYmd = mwlRetentionCutoffYmd(now, days);

  const base: PruneStaleWorklistReport = {
    dryRun, deleteRows, days, cutoffYmd, modalities, maxPerRun,
    selected: 0, byModality: {}, filesRemoved: 0, filesAlreadyAbsent: 0, filesFailed: 0,
    rowsDeleted: 0, rowsMarkedTerminal: 0, restoreFile: null, remainingBeyondCap: 0,
  };

  if (days <= 0) return { ...base, refused: "retention disabled (MWL_WORKLIST_RETENTION_DAYS=0)" };
  if (!dryRun && !worklistDir()) {
    return { ...base, refused: "ORTHANC_WORKLIST_DIR is not set — no worklist folder to prune" };
  }
  if (!dryRun && (input.confirm ?? "").trim() !== MWL_PRUNE_CONFIRM_PHRASE) {
    return { ...base, refused: `confirm phrase must be "${MWL_PRUNE_CONFIRM_PHRASE}"` };
  }

  const conds = [
    isNotNull(radiologyScheduledProceduresTable.scheduledDate),
    lt(radiologyScheduledProceduresTable.scheduledDate, cutoffYmd),
  ];
  if (modalities.length > 0) {
    conds.push(inArray(sql`upper(${radiologyScheduledProceduresTable.modality})`, modalities));
  }
  const where = and(...conds);

  try {
    const grouped = await db
      .select({ modality: radiologyScheduledProceduresTable.modality, count: sql<number>`count(*)::int` })
      .from(radiologyScheduledProceduresTable)
      .where(where)
      .groupBy(radiologyScheduledProceduresTable.modality);
    for (const g of grouped) base.byModality[(g.modality ?? "?").toUpperCase()] = g.count;
    const total = grouped.reduce((a, g) => a + g.count, 0);
    if (dryRun) {
      return { ...base, selected: total, remainingBeyondCap: Math.max(0, total - maxPerRun) };
    }

    // Oldest first, so a capped run finishes the backlog deterministically.
    const rows = await db
      .select()
      .from(radiologyScheduledProceduresTable)
      .where(where)
      .orderBy(asc(radiologyScheduledProceduresTable.scheduledDate))
      .limit(maxPerRun);
    if (rows.length === 0) return { ...base, selected: 0 };

    const restoreFile = writeRestoreFile(rows as unknown as Array<Record<string, unknown>>, now);
    if (!restoreFile) {
      return { ...base, error: "restore file could not be written — nothing was deleted" };
    }

    let filesRemoved = 0;
    let filesAlreadyAbsent = 0;
    let filesFailed = 0;
    for (const row of rows) {
      const result = await removeWorklistFile(row.accessionNumber);
      if (result.outcome === "removed") filesRemoved++;
      else if (result.outcome === "already_absent" || result.outcome === "disabled") filesAlreadyAbsent++;
      else filesFailed++;
    }

    const ids = rows.map((r) => r.id);
    let rowsDeleted = 0;
    let rowsMarkedTerminal = 0;
    if (deleteRows) {
      const deleted = await db
        .delete(radiologyScheduledProceduresTable)
        .where(inArray(radiologyScheduledProceduresTable.id, ids))
        .returning({ id: radiologyScheduledProceduresTable.id });
      rowsDeleted = deleted.length;
    } else {
      // Terminal statuses are what keep Sync from re-publishing these items.
      const toMark = rows.filter((r) => !MWL_TERMINAL_STATUSES.has((r.status || "").toUpperCase()));
      if (toMark.length > 0) {
        await db
          .update(radiologyScheduledProceduresTable)
          .set({ status: "CANCELLED", updatedAt: now })
          .where(inArray(radiologyScheduledProceduresTable.id, toMark.map((r) => r.id)));
        rowsMarkedTerminal = toMark.length;
      }
    }

    const remainingBeyondCap = Math.max(0, total - rows.length);
    // No PHI in this line — counts and the cutoff only.
    logger.info(
      {
        cutoffYmd, days, deleteRows, modalities, selected: rows.length,
        filesRemoved, filesAlreadyAbsent, filesFailed, rowsDeleted, rowsMarkedTerminal,
        remainingBeyondCap,
      },
      "mwl-retention: stale worklist items pruned",
    );
    return {
      ...base,
      selected: rows.length,
      filesRemoved,
      filesAlreadyAbsent,
      filesFailed,
      rowsDeleted,
      rowsMarkedTerminal,
      restoreFile,
      remainingBeyondCap,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, cutoffYmd }, "mwl-retention: prune failed");
    return { ...base, error: message };
  }
}
