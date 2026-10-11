/**
 * pacsPickerWiring.contract.test.ts — the PACS picker's props are wired by name.
 *
 * Why this exists and not a type error: the workspace column that mounts the
 * picker is one of the Phase 4 extraction files, and those carry `@ts-nocheck`
 * (the vm bag has no types yet). `studyInstanceUID=` was once passed where the
 * component declares `studyInstanceUid:` — tsc could not see it, the suite was
 * green, and the dialog opened on an empty sequence list with no error. The only
 * thing that caught it was a browser. This test is the standing substitute for
 * that browser, for the one call site a radiologist cannot work without.
 *
 * It is deliberately a *shape* check on real source text, not a grep for one
 * spelling: a rename on either side still fails, and deleting the mount fails.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8").replace(/\r\n/g, "\n");

/** Contents of the first balanced `{…}` after `open`. */
function balanced(source: string, open: string): string | null {
  const at = source.indexOf(open);
  if (at < 0) return null;
  const start = source.indexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(start + 1, i);
    }
  }
  return null;
}

/** Split a `{…}` body at its top-level commas. */
function segments(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let token = "";
  for (const ch of body) {
    if ("([{".includes(ch)) depth++;
    else if (")]}" .includes(ch)) depth--;
    if (ch === "," && depth === 0) { out.push(token); token = ""; continue; }
    token += ch;
  }
  out.push(token);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Statements must be read as code: this file's own comments name what they forbid. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** `open, onClose, onPick?` — a destructure list. */
function destructuredNames(body: string): string[] {
  return segments(body)
    .map((s) => /^(\w+)/.exec(s)?.[1])
    .filter((n): n is string => Boolean(n));
}

function declaredProps(componentRel: string): { all: string[]; required: string[] } {
  const src = read(componentRel);
  const componentName = componentRel.split("/").pop()!.replace(/\.tsx$/, "");
  const fnAt = src.indexOf(`function ${componentName}(`);
  expect(fnAt, `${componentName}: function not found`).toBeGreaterThanOrEqual(0);
  const destructure = balanced(src.slice(fnAt), "");
  expect(destructure, `${componentName}: could not find its props destructure`).not.toBeNull();
  const names = destructuredNames(destructure!);
  expect(names.length, `${componentName}: props destructure parsed empty`).toBeGreaterThan(0);

  const typeAt = src.indexOf("}: {", fnAt);
  expect(typeAt, `${componentName}: props type not found after the destructure`).toBeGreaterThan(fnAt);
  const typeBody = balanced(src.slice(typeAt), "");
  expect(typeBody, `${componentName}: could not find its props type`).not.toBeNull();

  // Every name the component reads must also be declared, and optionality is read
  // off the declaration — never off the call site, which is the thing under test.
  const missingFromType = names.filter((n) => !new RegExp(`(^|[\\s{;])${n}\\??\\s*:`).test(typeBody!));
  expect(missingFromType, `${componentName}: destructured but not declared: ${missingFromType.join(", ")}`).toEqual([]);
  const optional = names.filter((n) => new RegExp(`(^|[\\s{;])${n}\\?:`).test(typeBody!));
  return { all: names, required: names.filter((n) => !optional.includes(n)) };
}

/** Attributes of the `<Name … />` element, scanned at attribute depth only. */
function passedProps(callSiteRel: string, componentName: string): Array<{ name: string; value: string }> {
  const src = read(callSiteRel);
  const tag = `<${componentName}`;
  const at = src.indexOf(tag);
  expect(at, `${callSiteRel}: ${componentName} is not mounted here`).toBeGreaterThanOrEqual(0);
  const out: Array<{ name: string; value: string }> = [];
  let depth = 0;
  let i = at + tag.length;
  let token = "";
  const flush = () => {
    const m = /^([A-Za-z][\w]*)\s*=\s*\{?([^]*?)(?:\}?\s*$)/.exec(token.trim());
    if (m) out.push({ name: m[1], value: m[2].replace(/\}$/, "").trim() });
    else {
      const bare = /^([A-Za-z][\w]*)$/.exec(token.trim());
      if (bare && !["/>", "/"].includes(token.trim())) out.push({ name: bare[1], value: "true" });
    }
    token = "";
  };
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === "\n" && depth === 0) { flush(); continue; }
    else if (ch === "/" && depth === 0 && src[i + 1] === ">") break;
    token += ch;
  }
  flush();
  return out.filter((p) => !["/", ">"].includes(p.name));
}

