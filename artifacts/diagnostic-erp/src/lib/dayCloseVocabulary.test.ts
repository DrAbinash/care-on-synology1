import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DRAWER_STATUS_NOT_VERIFIED,
  FIRST_CLOSE_WINDOW_TEXT,
  drawerStatusLabel,
  predictedCloseLabel,
  windowFromCell,
} from "./dayCloseVocabulary";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The words a cashier signs, an admin reads in an email, and the screen shows are
 * the same three characters or they are not the same fact. A drawer closed without
 * a count has variance zero, so every older rendering that branched on
 * `variance === 0` / `drawerStatus !== "balanced"` turned it into either "Balanced"
 * or "Mismatch — variance ₹0.00". Both are lies, in opposite directions.
 */
describe("drawerStatusLabel", () => {
  test("names the un-counted drawer the way the clinic asked for it", () => {
    expect(drawerStatusLabel(DRAWER_STATUS_NOT_VERIFIED)).toBe("Not Physically Verified");
    expect(DRAWER_STATUS_NOT_VERIFIED).toBe("not_physically_verified");
  });

  test("keeps every status the server can already write", () => {
    expect(drawerStatusLabel("open")).toBe("Open");
    expect(drawerStatusLabel("balanced")).toBe("Balanced");
    expect(drawerStatusLabel("mismatch")).toBe("Mismatch");
    expect(drawerStatusLabel("approved")).toBe("Approved");
    expect(drawerStatusLabel("closed")).toBe("Closed");
    expect(drawerStatusLabel("reopened")).toBe("Reopened");
  });

  test("never calls a closed drawer Open", () => {
    // The screens this replaced looked the status up in a config map with an
    // `?? open` fallback, so an unfamiliar value read as an unfinished drawer.
    expect(drawerStatusLabel("auto_balanced")).toBe("Auto Balanced");
    expect(drawerStatusLabel("")).toBe("Open");
    expect(drawerStatusLabel(null)).toBe("Open");
    expect(drawerStatusLabel(undefined)).toBe("Open");
  });

  test("does not print the raw column value anywhere", () => {
    expect(drawerStatusLabel(DRAWER_STATUS_NOT_VERIFIED)).not.toMatch(/_/);
  });
});

describe("the wording is the same on paper and in the mail", () => {
  test("the api-server mirror maps the same status to the same words", () => {
    const serverSource = readFileSync(
      join(__dirname, "../../../api-server/src/lib/dayCloseVocabulary.ts"),
      "utf8",
    );
    const clientSource = readFileSync(join(__dirname, "dayCloseVocabulary.ts"), "utf8");
    for (const source of [serverSource, clientSource]) {
      expect(source).toContain('"not_physically_verified"');
      expect(source).toContain('"Not Physically Verified"');
    }
    expect(clientSource).toContain('"Not Physically Verified"');
  });

  test("the slip and the email both refuse Balanced for an un-counted drawer", () => {
    const slip = readFileSync(join(__dirname, "staffDayCloseSlip.ts"), "utf8");
    const email = readFileSync(
      join(__dirname, "../../../api-server/src/lib/staffDayCloseEmail.ts"),
      "utf8",
    );
    expect(slip).toContain("Not Physically Verified — the cash was not counted");
    expect(email).toContain("Not Physically Verified — the cash was not counted");
  });

  test("every screen that colours a drawer knows the new status", () => {
    // Each of these looks the status up in a map with a fallback that reads as an
    // OPEN drawer, so a screen that never learned the value shows a closed cashier
    // as still working. Banning one spelling is not enough — the map itself has to
    // carry it.
    const screens = [
      ["MyDailySummary.tsx", join(__dirname, "../pages/MyDailySummary.tsx")],
      ["DayClose.tsx", join(__dirname, "../pages/DayClose.tsx")],
      ["MyDayClose.tsx", join(__dirname, "../pages/MyDayClose.tsx")],
      ["StaffDayCloseDialog.tsx", join(__dirname, "../components/StaffDayCloseDialog.tsx")],
    ] as const;
    for (const [, path] of screens) {
      expect(readFileSync(path, "utf8")).toContain("not_physically_verified");
    }
    // The two forms that decide this must say what the close will RECORD, not just
    // whether the typed numbers add up.
    for (const path of [
      join(__dirname, "../pages/MyDayClose.tsx"),
      join(__dirname, "../components/StaffDayCloseDialog.tsx"),
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("predictedCloseLabel");
      expect(source).toMatch(/Records as|Will record as/);
    }
  });
});

/**
 * The same 12 decisions `day-close.physicalVerification.test.ts` pins on the
 * server. The screen must not promise one thing and store another: this table is
 * the only place the client is allowed to reason about the outcome, and it has to
 * agree with the server row for row.
 */
describe("predictedCloseLabel agrees with the server, row for row", () => {
  const TRUTH: Array<[number, boolean, boolean, string]> = [
    [0, false, false, "Not Physically Verified"],
    [0, true, false, "Balanced"],
    [0, false, true, "Balanced"],
    [0, true, true, "Balanced"],
    [-500, false, false, "Mismatch"],
    [-500, true, false, "Mismatch"],
    [-500, false, true, "Mismatch"],
    [-500, true, true, "Mismatch"],
    [250, false, false, "Mismatch"],
    [250, true, false, "Mismatch"],
    [250, false, true, "Mismatch"],
    [250, true, true, "Mismatch"],
  ];

  test.each(TRUTH)(
    "variance %i, counted %s, denominations %s → %s",
    (variance, physicallyCounted, denominationsEntered, expected) => {
      expect(predictedCloseLabel({ variance, physicallyCounted, denominationsEntered }))
        .toBe(expected);
    },
  );
});

describe("windowFromCell", () => {
  const fmt = (iso: string) => iso.slice(0, 10);

  test("says what a NULL boundary means instead of printing a dash", () => {
    expect(windowFromCell(null, fmt)).toBe(FIRST_CLOSE_WINDOW_TEXT);
    expect(windowFromCell(undefined, fmt)).toBe(FIRST_CLOSE_WINDOW_TEXT);
    expect(windowFromCell(null, fmt)).toMatch(/first close/i);
  });

  test("leaves a real boundary to the caller's formatter", () => {
    expect(windowFromCell("2026-10-06T18:30:00.000Z", fmt)).toBe("2026-10-06");
  });
});
