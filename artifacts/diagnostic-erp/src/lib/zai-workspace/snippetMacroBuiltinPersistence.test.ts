/**
 * Built-in snippet macros are editable on the Templates screen, and the radiologist's
 * edit or deletion has to survive a reload.
 *
 * Measured on the pre-fix tree through the real store: saving an edit of `:discbulge`
 * persisted it as a custom macro, so the next load returned the untouched shipped default
 * AND the edit — 22 macros from 21 built-ins, two chips for one trigger, both expandable,
 * one of them the wording that was just replaced. Deleting a built-in persisted nothing at
 * all and the shipped macro came back on reload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SNIPPET_MACROS,
  createMacro,
  loadMacros,
  saveMacros,
} from "./snippet-macros-library";

const CUSTOM_KEY = "zai-rad-snippetmacros-v1";
const BUILTIN_KEY = "zai-rad-snippetmacros-builtin-v1";

function freshStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  });
  return data;
}

const EDITED = DEFAULT_SNIPPET_MACROS.find((m) => m.trigger === "discbulge")!;
const DELETED = DEFAULT_SNIPPET_MACROS.find((m) => m.trigger === "bdiff")!;

let useWorkspace: (typeof import("./store"))["useWorkspace"];
let macros: () => ReturnType<typeof loadMacros>;
let save: (input: Record<string, unknown>) => void;
let remove: (id: string) => void;

beforeEach(async () => {
  freshStorage();
  ({ useWorkspace } = await import("./store"));
  macros = () => useWorkspace.getState().snippetMacros;
  save = (input) => useWorkspace.getState().saveMacro(input as never);
  remove = (id) => useWorkspace.getState().deleteMacro(id);
  useWorkspace.setState({ snippetMacros: loadMacros() } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** What a reload does: the store boots from `loadMacros()`. */
function reopenWorkstation() {
  return loadMacros();
}

function countOf(list: { trigger: string }[], trigger: string) {
  return list.filter((m) => m.trigger === trigger).length;
}

/** The exact input macro-editor-dialog.tsx handleSave() sends when editing a built-in. */
function editBuiltinThroughDialog(
  target: typeof EDITED,
  patch: Record<string, unknown>,
) {
  save({
    id: target.id,
    trigger: patch.trigger ?? target.trigger,
    label: patch.label ?? target.label,
    template: patch.template ?? target.template,
    variables: patch.variables ?? target.variables,
    scopeModality: patch.scopeModality ?? target.scopeModality,
    scopeBodyPart: patch.scopeBodyPart ?? target.scopeBodyPart,
    custom: true,
  });
}

describe("snippet macro persistence", () => {
  it("control: an untouched workstation reloads exactly the shipped library", () => {
    expect(reopenWorkstation().map((m) => m.trigger)).toEqual(
      DEFAULT_SNIPPET_MACROS.map((m) => m.trigger),
    );
    expect(localStorage.getItem(BUILTIN_KEY)).toBeNull();
  });

  it("keeps one :discbulge with the edited wording across reload", () => {
    editBuiltinThroughDialog(EDITED, {
      label: "Disc bulge (mine)",
      template: "Broad-based disc bulge at {level}, edited locally.",
    });

    expect(
      countOf(macros(), "discbulge"),
      "no duplicate while the session runs",
    ).toBe(1);

    const after = reopenWorkstation();
    expect(countOf(after, "discbulge"), "one trigger, one macro").toBe(1);
    expect(after.find((m) => m.trigger === "discbulge")?.template).toContain(
      "edited locally",
    );
    expect(after.length).toBe(DEFAULT_SNIPPET_MACROS.length);
  });

  it("keeps a built-in deletion deleted across reload", () => {
    remove(DELETED.id);
    expect(macros().some((m) => m.trigger === "bdiff")).toBe(false);

    const after = reopenWorkstation();
    expect(
      countOf(after, "bdiff"),
      "the shipped macro must not come back",
    ).toBe(0);
    expect(after.length).toBe(DEFAULT_SNIPPET_MACROS.length - 1);
  });

  it("keeps custom macros across reload", () => {
    const mine = createMacro({
      trigger: "myspac",
      label: "My spacer",
      template: "Custom wording.",
      variables: [],
    });
    useWorkspace.setState({ snippetMacros: [...macros(), mine] } as never);
    saveMacros(macros());

    const after = reopenWorkstation();
    expect(countOf(after, "myspac")).toBe(1);
    expect(after.find((m) => m.trigger === "myspac")?.custom).toBe(true);
  });

  it("keeps an edited trigger when the radiologist renamed it", () => {
    editBuiltinThroughDialog(EDITED, {
      trigger: "mydisc",
      template: "Renamed and edited locally.",
    });

    const after = reopenWorkstation();
    expect(countOf(after, "mydisc")).toBe(1);
    expect(
      countOf(after, "discbulge"),
      "the shipped trigger must not be resurrected beside it",
    ).toBe(0);
    expect(after.length).toBe(DEFAULT_SNIPPET_MACROS.length);

    // Idempotent: a later unrelated save must not undo this one.
    useWorkspace.setState({ snippetMacros: after } as never);
    saveMacros(macros());
    const again = reopenWorkstation();
    expect(again.map((m) => m.trigger).sort()).toEqual(
      after.map((m) => m.trigger).sort(),
    );
  });

  it("still surfaces a newly shipped built-in after other built-ins were edited and deleted", () => {
    editBuiltinThroughDialog(EDITED, { template: "Edited locally." });
    remove(DELETED.id);

    const shippedLater = {
      ...EDITED,
      id: "sm_shipped_later",
      trigger: "newsentence",
      custom: undefined,
    };
    DEFAULT_SNIPPET_MACROS.push(shippedLater);
    try {
      const after = reopenWorkstation();
      expect(
        countOf(after, "newsentence"),
        "future content updates must not be swallowed",
      ).toBe(1);
      expect(countOf(after, "discbulge")).toBe(1);
      expect(after.find((m) => m.trigger === "discbulge")?.template).toContain(
        "Edited locally.",
      );
      expect(countOf(after, "bdiff")).toBe(0);
    } finally {
      DEFAULT_SNIPPET_MACROS.pop();
    }
  });

  it("refuses to write a corrupt storage entry back as macros", () => {
    freshStorage({ [CUSTOM_KEY]: "{not json", [BUILTIN_KEY]: "{not json" });
    expect(reopenWorkstation().map((m) => m.trigger)).toEqual(
      DEFAULT_SNIPPET_MACROS.map((m) => m.trigger),
    );
  });
});
