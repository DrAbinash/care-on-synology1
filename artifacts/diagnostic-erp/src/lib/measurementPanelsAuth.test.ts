/**
 * measurementPanelsAuth.test.ts — composer panels must call the API through
 * the authed client, not raw fetch() (audit F-11).
 *
 * The auth middleware accepts only the Authorization header (plus the
 * legacy ?staffToken= fallback). MeasurementAssistantPanel and
 * LesionTrackerPanel used raw fetch(), which never carries the Bearer token,
 * so every call 401'd: measurement history never loaded (errors swallowed
 * with an empty catch, rendered as 'no history'), saves always failed with
 * 'Could not save measurements', and lesion CRUD always errored.
 *
 * Source pin in the repo's no-DOM idiom: no raw fetch( may remain in either
 * file, and error paths must surface, not swallow.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "../..");
const read = (rel: string) => readFileSync(resolve(PKG_DIR, rel), "utf8");

const MEASURE = "src/components/MeasurementAssistantPanel.tsx";
const LESION = "src/components/LesionTrackerPanel.tsx";

const measure = read(MEASURE).replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
const lesion = read(LESION).replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

const stripLineComments = (src: string) => src.replace(/^[ \t]*\/\/.*$/gm, "");
const measureCode = stripLineComments(measure);
const lesionCode = stripLineComments(lesion);

describe("F-11: the measurement and lesion panels use the authed client", () => {
  it("MeasurementAssistantPanel imports the authed api client", () => {
    expect(measure).toMatch(/import \{ api \} from "@\/lib\/fetchApi"/);
  });

  it("LesionTrackerPanel imports the authed api client", () => {
    expect(lesion).toMatch(/import \{ api \} from "@\/lib\/fetchApi"/);
  });

  it.each([
    ["MeasurementAssistantPanel", measureCode],
    ["LesionTrackerPanel", lesionCode],
  ])("%s contains no raw fetch() call", (_name, code) => {
    // Comments are stripped first: this test's own commentary quotes fetch().
    expect(code).not.toMatch(/\bfetch\(\s*["'`/]/);
    expect(code).not.toMatch(/=\s*fetch\(/);
  });

  it("measurement history failures are surfaced, not swallowed", () => {
    // The old code was `catch { /* ignore */ }` and rendered an auth failure
    // as 'No saved measurements.' Now a historyError state is set and shown.
    expect(measure).toMatch(/setHistoryError\(err instanceof Error \? err\.message/);
    expect(measure).toMatch(/data-testid="measurement-history-error"/);
  });

  it("lesion timeline failures are surfaced, not swallowed", () => {
    expect(lesion).toMatch(/title: "Could not load timeline"/);
  });

  it("save failures quote the server's message", () => {
    expect(measure).toMatch(/title: "Could not save measurements"/);
    expect(measure).toMatch(/description: err instanceof Error \? err\.message : undefined/);
  });
});
