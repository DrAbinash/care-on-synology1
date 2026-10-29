import { describe, expect, test } from "vitest";
import path from "node:path";
import {
  DELETE_CONFIRM_PHRASE,
  DELETE_HARD_CAP,
  formatBytes,
  parseBackupTimestamp,
  resolveRange,
  selectBackupFilesForDeletion,
  seriesKeyOf,
  type ServerBackupFile,
} from "./backupFileRetention";

// The deciding question here is "which files may an admin throw away", and the
// failure mode worth protecting against is the one that costs the clinic its
// data: a range that quietly includes the only restorable dump. So every case
// below asserts both directions — what goes, and what must survive.

const NOW = new Date("2026-10-29T18:00:00.000Z");
const DIR = "/volume1/backup/care-erp/db";

function f(fileName: string, over: Partial<ServerBackupFile> = {}): ServerBackupFile {
  return {
    filePath: path.posix.join(over.directory ?? DIR, fileName),
    fileName,
    directory: over.directory ?? DIR,
    sizeBytes: 900_000_000,
    modifiedAt: "2026-10-20T00:00:00.000Z",
    encrypted: fileName.endsWith(".enc"),
    ...over,
  };
}

const dump = (day: string, hour = "02") => f(`backup_DB_2026-${day}T${hour}-00-00-000Z.sql.enc`);

