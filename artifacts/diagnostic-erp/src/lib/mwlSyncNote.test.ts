/**
 * Z.AI audit item 8 (client half) — the workspace toast must say what the
 * modality was actually told.
 *
 * The PATCH returns the republish outcome; before this the component dropped it
 * and toasted "Referring doctor set" even when no `.wl` existed for the study or
 * when the rewrite failed. These are pure decisions — the component is not
 * renderable in this repo's Vitest setup (node environment, no jsdom), so the
 * judgement lives here and the wiring is pinned by the source contract at the end.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mwlSyncNote, referringDoctorToastDescription } from "./mwlSyncNote";

describe("mwlSyncNote", () => {
  it("names the two states the desk can act on", () => {
    expect(mwlSyncNote({ attempted: false, action: "no_procedure_row" })).toContain(
      "no worklist entry",
    );
    expect(mwlSyncNote({ attempted: false, action: "failed" })).toContain("could not be rewritten");
  });

  it("says so when a write was attempted and no file came out", () => {
    // `attempted: true` + `action: "written"` is the shape of "we called the
    // publisher". `written: false` is the atomic publisher leaving nothing on
    // disk — dump2dcm missing or Orthanc refusing the file. Only the second is
    // a broken console, so only the second is spoken about.
    expect(mwlSyncNote({ attempted: true, action: "written", written: false })).toContain(
      "could not be rewritten",
    );
    expect(mwlSyncNote({ attempted: true, action: "written", written: true })).toBeNull();
  });

  it("stays silent for the states that are normal here", () => {
    // No worklist folder configured, and a test the machine is not supposed to
    // be handed. A warning about either would train the desk to ignore it.
    expect(mwlSyncNote({ attempted: false, action: "skipped" })).toBeNull();
    expect(mwlSyncNote({ attempted: true, action: "withheld" })).toBeNull();
    expect(mwlSyncNote({ attempted: true, action: "removed" })).toBeNull();
    expect(mwlSyncNote(null)).toBeNull();
    expect(mwlSyncNote(undefined)).toBeNull();
    expect(mwlSyncNote({})).toBeNull();
  });

  it("classifies every action the server can return", () => {
    // Pinned against `republishWorklistForAccession` + `syncWorklistForStatus`.
    // A new action string must make this fail rather than toast silence about a
    // state nobody has decided the wording for.
    const serverActions = ["skipped", "no_procedure_row", "withheld", "failed", "removed", "written"];
    const warns = serverActions.filter((a) => mwlSyncNote({ action: a, written: false }) !== null);
    expect(warns.sort()).toEqual(["failed", "no_procedure_row", "written"]);
  });

  it("keeps a name the user typed intact when there is nothing to warn about", () => {
    expect(referringDoctorToastDescription("DR MEHRA", { action: "skipped" })).toBe("DR MEHRA");
    expect(referringDoctorToastDescription(null, { action: "skipped" })).toBe("Cleared");
  });

  it("appends the verdict to the name, and to the cleared case too", () => {
    const out = referringDoctorToastDescription("DR MEHRA", {
      attempted: false,
      action: "no_procedure_row",
    });
    expect(out).toBe("DR MEHRA — this study has no worklist entry, so nothing was sent to the machine");
    expect(
      referringDoctorToastDescription(null, { attempted: true, action: "written", written: false }),
    ).toBe("Cleared — the worklist file could not be rewritten");
  });
});

describe("ReferringDoctorQuickSelect wiring", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../components/ReferringDoctorQuickSelect.tsx"),
    "utf8",
  );

  it("toasts the server's worklist verdict instead of dropping it", () => {
    // The component is not renderable here, so this pins the one line the defect
    // lived in: the description used to be `data.referringDoctor || "Cleared"`,
    // which threw `data.mwl` away.
    expect(source).toContain("referringDoctorToastDescription(data.referringDoctor, data.mwl)");
    expect(source).not.toContain('description: data.referringDoctor || "Cleared"');
  });
});