describe("PACS picker call-site wiring (the @ts-nocheck blind spot)", () => {
  const DIALOG = "components/radiology/PacsImagePickerDialog.tsx";
  const RAIL = "components/radiology/FrozenKeyImagesRail.tsx";
  const COLUMN = "components/radiology/workspace/ViewerColumn.tsx";

  it("the picker dialog is mounted in the viewer column", () => {
    expect(read(COLUMN)).toContain("<PacsImagePickerDialog");
  });

  it("every prop the dialog is given is one the dialog declares", () => {
    const declared = declaredProps(DIALOG).all;
    const passed = passedProps(COLUMN, "PacsImagePickerDialog");
    const unknown = passed.map((p) => p.name).filter((n) => !declared.includes(n));
    expect(unknown, `undeclared props: ${unknown.join(", ")} — declared: ${declared.join(", ")}`).toEqual([]);
  });

  it("every prop the dialog REQUIRES is actually passed", () => {
    const required = declaredProps(DIALOG).required;
    const passed = passedProps(COLUMN, "PacsImagePickerDialog").map((p) => p.name);
    const missing = required.filter((n) => !passed.includes(n));
    expect(missing, `required props not wired: ${missing.join(", ")}`).toEqual([]);
  });

  it("the study is handed over under the DICOMweb spelling the dialog reads", () => {
    const passed = passedProps(COLUMN, "PacsImagePickerDialog");
    const identity = passed.find((p) => /^studyInstanceU?i[dD]$/.test(p.name));
    expect(identity, "no study-identity prop is passed at all").toBeDefined();
    // The dialog's own parameter is `studyInstanceUid`; `studyInstanceUID` is the
    // DICOM tag name and is silently ignored by React.
    expect(identity!.name).toBe("studyInstanceUid");
    expect(identity!.value).toContain("pacsStudyUid");
  });

  it("the rail is only ever given props it declares", () => {
    const declared = declaredProps(RAIL).all;
    const passed = passedProps(COLUMN, "FrozenKeyImagesRail");
    const unknown = passed.map((p) => p.name).filter((n) => !declared.includes(n));
    expect(unknown, `undeclared props: ${unknown.join(", ")}`).toEqual([]);
    expect(passed.map((p) => p.name)).toContain("onPickFromPacs");
  });

  it("the picker cannot open on a silent empty list", () => {
    const dialog = read(DIALOG);
    // A report with no PACS link must be told so, not shown an empty sequence pane.
    expect(dialog).toContain("not linked to a PACS study");
  });
});

/**
 * §2 — the key-images rail and the embedded viewer used to mount on
 * `workflow.currentRow`, which is the reading queue's row for the CURRENT FILTER.
 * Changing the modality or date filter (or opening a report by link) made it null,
 * so the only way to attach a PACS image vanished from a report that was still
 * open, still locked to this radiologist and still being written. Identity now
 * comes from `resolveOpenStudyIdentity`, off the same by-id read that already
 * decides the lock and the signed status.
 *
 * These assert the structure, not one spelling: handing the queue back to either
 * consumer fails, and so does deriving identity from it inside the bridge.
 */
