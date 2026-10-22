/**
 * When a configured backup job is actually due.
 *
 * Why this file exists: `fireScheduledBackups()` used to decide this inline, and it read only
 * the FIRST field of a cron expression. `0 2 * * *` (daily at 02:00) therefore matched at minute
 * 0 of EVERY hour, and the gap required between two runs was computed from the text of that same
 * minute field — `parseInt("0", 10) || 1` minutes, i.e. 60 seconds. A nightly ~810 MB pg_dump
 * became an hourly one: production measured 164 runs in 48 hours, ~2.4 GB written per hour onto the
 * same two-disk RAID1 as the live database and Orthanc. Conversely a five-minute step schedule never ran at all,
 * because the minute field's literal text can never equal a clock minute.
 *
 * The rule this implements instead: a run belongs to a scheduled OCCURRENCE, and an occurrence runs
 * at most once. `backup_jobs.last_run_at` is the cursor, and it advances to the occurrence rather
 * than to the wall clock, so a run that starts late does not push tomorrow's time sideways. Nothing
 * here rewrites a schedule, invents a make-up run beyond one bounded window, or trusts the caller's
 * clock minute.
 *
 * Times are interpreted in the process's LOCAL time, which is what a stored `0 2 * * *` has always
 * meant here — compose pins the container to `TZ=Asia/Kolkata` (docker-compose.yml:246), so 02:00 is
 * 02:00 in the clinic, and it shows in `backup_job_logs` as 20:00/-21:00 UTC.
 */

/** How late a scheduled run may start and still be worth starting. One occurrence at most can ever
 *  fall inside it, which is what makes a catch-up burst structurally impossible. */
export const BACKUP_CATCHUP_GRACE_MS = 12 * 60 * 60 * 1000;

/** Bound on the backward search only — a schedule that has not fired in this long is reported as
 *  never having an occurrence rather than scanned for. It is NOT a second chance to catch up. */
const MAX_LOOKBACK_MS = 8 * 24 * 60 * 60 * 1000;

/** Keywords the scheduler has always accepted. The Backups UI writes cron text, not these, so they
 *  exist for rows created by older setups and scripts; they now mean exactly what they say. */
export const KEYWORD_SCHEDULES: Readonly<Record<string, string>> = {
  DAILY: "0 2 * * *",
  HOURLY: "0 * * * *",
  WEEKLY: "0 2 * * 0",
};

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

interface FieldRange {
  min: number;
  max: number;
  name: string;
  names?: string[];
}

const FIELDS: FieldRange[] = [
  { min: 0, max: 59, name: "minute" },
  { min: 0, max: 23, name: "hour" },
  { min: 1, max: 31, name: "dayOfMonth" },
  { min: 1, max: 12, name: "month", names: MONTH_NAMES },
  { min: 0, max: 6, name: "dayOfWeek", names: WEEKDAY_NAMES },
];

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** A restricted day-of-month OR day-of-week is what cron means: with both restricted, a date
   *  matching EITHER runs the job. With one still `*`, the other just has to match. */
  domRestricted: boolean;
  dowRestricted: boolean;
}

function resolveValue(token: string, field: FieldRange): number | null {
  const direct = Number(token);
  if (Number.isInteger(direct)) return field.name === "dayOfWeek" && direct === 7 ? 0 : direct;
  if (field.names) {
    // Case-insensitive: toCronExpression upper-cases the stored text, so a config typed
    // as `0 0 * * mon` arrives as MON, and cron names are not case-sensitive.
    const needle = token.toLowerCase();
    const idx = field.names.findIndex((n) => needle.startsWith(n));
    if (idx >= 0) return idx + field.min;
  }
  return null;
}

/** One comma-separated cron field → the set of values it allows, or null if it is not a field
 *  this scheduler can honour. Supports a star, a single value, an a-b range, a star or range
 *  with a step, and comma-separated lists of any of those. */
