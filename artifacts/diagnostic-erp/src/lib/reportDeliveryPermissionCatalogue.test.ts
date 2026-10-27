/**
 * The Report Delivery permission vocabulary must be one vocabulary.
 *
 * Settings → Users renders a tick per sub-permission from `MODULE_SUB_PERMISSIONS`
 * and stores it as `"<path>:<id>"`; the server's `requireStaffSubPermission`
 * matches that same string out of `users.permissions`. Nothing joins the two, so
 * the failure mode is silent in both directions: a tick an admin clicks that the
 * server never reads, or an action the server gates on that no admin can ever
 * grant. This is the one place the lists are compared.
 *
 * Source-contract rather than runtime, because the two halves live in packages
 * that cannot import each other — the ERP is a browser bundle and `deliveryAccess.ts`
 * is server code. The regexes anchor on the declarations themselves, not on line
 * ranges, so an explanatory comment added above either list cannot shift what is
 * sliced out (a real hazard here: the previous copy of this file read a fixed
 * offset and silently matched nothing).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const erpRoot = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(erpRoot, rel), "utf8");

const settingsSrc = read("src/pages/Settings.tsx");
const serverSrc = read("../api-server/src/lib/deliveryAccess.ts");

function slice(src: string, re: RegExp, what: string): string {
  const m = re.exec(src);
  // `undefined` here means the regex matched but captured nothing, which would
  // hand back an empty slice and make every assertion on it vacuously true.
  if (!m || m[1] === undefined) throw new Error(`${what} not captured — the guard's own anchor went stale, not the catalogue`);
  return m[1];
}

/** Every `"..."` inside a declaration, in source order. */
const quoted = (body: string) => [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);

describe("Report Delivery permission catalogue", () => {
  const actions = quoted(slice(serverSrc, /const DELIVERY_ACTIONS = \[([\s\S]*?)\]/, "DELIVERY_ACTIONS"));
  const subPerms = slice(
    settingsSrc,
    /"\/report-delivery": \[([\s\S]*?)\n {2}\],/,
    'MODULE_SUB_PERMISSIONS["/report-delivery"]',
  );
  const grantedIds = [...subPerms.matchAll(/\{ id: "([^"]+)"/g)].map((m) => m[1]!);

  it("is non-empty on both sides — an empty slice would make every assertion below vacuous", () => {
    expect(actions.length).toBeGreaterThan(0);
    expect(grantedIds.length).toBeGreaterThan(0);
  });

  it("offers an admin exactly the actions the server gates on, in the same order", () => {
    expect(grantedIds).toEqual(actions);
  });

  it("is a grantable module in the user editor, not only a sub-permission block", () => {
    // A path in MODULE_SUB_PERMISSIONS with no ALL_MODULES row is unreachable:
    // the editor only renders ticks for modules it lists.
    expect(settingsSrc).toMatch(/\{ path: "\/report-delivery", label: "Report Delivery" \}/);
  });

  it("explains each tick to the person clicking it", () => {
    // The labels are the only thing an admin has to decide with; an id restated
    // as a label reads as jargon and gets ticked blindly, which is how a
    // "handover" grant came to mean different things on the two sides.
    const entries = [...subPerms.matchAll(/\{ id: "([^"]+)", label: "([^"]*)" \}/g)];
    expect(entries.length).toBe(actions.length);
    for (const [, id, label] of entries) {
      expect(label, `${id} needs a plain-language description`).not.toBe(id);
      expect(label.length, `${id} label is too short to decide on`).toBeGreaterThan(15);
    }
  });

  it("keeps the module path identical on both sides", () => {
    const modulePath = slice(serverSrc, /const DELIVERY_MODULE = "([^"]+)"/, "DELIVERY_MODULE");
    expect(modulePath).toBe("/report-delivery");
    expect(settingsSrc).toContain(`"${modulePath}": [`);
  });

  it("does not offer the new module twice in the default-landing-page picker", () => {
    // The picker renders every ALL_MODULES path plus a few hardcoded paths for
    // pages that are not grantable modules. A module added to ALL_MODULES while
    // its hardcoded row is still there shows the same label twice — which is
    // exactly what happened when Report Delivery was first made grantable.
    const picker = slice(
      settingsSrc,
      /(<Select value=\{watch\("defaultStartPage"\)[\s\S]*?<\/Select>)/,
      "the Default Landing Page select",
    );
    const hardcoded = [...picker.matchAll(/<SelectItem value="(\/[^"]*)">/g)].map((m) => m[1]!);
    const modulePaths = [...settingsSrc.matchAll(/^\s*\{ path: "(\/[^"]*)", label:/gm)].map((m) => m[1]!);
    expect(hardcoded.length, "the guard's own slice found nothing to check").toBeGreaterThan(0);
    expect(modulePaths.length, "ALL_MODULES produced no paths").toBeGreaterThan(5);
    for (const value of hardcoded) {
      expect(modulePaths, `${value} is mapped by ALL_MODULES too, so it renders twice`).not.toContain(value);
    }
  });
});
