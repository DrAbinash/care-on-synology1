import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const api = readFileSync(join(__dirname, "day-close.ts"), "utf8");
const ui = readFileSync(
  join(__dirname, "../../../diagnostic-erp/src/pages/MyDailySummary.tsx"),
  "utf8",
);

// The fault this pins is a scope mismatch between two boxes that sit one above
// the other on My Daily Summary: the drawer card followed the super-admin's
// staff filter while "Since last close (Live)" always asked for the signed-in
// admin's own window. The admin saw ₹0 bills above a cashier's closed ₹2,43,000
// drawer and the pair read as one empty drawer.

function handlerSlice(startMarker: string): string {
  const start = api.indexOf(startMarker);
  expect(start, `${startMarker} not found in day-close.ts`).toBeGreaterThan(-1);
  const end = api.indexOf("dayCloseRouter.", start + startMarker.length);
  return api.slice(start, end === -1 ? api.length : end);
}

const myPreview = handlerSlice('dayCloseRouter.get("/my-preview"');
const staffPreview = handlerSlice('dayCloseRouter.get("/staff-preview/:userName"');

describe("the two open-window endpoints return the same money", () => {
  it("staff-preview stays admin-gated", () => {
    expect(staffPreview).toContain("requireOwnerOrAdmin");
  });

  it("staff-preview returns every field the live box renders", () => {
    // A missing key here silently drops a warning, not just a number.
    for (const key of [
      "userName", "coveredFromTs", "expected", "billsCount", "paymentsCount",
      "totalBilled", "totalDue", "suspenseTotal", "bills",
      "sameDayAfterPriorClose",
    ]) {
      expect(staffPreview, `staff-preview does not return ${key}`).toContain(key);
      expect(myPreview, `my-preview does not return ${key}`).toContain(key);
    }
  });
});

describe("the live open-window box follows the same staff filter as the drawer card", () => {
  const previewBlock = (() => {
    const start = ui.indexOf("const myPreviewQ = useQuery");
    expect(start).toBeGreaterThan(-1);
    return ui.slice(start, ui.indexOf("const s = data?.summary", start));
  })();

  it("keys the query by the person being viewed, so two staff never share a cache entry", () => {
    expect(previewBlock).toContain('queryKey: ["my-day-close-preview", drawerStaffName ?? "self"]');
  });

  it("asks for that staff member's window, and for its own otherwise", () => {
    expect(previewBlock).toContain("drawerStaffName");
    expect(previewBlock).toContain("/api/day-close/staff-preview/");
    expect(previewBlock).toContain('"/api/day-close/my-preview"');
  });

  it("does not show the admin's own drawer in All-Staff view", () => {
    expect(previewBlock).toContain("enabled: !isSuperAdmin || !!staffFilter.trim()");
  });

  it("says whose live window the zeros belong to", () => {
    const start = ui.indexOf("Since last close (Live)");
    expect(start).toBeGreaterThan(-1);
    const box = ui.slice(start, ui.indexOf("Bills in Open Window", start));
    expect(box).toContain("data-testid=\"live-window-owner\"");
    expect(box).toContain("myPreviewQ.data.userName");
  });

  it("never offers to close someone else's drawer from the admin's own close screen", () => {
    const start = ui.indexOf("Since last close (Live)");
    const box = ui.slice(start, ui.indexOf("Bills in Open Window", start));
    // The filtered branch comes first and points at the Day Close handover;
    // /my-day-close stays reserved for the signed-in user's own drawer.
    expect(box).toContain("drawerStaffName ?");
    expect(box.indexOf('href="/day-close"')).toBeGreaterThan(-1);
    expect(box.indexOf('href="/day-close"')).toBeLessThan(box.indexOf('href="/my-day-close"'));
    expect(box).toContain("data-testid=\"live-window-close-other\"");
  });
});
