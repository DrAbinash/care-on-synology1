/**
 * Pure helpers for Modality Worklist retention (no DB, no filesystem) —
 * same split as mwlDeploymentStatusPure.ts / mwlWlCleanupRules.ts.
 */

export const MWL_RETENTION_DEFAULT_DAYS = 7;
export const MWL_PRUNE_CONFIRM_PHRASE = "PRUNE WORKLIST";
export const MWL_PRUNE_MAX_PER_RUN_DEFAULT = 5000;

/** Env override; 0 disables the sweep entirely. Unset/garbage → the default. */
export function resolveMwlRetentionDays(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.MWL_WORKLIST_RETENTION_DAYS ?? "").trim();
  if (!raw) return MWL_RETENTION_DEFAULT_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return MWL_RETENTION_DEFAULT_DAYS;
  return Math.floor(n);
}

export function resolveMwlPruneMaxPerRun(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.MWL_PRUNE_MAX_PER_RUN ?? "").trim();
  if (!raw) return MWL_PRUNE_MAX_PER_RUN_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return MWL_PRUNE_MAX_PER_RUN_DEFAULT;
  return Math.floor(n);
}

/** YYYYMMDD strictly older than `days` before `now`. */
export function mwlRetentionCutoffYmd(now: Date, days: number): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** The columns a pruned row is written back with, in INSERT order. */
export const MWL_RESTORE_COLUMNS = [
  "accession_number", "patient_id", "patient_name", "patient_sex", "patient_age",
  "patient_dob", "modality", "procedure_name", "procedure_code", "study_description",
  "referring_doctor", "referring_doctor_id", "scheduled_date", "scheduled_time",
  "station_ae_title", "body_part_examined", "status", "source_bill_id",
  "source_order_id", "source_appointment_id", "created_at", "updated_at",
] as const;

const COLUMN_TO_ROW_KEY: Array<[string, string]> = [
  ["accession_number", "accessionNumber"],
  ["patient_id", "patientId"],
  ["patient_name", "patientName"],
  ["patient_sex", "patientSex"],
  ["patient_age", "patientAge"],
  ["patient_dob", "patientDob"],
  ["modality", "modality"],
  ["procedure_name", "procedureName"],
  ["procedure_code", "procedureCode"],
  ["study_description", "studyDescription"],
  ["referring_doctor", "referringDoctor"],
  ["referring_doctor_id", "referringDoctorId"],
  ["scheduled_date", "scheduledDate"],
  ["scheduled_time", "scheduledTime"],
  ["station_ae_title", "stationAeTitle"],
  ["body_part_examined", "bodyPartExamined"],
  ["status", "status"],
  ["source_bill_id", "sourceBillId"],
  ["source_order_id", "sourceOrderId"],
  ["source_appointment_id", "sourceAppointmentId"],
  ["created_at", "createdAt"],
  ["updated_at", "updatedAt"],
];

function quote(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return quote(value.toISOString());
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Loadable INSERT statements for the rows about to be retired. Values are
 * escaped by doubling single quotes — a name like O'Brien must not break the
 * statement or become an injection payload in a file someone will psql.
 */
export function buildMwlRestoreSql(
  rows: Array<Record<string, unknown>>,
  generatedAt: Date,
): string {
  const header = [
    `-- radiology_scheduled_procedures rows retired by MWL retention`,
    `-- written ${generatedAt.toISOString()} — load with psql to restore`,
    ``,
  ].join("\n");
  const cols = MWL_RESTORE_COLUMNS.join(", ");
  const lines = rows.map((r) => {
    const values = COLUMN_TO_ROW_KEY.map(([, key]) => quote(r[key])).join(", ");
    return `INSERT INTO radiology_scheduled_procedures (${cols}) VALUES (${values});`;
  });
  return `${header}${lines.join("\n")}\n`;
}
