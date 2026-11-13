/**
 * Unit tests for the Reporting Studio night window — pure, no Express, no DB.
 * Every instant is pinned with Date.UTC so the assertions are about IST,
 * not about the timezone of the machine running the suite.
 */
import { describe, expect, test } from "vitest";
import {
  IST_OFFSET_MINUTES,
  QUIET_WINDOW_DEFAULT_END_HOUR,
  QUIET_WINDOW_DEFAULT_START_HOUR,
  buildStudioQuietRejection,
  isStudioQuietAt,
  istMinutesOfDay,
  parseStudioQuietWindow,
  resolveStudioQuietWindow,
  studioQuietOpensAt,
  studioQuietSecondsRemaining,
} from "./reportingStudioQuietHours";

const DAY = "2026-11-13";
/** IST = UTC + 05:30, so a UTC instant at HH:MM is HH+5 : MM+30 in IST. */
const atUtc = (hhmmss: string) =>
  Date.UTC(2026, 10, 13, ...hhmmss.split(":").map(Number));

const WINDOW = { startHour: 18, endHour: 9 };

describe("istMinutesOfDay — IST is arithmetic, not a TZ lookup", () => {
  test("the epoch is 05:30 IST", () => {
    expect(IST_OFFSET_MINUTES).toBe(330);
    expect(istMinutesOfDay(0)).toBe(330);
  });

  test("reads the hour back for the pinned clinic instants", () => {
    expect(Math.floor(istMinutesOfDay(atUtc("03:30:00")) / 60)).toBe(9);
    expect(Math.floor(istMinutesOfDay(atUtc("12:30:00")) / 60)).toBe(18);
    expect(Math.floor(istMinutesOfDay(atUtc("18:30:00")) / 60)).toBe(0);
  });
});

describe("parseStudioQuietWindow", () => {
  test("unset or blank ships the 18:00-09:00 window", () => {
    for (const raw of [undefined, null, "", "   "]) {
      expect(parseStudioQuietWindow(raw)).toEqual({
        startHour: QUIET_WINDOW_DEFAULT_START_HOUR,
        endHour: QUIET_WINDOW_DEFAULT_END_HOUR,
      });
    }
  });

  test("off values disable the window", () => {
    for (const raw of ["off", "OFF", "0", "false", "no", "none", "disabled"]) {
      expect(parseStudioQuietWindow(raw)).toBeNull();
    }
  });

  test("HH:HH is read in order, with either separator", () => {
    expect(parseStudioQuietWindow("20:07")).toEqual({
      startHour: 20,
      endHour: 7,
    });
    expect(parseStudioQuietWindow("20-7")).toEqual({
      startHour: 20,
      endHour: 7,
    });
    expect(parseStudioQuietWindow(" 9/17 ")).toEqual({
      startHour: 9,
      endHour: 17,
    });
  });

  test("a zero-length window means never closed", () => {
    expect(parseStudioQuietWindow("18:18")).toBeNull();
  });

  test("anything unparseable keeps the shipped window rather than re-opening the night", () => {
    for (const raw of [
      "18",
      "18:",
      ":09",
      "24:09",
      "18:24",
      "night",
      "6pm-9am",
    ]) {
      expect(parseStudioQuietWindow(raw)).toEqual({
        startHour: QUIET_WINDOW_DEFAULT_START_HOUR,
        endHour: QUIET_WINDOW_DEFAULT_END_HOUR,
      });
    }
  });

  test("resolveStudioQuietWindow reads the env at call time, so tests and restarts both work", () => {
    expect(resolveStudioQuietWindow({})).toEqual(WINDOW);
    expect(
      resolveStudioQuietWindow({ REPORTING_STUDIO_QUIET_HOURS: "off" }),
    ).toBeNull();
    expect(
      resolveStudioQuietWindow({ REPORTING_STUDIO_QUIET_HOURS: "06:07" }),
    ).toEqual({
      startHour: 6,
      endHour: 7,
    });
  });
});

