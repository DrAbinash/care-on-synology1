import { describe, expect, test } from "vitest";
import {
  BACKUP_CATCHUP_GRACE_MS,
  decideBackupRun,
  formatLocalMinute,
  lastOccurrence,
  parseCronFields,
  toCronExpression,
} from "./backupSchedule";

// Local-time construction keeps these independent of the runner's zone — a stored cron
// time means the container's local time, which compose pins to Asia/Kolkata.
function at(day: number, hour: number, minute: number): Date {
  // October 2026: the 25th is a Sunday, the 26th a Monday, the 13th a Tuesday.
  return new Date(2026, 9, day, hour, minute, 0, 0);
}

function matched(expr: string, dates: Date[]): string[] {
  const fields = parseCronFields(expr);
  if (!fields) throw new Error(`unparsable expression in test: ${expr}`);
  return dates.filter((d) => lastOccurrence(fields, d)?.getTime() === d.getTime()).map((d) => `${d.getDate()}T${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`);
}

describe("a five-field cron expression is honoured in full", () => {
  test("a daily schedule matches one minute a day, not one minute an hour", () => {
    const hours = Array.from({ length: 24 }, (_, h) => at(22, h, 0));
    expect(matched("0 2 * * *", hours)).toEqual(["22T2:00"]);
  });

  test("the hour field is not ignored: 03:00 is not 02:00", () => {
    const fields = parseCronFields("0 2 * * *")!;
    expect(lastOccurrence(fields, at(22, 3, 0))!.getTime()).not.toBe(at(22, 3, 0).getTime());
    expect(lastOccurrence(fields, at(22, 3, 0))!.getHours()).toBe(2);
  });

  test("an hourly schedule matches minute 0 of every hour and nothing else", () => {
    const samples: Date[] = [];
    for (let h = 0; h < 4; h++) for (const m of [0, 1, 15, 30, 45, 59]) samples.push(at(22, h, m));
    expect(matched("0 * * * *", samples)).toEqual(["22T0:00", "22T1:00", "22T2:00", "22T3:00"]);
  });

  test("a step schedule runs on every step — the old interpreter never ran it at all", () => {
    const minutes = Array.from({ length: 60 }, (_, m) => at(22, 6, m));
    expect(matched("*/15 * * * *", minutes)).toEqual(["22T6:00", "22T6:15", "22T6:30", "22T6:45"]);
  });

  test("a weekly schedule matches its weekday only", () => {
    // 25 Oct 2026 is a Sunday; 26th Monday, 31st Saturday.
    const days = [25, 26, 27, 28, 29, 30, 31].map((d) => at(d, 2, 0));
    expect(matched("0 2 * * 0", days)).toEqual(["25T2:00"]);
  });

  test("weekday 7 is Sunday too", () => {
    expect(matched("0 2 * * 7", [at(25, 2, 0), at(26, 2, 0)])).toEqual(["25T2:00"]);
  });

  test("a monthly schedule matches the first only", () => {
    const days = [1, 2, 15, 31].map((d) => at(d, 2, 0));
    expect(matched("0 2 1 * *", days)).toEqual(["1T2:00"]);
  });

  test("the month field gates a day-of-month that repeats every month", () => {
    // A November-only schedule: 1 Nov and 1 Dec are both "the 1st at 02:00", so a matcher that
    // ignored the month field would dump the database in December as well.
    const nov1 = new Date(2026, 10, 1, 2, 0, 0, 0);
    const dec1 = new Date(2026, 11, 1, 2, 0, 0, 0);
    const fields = parseCronFields("0 2 1 11 *")!;
    expect(lastOccurrence(fields, nov1)?.getTime()).toBe(nov1.getTime());
    // Nothing inside the 8-day search bound, because December's 1st is not this schedule's day.
    expect(lastOccurrence(fields, dec1)).toBeNull();
  });

  test("a range in the hour field bounds the run to those hours", () => {
    const hours = [5, 6, 7, 8, 9].map((h) => at(22, h, 0));
    expect(matched("0 6-8 * * *", hours)).toEqual(["22T6:00", "22T7:00", "22T8:00"]);
  });

  test("a list matches each listed value", () => {
    const days = [1, 2, 14, 15, 16].map((d) => at(d, 0, 0));
    expect(matched("0 0 1,15 * *", days)).toEqual(["1T0:00", "15T0:00"]);
  });

  test("day-of-month and day-of-week are OR-ed when both are restricted (cron's own rule)", () => {
    // October 2026: the 25th is a Sunday, so Fridays are 9/16/23/30; the 13th and 20th are Tuesdays.
    const dates = [at(9, 0, 0), at(13, 0, 0), at(14, 0, 0), at(20, 0, 0)];
    expect(matched("0 0 13 * 5", dates)).toEqual(["9T0:00", "13T0:00"]);
  });

  test("month names and weekday names are accepted", () => {
    expect(matched("0 0 * * MON", [at(26, 0, 0), at(27, 0, 0)])).toEqual(["26T0:00"]);
    expect(matched("0 0 * * mon", [at(26, 0, 0), at(27, 0, 0)])).toEqual(["26T0:00"]);
    const fields = parseCronFields("0 0 1 JAN *")!;
    expect(fields.month.has(1)).toBe(true);
    expect(fields.month.has(2)).toBe(false);
  });

  test("every minute really means every minute", () => {
    expect(matched("* * * * *", [at(22, 6, 0), at(22, 6, 1), at(22, 6, 2)])).toEqual([
      "22T6:00",
      "22T6:01",
      "22T6:02",
    ]);
  });
});