describe("the open report's image identity does not ride on the filtered queue", () => {
  const COLUMN = "components/radiology/workspace/ViewerColumn.tsx";
  const CLINICAL = "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx";
  const BRIDGE = "hooks/radiology-workspace/useOhifViewerBridge.ts";

  it("identity is resolved from the by-id worklist read", () => {
    const src = read(CLINICAL);
    expect(src).toContain("resolveOpenStudyIdentity({");
    const memo = balanced(src.slice(src.indexOf("const reportIdentity = useMemo(")), "");
    expect(memo, "no reportIdentity memo found").not.toBeNull();
    expect(memo).toContain("detail: worklistDetailQ.data");
    expect(memo).toContain("queueRow: workflow.currentRow");
    // …and it reaches the column that mounts the rail. Both the bridge args and
    // the vm bag hold a bare `reportIdentity,` at the same indent, so the check
    // is bound to the bag itself — otherwise deleting it from the vm survives.
    const vmBody = balanced(src.slice(src.indexOf("  const vm = {")), "");
    expect(vmBody, "the vm bag was not found").not.toBeNull();
    expect(destructuredNames(vmBody!), "reportIdentity never reaches the viewer column").toContain("reportIdentity");
  });

  it("the viewer bridge is not handed the reading queue at all", () => {
    const src = read(CLINICAL);
    const args = balanced(src.slice(src.indexOf("useOhifViewerBridge({")), "");
    expect(args, "useOhifViewerBridge is not called here").not.toBeNull();
    const given = destructuredNames(code(args!));
    expect(given).toContain("reportIdentity");
    expect(given, "the bridge can reach the filtered queue — identity can come from the wrong study").not.toContain("workflow");
    // The options type must not offer it either, or the next edit takes it back.
    const options = balanced(read(BRIDGE), "export type UseOhifViewerBridgeOptions =");
    expect(options).not.toBeNull();
    expect(options).not.toContain("workflow");
    const bridgeCode = code(read(BRIDGE));
    expect(bridgeCode, "the bridge reads the queue row again").not.toContain("workflow.currentRow");
  });

  it("every study field the bridge uses is derived from the resolved identity", () => {
    const src = read(BRIDGE);
    for (const local of ["openStudyUid", "openPatientId", "openLinkedStudyId", "openAccession"]) {
      expect(src, `${local} is not derived from reportIdentity`).toContain(`const ${local} = reportIdentity?.`);
    }
  });

  it("the rail mounts on the open report, not on a queue row", () => {
    const src = read(COLUMN);
    const mount = src.slice(src.indexOf("{!viewerColumnExpanded && reportIdentity"));
    expect(mount.length, "the key-images rail no longer mounts on reportIdentity").toBeGreaterThan(0);
    expect(mount.slice(0, 400)).toContain("<FrozenKeyImagesRail");
    expect(src).not.toContain("{!viewerColumnExpanded && workflow.currentRow");
  });

  it("no live viewer-column image prop reads off the queue row", () => {
    for (const name of ["EmbeddedWadoViewer", "FrozenKeyImagesRail"]) {
      const offenders = passedProps(COLUMN, name)
        .filter((p) => p.value.includes("workflow.currentRow"))
        .map((p) => p.name);
      expect(offenders, `${name}: identity from the filtered queue: ${offenders.join(", ")}`).toEqual([]);
    }
    const ctx = balanced(read(COLUMN), "const pacsContext =");
    expect(ctx, "the picker context is gone").not.toBeNull();
    expect(ctx).not.toContain("workflow.currentRow");
  });

  /**
   * The printed report header is the same coupling in a second consumer, and it
   * is worse: with `workflow.currentRow` absent, `patientName` and `studyDate`
   * resolved to undefined while `age` did not (it already had a detail
   * fallback), so a radiologist who filtered the reading queue and then printed
   * got a report showing "AGE/SEX: 45 YRS" with no patient name and no date.
   * Reproduced in a real browser before this guard existed.
   */
  it("the printed demography does not depend on the queue containing the study", () => {
    const HOOK = "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx";
    const src = read(HOOK);
    const memo = balanced(src, "const canonicalDemography = useMemo");
    expect(memo, "canonicalDemography is gone").not.toBeNull();
    const erp = balanced(memo!, "erp:");
    expect(erp, "the erp demography object is gone").not.toBeNull();

    for (const field of ["patientName", "studyDate", "accessionNumber", "sex", "referringDoctor", "studyDescription", "patientId"]) {
      const line = erp!.split("\n").find((l) => new RegExp(`^\\s*${field}:`).test(l));
      expect(line, `${field} is no longer in the erp demography`).toBeTruthy();
      expect(
        line!,
        `${field} reads only off the filtered queue row: ${line!.trim()}`,
      ).toMatch(/detail\?\./);
    }
  });
});