describe("isStudioQuietAt — 18:00 to 09:00 IST, wrapping midnight", () => {
  test("closes at 18:00 sharp and not one minute before", () => {
    expect(isStudioQuietAt(atUtc("12:29:59"), WINDOW)).toBe(false);
    expect(isStudioQuietAt(atUtc("12:30:00"), WINDOW)).toBe(true);
  });

  test("reopens at 09:00 sharp and not one minute before", () => {
    expect(isStudioQuietAt(atUtc("03:29:59"), WINDOW)).toBe(true);
    expect(isStudioQuietAt(atUtc("03:30:00"), WINDOW)).toBe(false);
  });

  test("the whole clinic day stays open", () => {
    for (const utc of ["03:30:00", "06:00:00", "09:00:00", "12:00:00"]) {
      expect(isStudioQuietAt(atUtc(utc), WINDOW)).toBe(false);
    }
  });

  test("midnight and the small hours are inside the window", () => {
    expect(isStudioQuietAt(atUtc("18:30:00"), WINDOW)).toBe(true);
    expect(isStudioQuietAt(atUtc("20:00:00"), WINDOW)).toBe(true);
    expect(isStudioQuietAt(atUtc("02:52:00"), WINDOW)).toBe(true);
  });

  test("a disabled window never closes", () => {
    expect(isStudioQuietAt(atUtc("20:00:00"), null)).toBe(false);
  });

  test("a non-wrapping window (09:17) closes the day instead of the night", () => {
    const day = { startHour: 9, endHour: 17 };
    expect(isStudioQuietAt(atUtc("03:30:00"), day)).toBe(true);
    expect(isStudioQuietAt(atUtc("10:00:00"), day)).toBe(true);
    expect(isStudioQuietAt(atUtc("12:30:00"), day)).toBe(false);
    expect(isStudioQuietAt(atUtc("20:00:00"), day)).toBe(false);
  });
});

describe("studioQuietSecondsRemaining / opensAt", () => {
  test("counts to the next 09:00 IST across the wrap", () => {
    expect(studioQuietSecondsRemaining(atUtc("02:30:00"), WINDOW)).toBe(3600);
    expect(studioQuietSecondsRemaining(atUtc("14:30:00"), WINDOW)).toBe(
      13 * 3600,
    );
    expect(studioQuietSecondsRemaining(atUtc("18:30:00"), WINDOW)).toBe(
      9 * 3600,
    );
    expect(studioQuietSecondsRemaining(atUtc("03:29:00"), WINDOW)).toBe(60);
  });

  test("is zero while the window is open", () => {
    expect(studioQuietSecondsRemaining(atUtc("06:00:00"), WINDOW)).toBe(0);
    expect(studioQuietSecondsRemaining(atUtc("06:00:00"), null)).toBe(0);
  });

  test("names the instant it reopens", () => {
    expect(studioQuietOpensAt(atUtc("02:30:00"), WINDOW).toISOString()).toBe(
      `${DAY}T03:30:00.000Z`,
    );
    // 20:00 IST on the 13th reopens 13 hours later: 09:00 IST on the 14th.
    expect(studioQuietOpensAt(atUtc("14:30:00"), WINDOW).toISOString()).toBe(
      "2026-11-14T03:30:00.000Z",
    );
  });
});

describe("buildStudioQuietRejection — what the studio is told", () => {
  test("says closed window, timezone, reopen time and Retry-After seconds", () => {
    const body = buildStudioQuietRejection(atUtc("14:30:00"), WINDOW);
    expect(body.quiet).toBe(true);
    expect(body.timezone).toBe("Asia/Kolkata");
    expect(body.quietWindow).toEqual({ startHour: 18, endHour: 9 });
    expect(body.retryAfterSeconds).toBe(13 * 3600);
    expect(body.opensAt).toBe("2026-11-14T03:30:00.000Z");
    expect(body.error).toContain("between 18:00 and 09:00 IST");
    expect(body.error).toContain("REPORTING_STUDIO_QUIET_HOURS");
  });
});