function parseField(spec: string, field: FieldRange): Set<number> | null {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    if (!part) return null;
    const [body, stepText, extra] = part.split("/");
    if (!body || extra !== undefined) return null;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;

    let from = field.min;
    let to = field.max;
    if (body !== "*") {
      const dash = body.indexOf("-", body.startsWith("-") ? 1 : 0);
      if (dash > 0) {
        const rangeFrom = resolveValue(body.slice(0, dash), field);
        const rangeTo = resolveValue(body.slice(dash + 1), field);
        if (rangeFrom === null || rangeTo === null) return null;
        from = rangeFrom;
        to = rangeTo;
      } else {
        const single = resolveValue(body, field);
        if (single === null) return null;
        // `a/s` walks from a to the end of the field; a bare `a` is one value.
        from = single;
        to = stepText === undefined ? single : field.max;
      }
    }
    if (from < field.min || to > field.max || from > to) return null;
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out.size > 0 ? out : null;
}

export function parseCronFields(expression: string): CronFields | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const parsed = parseField(parts[i], FIELDS[i]);
    if (!parsed) return null;
    sets.push(parsed);
  }
  const allOf = (s: Set<number>, f: FieldRange) => s.size === f.max - f.min + 1;
  return {
    minute: sets[0],
    hour: sets[1],
    dayOfMonth: sets[2],
    month: sets[3],
    dayOfWeek: sets[4],
    domRestricted: !allOf(sets[2], FIELDS[2]),
    dowRestricted: !allOf(sets[4], FIELDS[4]),
  };
}

/** `* * * * *` in the DB text, and any keyword, both reach a parseable expression.
 *  Returns null for `MANUAL`/empty (never fires) and for text that is not a honourable cron. */
export function toCronExpression(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s || s === "MANUAL") return null;
  return KEYWORD_SCHEDULES[s] ?? s;
}

function matches(fields: CronFields, date: Date): boolean {
  if (!fields.minute.has(date.getMinutes())) return false;
  if (!fields.hour.has(date.getHours())) return false;
  return dayMatches(fields, date);
}

/** Month plus the day-of-month / day-of-week rule, with no minute or hour in it. The forward and
 *  backward searches share this so a schedule cannot mean one thing when asking "did it run" and
 *  another when asking "when does it run next". */
function dayMatches(fields: CronFields, date: Date): boolean {
  if (!fields.month.has(date.getMonth() + 1)) return false;
  const domOk = fields.dayOfMonth.has(date.getDate());
  const dowOk = fields.dayOfWeek.has(date.getDay());
  if (fields.domRestricted && fields.dowRestricted) return domOk || dowOk;
  if (fields.domRestricted) return domOk;
  if (fields.dowRestricted) return dowOk;
  return true;
}

/** The most recent minute at or before `now` that this schedule claims, or null if none exists
 *  within the search bound. Minutes are walked backwards, so the answer is the newest occurrence. */
export function lastOccurrence(fields: CronFields, now: Date): Date | null {
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
  const floor = now.getTime() - MAX_LOOKBACK_MS;
  while (cursor.getTime() >= floor) {
    if (matches(fields, cursor)) return new Date(cursor.getTime());
    cursor.setMinutes(cursor.getMinutes() - 1);
  }
  return null;
}

/** Bound on the forward search. An annual schedule is legitimately ~355 days away, so a month is
 *  not enough; anything past one leap year is treated as "no next occurrence". */
const MAX_LOOKAHEAD_DAYS = 400;

/** The first minute STRICTLY AFTER `after` that this schedule claims, or null if it claims none
 *  within the bound. Days are walked on the real calendar, so a `0 2 30 2 *` (30 February) has no
 *  occurrence rather than silently rolling over into March the way `new Date(2027, 1, 30)` would. */
