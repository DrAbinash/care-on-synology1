import { describe, expect, test, vi } from "vitest";

// website.ts imports `db` from @workspace/db at module top level, which
// throws unconditionally at import time when DATABASE_URL is not set.
// defaultHomeSectionsJson/DEFAULT_HOME_SECTION_TYPES are pure — they never
// touch the database — so mocking the module prevents the load-time throw
// without affecting what is under test. Same pattern as
// day-close.test.ts / auto-voucher.test.ts.
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [], orderBy: () => ({ limit: async () => [] }) }) }) }),
    insert: () => ({ values: () => ({ returning: async () => [{}] }) }),
  },
  siteSettingsTable: {},
  sitePagesTable: {},
  sitePopupsTable: {},
  siteFaqsTable: {},
  sitePhotosTable: {},
}));
vi.mock("@workspace/db/schema", () => ({ portalSessionsTable: {}, usersTable: {} }));

import { DEFAULT_HOME_SECTION_TYPES, defaultHomeSectionsJson } from "./website";

// The section types the public clinic-site's SectionRenderer actually
// implements (artifacts/clinic-site/src/sections.tsx). Duplicated here
// (rather than imported cross-package) as an explicit regression guard:
// if DEFAULT_HOME_SECTION_TYPES ever includes a type SectionRenderer
// doesn't handle, that section would silently render nothing on a
// freshly-created home page. If this list and sections.tsx's switch
// statement ever diverge, update both together.
const RENDERABLE_SECTION_TYPES = new Set([
  "header", "hero", "services", "reviews", "connect", "subscribe", "footer",
  "stats", "why_choose_us", "technology", "health_packages",
  "appointment", "faq", "gallery", "custom_html", "contact",
]);

describe("defaultHomeSectionsJson — root-cause fix for empty published home page", () => {
  test("produces a non-empty section list", () => {
    const sections = JSON.parse(defaultHomeSectionsJson());
    expect(Array.isArray(sections)).toBe(true);
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.length).toBe(DEFAULT_HOME_SECTION_TYPES.length);
  });

  test("every default section is enabled", () => {
    const sections = JSON.parse(defaultHomeSectionsJson());
    expect(sections.every((s: { enabled: boolean }) => s.enabled === true)).toBe(true);
  });

  test("every default section type is actually renderable by the public site (regression guard)", () => {
    for (const type of DEFAULT_HOME_SECTION_TYPES) {
      expect(RENDERABLE_SECTION_TYPES.has(type)).toBe(true);
    }
  });

  test("includes the core premium-redesign sections, not just header/footer", () => {
    const types = JSON.parse(defaultHomeSectionsJson()).map((s: { type: string }) => s.type);
    for (const required of ["hero", "stats", "services", "why_choose_us", "technology", "health_packages"]) {
      expect(types).toContain(required);
    }
  });

  test("every section has a unique id", () => {
    const sections = JSON.parse(defaultHomeSectionsJson());
    const ids = sections.map((s: { id: string }) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