describe("a schedule that cannot be honoured fails closed", () => {
  test.each([
    ["too few fields", "0 2 * *"],
    ["too many fields", "0 2 * * * 2026"],
    ["hour out of range", "0 25 * * *"],
    ["minute out of range", "60 2 * * *"],
    ["day out of range", "0 2 32 * *"],
    ["zero step", "*/0 * * * *"],
    ["reversed range", "0 8-6 * * *"],
    ["not a number", "blorp 2 * * *"],
    ["the literal CUSTOM the Backups UI can store", "CUSTOM"],
    ["empty", ""],
  ])("%s", (_label, expr) => {
    if (!expr) {
      expect(toCronExpression(expr)).toBeNull();
      return;
    }
    expect(parseCronFields(expr)).toBeNull();
    expect(decideBackupRun({ schedule: expr, lastRunAt: null, now: at(22, 2, 0) })).toEqual({
      due: false,
      occurrence: null,
      reason: "invalid",
    });
  });

  test.each([["MANUAL", "MANUAL"], ["blank", "   "] as const])("%s never fires and says manual", (_l, schedule) => {
    expect(decideBackupRun({ schedule, lastRunAt: null, now: at(22, 2, 0) }).reason).toBe("manual");
  });
});

describe("keywords mean what they say", () => {
  test.each([
    ["DAILY", "0 2 * * *"],
    ["HOURLY", "0 * * * *"],
    ["WEEKLY", "0 2 * * 0"],
  ])("%s is exactly %s", (keyword, expression) => {
    expect(toCronExpression(keyword)).toBe(expression);
    expect(toCronExpression(keyword.toLowerCase())).toBe(expression);
  });
});

describe("the decision is keyed to the occurrence, not to the clock", () => {
  test("due at its own minute, having run yesterday", () => {
    const d = decideBackupRun({ schedule: "0 2 * * *", lastRunAt: at(21, 2, 0), now: at(22, 2, 0) });
    expect(d.due).toBe(true);
    expect(d.reason).toBe("due");
    expect(formatLocalMinute(d.occurrence!)).toBe("2026-10-22 02:00");
  });

  test("already-run inside the same occurrence, however often it is asked", () => {
    const occurrence = at(22, 2, 0);
    for (const minute of [0, 1, 5, 30]) {
      const d = decideBackupRun({ schedule: "0 2 * * *", lastRunAt: occurrence, now: at(22, 2, minute) });
      expect(d.due).toBe(false);
      expect(d.reason).toBe("already-run");
    }
  });

  test("not due before its minute, even with an old cursor", () => {
    const d = decideBackupRun({ schedule: "0 2 * * *", lastRunAt: at(12, 2, 0), now: at(22, 1, 59) });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("outside-grace");
    expect(formatLocalMinute(d.occurrence!)).toBe("2026-10-21 02:00");
  });

  test("ten missed days admit ONE run, because only the newest occurrence counts", () => {
    const d = decideBackupRun({ schedule: "0 2 * * *", lastRunAt: at(12, 2, 0), now: at(22, 2, 0) });
    expect(d.due).toBe(true);
    expect(d.occurrence!.getTime()).toBe(at(22, 2, 0).getTime());
  });

  test("a slot older than the grace window is left alone rather than backfilled", () => {
    const d = decideBackupRun({ schedule: "0 2 * * *", lastRunAt: at(21, 2, 0), now: at(22, 20, 0) });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("outside-grace");
  });

  test("the grace boundary is honoured inclusively", () => {
    const occurrence = at(22, 2, 0);
    const inside = new Date(occurrence.getTime() + BACKUP_CATCHUP_GRACE_MS);
    const outside = new Date(occurrence.getTime() + BACKUP_CATCHUP_GRACE_MS + 60_000);
    expect(decideBackupRun({ schedule: "0 2 * * *", lastRunAt: at(21, 2, 0), now: inside }).due).toBe(true);
    expect(decideBackupRun({ schedule: "0 2 * * *", lastRunAt: at(21, 2, 0), now: outside }).due).toBe(false);
  });

  test("a cursor in the future (clock skew) does not reopen the occurrence", () => {
    const d = decideBackupRun({ schedule: "0 2 * * *", lastRunAt: at(23, 2, 0), now: at(22, 2, 0) });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("already-run");
  });

  test("a never-run job is due at its next minute, not immediately", () => {
    // A job that has never run still gets tonight's slot if the process starts later in the day —
    // that is one bounded catch-up, not a backfill. Past the grace window it waits for the next one.
    expect(decideBackupRun({ schedule: "0 2 * * *", lastRunAt: null, now: at(22, 5, 0) }).due).toBe(true);
    expect(decideBackupRun({ schedule: "0 2 * * *", lastRunAt: null, now: at(22, 20, 0) }).due).toBe(false);
    expect(decideBackupRun({ schedule: "0 2 * * *", lastRunAt: null, now: at(22, 2, 0) }).due).toBe(true);
    expect(decideBackupRun({ schedule: "* * * * *", lastRunAt: null, now: at(22, 5, 0) }).due).toBe(true);
  });

  test("an hourly job is due once per hour, checked at its own minute and at :37", () => {
    const first = decideBackupRun({ schedule: "0 * * * *", lastRunAt: at(22, 3, 0), now: at(22, 4, 0) });
    expect(first.due).toBe(true);
    const again = decideBackupRun({ schedule: "0 * * * *", lastRunAt: first.occurrence, now: at(22, 4, 37) });
    expect(again.due).toBe(false);
    expect(again.reason).toBe("already-run");
  });
});

describe("formatLocalMinute is the label an operator reads", () => {
  test("zero-pads and carries no timezone shift", () => {
    expect(formatLocalMinute(new Date(2026, 0, 5, 0, 7))).toBe("2026-01-05 00:07");
  });
});