export function nextOccurrence(fields: CronFields, after: Date): Date | null {
  const hours = [...fields.hour].sort((a, b) => a - b);
  const minutes = [...fields.minute].sort((a, b) => a - b);
  const firstDay = new Date(after.getFullYear(), after.getMonth(), after.getDate(), 0, 0, 0, 0);
  for (let offset = 0; offset <= MAX_LOOKAHEAD_DAYS; offset++) {
    // setDate past the end of the month rolls into the next month, which is exactly the calendar
    // walk this search needs.
    const day = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + offset);
    if (!dayMatches(fields, day)) continue;
    for (const hour of hours) {
      for (const minute of minutes) {
        const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
        if (candidate.getTime() > after.getTime()) return candidate;
      }
    }
  }
  return null;
}

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** What a stored schedule means, in the words an operator reads on the Backup page.
 *  Returns "Manual only" for MANUAL/empty (the job never fires on its own) and null for anything
 *  this function cannot state confidently — including text that is not a cron at all — so the page
 *  can show "Unknown schedule" instead of guessing. It deliberately describes only the shapes the
 *  page's own schedule dropdown can write, plus the keywords the scheduler accepts. */
export function describeSchedule(raw: string | null | undefined): string | null {
  const expression = toCronExpression(raw);
  if (!expression) return "Manual only";
  const fields = parseCronFields(expression);
  if (!fields) return null;

  const single = (s: Set<number>): number | null => (s.size === 1 ? [...s][0]! : null);
  const coversAll = (s: Set<number>, min: number, max: number) => s.size === max - min + 1;
  const minute = single(fields.minute);
  if (minute === null) return null;
  const everyDay = coversAll(fields.dayOfMonth, 1, 31) && coversAll(fields.month, 1, 12) && coversAll(fields.dayOfWeek, 0, 6);

  if (coversAll(fields.hour, 0, 23) && everyDay) return `Hourly at minute ${minute}`;

  const hour = single(fields.hour);
  if (hour === null || !coversAll(fields.month, 1, 12)) return null;
  const at = `${pad2(hour)}:${pad2(minute)}`;
  if (everyDay) return `Daily at ${at}`;

  const dom = coversAll(fields.dayOfMonth, 1, 31) ? null : single(fields.dayOfMonth);
  const dow = coversAll(fields.dayOfWeek, 0, 6) ? null : single(fields.dayOfWeek);
  if (dom !== null && dow === null) return `Monthly on day ${dom} at ${at}`;
  if (dow !== null && dom === null) return `Weekly on ${WEEKDAY_LABELS[dow]} at ${at}`;
  return null;
}

export interface DueDecision {
  due: boolean;
  /** The scheduled occurrence this decision is about — the identity a run belongs to. */
  occurrence: Date | null;
  /** Why not, in terms an operator can act on: manual | invalid | no-occurrence | outside-grace |
   *  already-run | due. */
  reason: "manual" | "invalid" | "no-occurrence" | "outside-grace" | "already-run" | "due";
}

/** Should this job run right now? Pure: no database, no clock of its own, so the answer can be
 *  pinned by tests over synthetic schedules and a controlled `now`. */
export function decideBackupRun(input: {
  schedule: string | null | undefined;
  lastRunAt: Date | null;
  now: Date;
  graceMs?: number;
}): DueDecision {
  const expression = toCronExpression(input.schedule);
  if (!expression) return { due: false, occurrence: null, reason: "manual" };
  const fields = parseCronFields(expression);
  if (!fields) return { due: false, occurrence: null, reason: "invalid" };

  const occurrence = lastOccurrence(fields, input.now);
  if (!occurrence) return { due: false, occurrence: null, reason: "no-occurrence" };

  const graceMs = input.graceMs ?? BACKUP_CATCHUP_GRACE_MS;
  if (input.now.getTime() - occurrence.getTime() > graceMs) {
    return { due: false, occurrence, reason: "outside-grace" };
  }
  if (input.lastRunAt && input.lastRunAt.getTime() >= occurrence.getTime()) {
    return { due: false, occurrence, reason: "already-run" };
  }
  return { due: true, occurrence, reason: "due" };
}

/** "2026-10-22 02:00", in the same local time a stored cron expression means. Used in
 *  `backup_job_logs.notes` so a row says which occurrence it belongs to. */
export function formatLocalMinute(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}