describe("parseBackupTimestamp", () => {
  test("prefers the timestamp in the name over an mtime that a copy would have moved", () => {
    const file = f("backup_DB_2026-09-28T21-30-10-399Z.sql.enc", { modifiedAt: "2026-10-29T00:00:00.000Z" });
    const { at, source } = parseBackupTimestamp(file, NOW);
    expect(source).toBe("name");
    expect(at.toISOString()).toBe("2026-09-28T21:30:10.399Z");
  });

  test("falls back to mtime when the name carries no date", () => {
    const { at, source } = parseBackupTimestamp(f("mystery.sql.gz", { modifiedAt: "2026-08-01T00:00:00.000Z" }), NOW);
    expect(source).toBe("mtime");
    expect(at.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  test("refuses a future-dated name and reads mtime instead", () => {
    const { source } = parseBackupTimestamp(f("backup_DB_2099-01-01T00-00-00-000Z.sql.enc"), NOW);
    expect(source).toBe("mtime");
  });
});

describe("seriesKeyOf", () => {
  test("groups a series and separates two series in the same folder", () => {
    const a = seriesKeyOf(dump("10-01"));
    const b = seriesKeyOf(dump("10-28"));
    expect(a).toBe(b);
    expect(seriesKeyOf(f("backup_Nightly_2026-10-01T02-00-00-000Z.sql.enc"))).not.toBe(a);
    expect(seriesKeyOf(f("caredeoghar-files-2026-10-01.zip"))).not.toBe(a);
  });

  test("separates the same series name in two different directories", () => {
    const name = "backup_DB_2026-10-01T02-00-00-000Z.sql.enc";
    const inA = f(name, { directory: "/volume1/a" });
    const inB = f(name, { directory: "/volume1/b" });
    expect(inA.filePath).not.toBe(inB.filePath);
    expect(seriesKeyOf(inA)).not.toBe(seriesKeyOf(inB));
  });
});

describe("resolveRange", () => {
  test("requires both ends", () => {
    expect(() => resolveRange({ dateFrom: "2026-10-01" }, NOW)).toThrow(/complete date range/i);
    expect(() => resolveRange({}, NOW)).toThrow(/complete date range/i);
  });
  test("rejects a reversed range and a future range", () => {
    expect(() => resolveRange({ dateFrom: "2026-10-05", dateTo: "2026-10-01" }, NOW)).toThrow(/starts after it ends/i);
    expect(() => resolveRange({ dateFrom: "2027-01-01", dateTo: "2027-01-02" }, NOW)).toThrow(/in the future/i);
  });
  test("the end of the range is the end of that day, so the named day is included", () => {
    const { to } = resolveRange({ dateFrom: "2026-10-01", dateTo: "2026-10-01" }, NOW);
    expect(to.toISOString()).toBe("2026-10-01T23:59:59.999Z");
  });
});

describe("selectBackupFilesForDeletion", () => {
  const series = [dump("10-01"), dump("10-05"), dump("10-12"), dump("10-28")];
  const nightly = [f("backup_Nightly_2026-10-02T02-00-00-000Z.sql.enc"), f("backup_Nightly_2026-10-27T02-00-00-000Z.sql.enc")];
  const all = [...series, ...nightly];
  const range = { dateFrom: "2026-09-01", dateTo: "2026-10-31" };

  test("keeps the newest file of every series even though it falls inside the range", () => {
    const sel = selectBackupFilesForDeletion(all, range, [DIR], NOW);
    expect(sel.candidates.map(c => c.fileName)).toEqual([
      "backup_DB_2026-10-01T02-00-00-000Z.sql.enc",
      "backup_DB_2026-10-05T02-00-00-000Z.sql.enc",
      "backup_DB_2026-10-12T02-00-00-000Z.sql.enc",
      "backup_Nightly_2026-10-02T02-00-00-000Z.sql.enc",
    ]);
    expect(sel.protectedFiles.map(p => p.fileName).sort()).toEqual([
      "backup_DB_2026-10-28T02-00-00-000Z.sql.enc",
      "backup_Nightly_2026-10-27T02-00-00-000Z.sql.enc",
    ]);
    expect(sel.protectedFiles[0].reason).toMatch(/newest file of its series/);
  });

  test("a single-file series can never be deleted at all", () => {
    const sel = selectBackupFilesForDeletion([dump("10-28")], range, [DIR], NOW);
    expect(sel.count).toBe(0);
    expect(sel.protectedFiles).toHaveLength(1);
  });

  test("the range is honoured on both sides", () => {
    // The series' newest dump (10-28) sits outside this window, so it is simply
    // not offered — and because a newer copy survives, 10-12 may go with 10-05.
    const sel = selectBackupFilesForDeletion(all, { dateFrom: "2026-10-04", dateTo: "2026-10-13" }, [DIR], NOW);
    expect(sel.candidates.map(c => c.fileName)).toEqual([
      "backup_DB_2026-10-05T02-00-00-000Z.sql.enc",
      "backup_DB_2026-10-12T02-00-00-000Z.sql.enc",
    ]);
    expect(sel.protectedFiles).toHaveLength(0);
    expect(sel.outsideRange).toBe(4);
  });

  test("nothing outside the listed directories is ever offered", () => {
    // Same shape as a real dump, but sitting in the deploy checkout: the
    // extension test must not be what saves it, the containment test must.
    const intruder = f("backup_DB_2026-10-01T02-00-00-000Z.sql.enc", { directory: "/volume1/docker/care-erp-github" });
    const sel = selectBackupFilesForDeletion([intruder], range, [DIR], NOW);
    expect(sel.count).toBe(0);
    expect(sel.ignored[0].reason).toMatch(/outside the directories/);
  });

  test("a path that escapes its directory is refused even with a backup extension", () => {
    const trick = f("backup_DB_2026-10-01T02-00-00-000Z.sql.enc");
    trick.filePath = path.posix.join(DIR, "sub", trick.fileName);
    trick.directory = path.posix.join(DIR, "sub");
    const sel = selectBackupFilesForDeletion([trick], range, [DIR], NOW);
    expect(sel.count).toBe(0);
    expect(sel.ignored).toHaveLength(1);
  });

  test("an unrecognised extension is ignored rather than deleted", () => {
    const sel = selectBackupFilesForDeletion([f("notes.txt")], range, [DIR], NOW);
    expect(sel.count).toBe(0);
    expect(sel.ignored[0].reason).toMatch(/extension/);
  });

  test("totals and cap are reported so the UI can refuse a bulk delete", () => {
    // Distinct days, so nothing collides and the count that reaches the cap is
    // the count the operator would actually be deleting.
    const many = Array.from({ length: DELETE_HARD_CAP + 3 }, (_, i) => {
      const day = new Date(Date.UTC(2024, 0, 2) + i * 86_400_000).toISOString().slice(0, 10);
      return f(`backup_DB_${day}T02-00-00-000Z.sql.enc`);
    });
    const sel = selectBackupFilesForDeletion(many, { dateFrom: "2024-01-01", dateTo: "2026-10-31" }, [DIR], NOW);
    expect(sel.count).toBe(many.length - 1);
    expect(sel.overCap).toBe(true);
    expect(sel.hardCap).toBe(DELETE_HARD_CAP);
    expect(sel.totalBytes).toBe(sel.candidates.length * 900_000_000);
    expect(formatBytes(sel.totalBytes)).toMatch(/GB|TB/);
  });

  test("the confirmation phrase is exported for the UI to demand verbatim", () => {
    expect(DELETE_CONFIRM_PHRASE).toBe("DELETE BACKUPS");
  });
});

describe("formatBytes", () => {
  test("speaks in the units an operator reads", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(900_000_000)).toBe("858.3 MB");
    expect(formatBytes(696 * 1024 ** 3)).toBe("696.0 GB");
  });
});
