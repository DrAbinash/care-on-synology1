import { describe, it, expect, beforeEach } from "vitest";
import { isFeatureEnabled, setServerFeatureFlags, canAccess, type StaffSession } from "./staffSession";

// Ticket T0.1 coverage: the server-overlay layer added to the pre-existing
// client-only feature flag system. Runs under vitest's node environment (no
// jsdom, no `window`) — staffSession.ts's existing `typeof window !==
// "undefined"` guards mean these pure-logic paths are still fully testable
// without a DOM, exactly like the existing localStorage guards already do.

describe("isFeatureEnabled — ff_radiology_* defaults", () => {
  beforeEach(() => {
    setServerFeatureFlags({}); // reset any server override left by a prior test
  });

  it("defaults every ff_radiology_ flag to false before hydration", () => {
    expect(isFeatureEnabled("ff_radiology_structured_core")).toBe(false);
    expect(isFeatureEnabled("ff_radiology_render_v2")).toBe(false);
    expect(isFeatureEnabled("ff_radiology_scale_partition")).toBe(false);
  });

  it("leaves pre-existing, non-radiology flags at their original defaults", () => {
    // Spot-check a couple of the flags that existed before this ticket —
    // must be byte-identical to pre-ticket behavior.
    expect(isFeatureEnabled("billingDeskQuickTests")).toBe(true);
    expect(isFeatureEnabled("showMeasurementPanel")).toBe(false);
  });
});

describe("setServerFeatureFlags", () => {
  beforeEach(() => {
    setServerFeatureFlags({});
  });

  it("server value wins for a ff_radiology_ key once hydrated", () => {
    expect(isFeatureEnabled("ff_radiology_structured_core")).toBe(false);
    setServerFeatureFlags({ ff_radiology_structured_core: true });
    expect(isFeatureEnabled("ff_radiology_structured_core")).toBe(true);
  });

  it("only accepts ff_radiology_ prefixed keys — never overrides an unrelated flag", () => {
    setServerFeatureFlags({ showMeasurementPanel: true, ff_radiology_render_v2: true });
    // The non-prefixed key must be silently dropped, not applied.
    expect(isFeatureEnabled("showMeasurementPanel")).toBe(false);
    expect(isFeatureEnabled("ff_radiology_render_v2")).toBe(true);
  });

  it("a later call fully replaces the previous overlay (does not merge stale keys)", () => {
    setServerFeatureFlags({ ff_radiology_structured_core: true, ff_radiology_render_v2: true });
    expect(isFeatureEnabled("ff_radiology_render_v2")).toBe(true);

    setServerFeatureFlags({ ff_radiology_structured_core: true }); // render_v2 omitted this time
    // render_v2 must fall back to its default (false), not stay stuck at
    // the previous overlay's value.
    expect(isFeatureEnabled("ff_radiology_render_v2")).toBe(false);
    expect(isFeatureEnabled("ff_radiology_structured_core")).toBe(true);
  });
});

// R1.4 — /radiology/cockpit was the one radiology route missing from
// PERMISSION_ALIASES, so wouter's exact-match ERP_NAV_ORDER entry beat the
// "/radiology" prefix fallback and canAccess() treated it as unrestricted.
describe("canAccess — /radiology/cockpit is gated like every sibling radiology route", () => {
  function sessionWithPermissions(permissions: string[]): StaffSession {
    return {
      token: "t",
      user: {
        id: 1, name: "Front Desk", email: "fd@x.com", role: "receptionist",
        permissions, maxDiscount: null,
      },
    };
  }

  it("a staff member WITHOUT /radiology is denied — same as its sibling routes", () => {
    const session = sessionWithPermissions(["/billing"]);
    expect(canAccess(session, "/radiology/cockpit")).toBe(false);
    expect(canAccess(session, "/radiology/worklist")).toBe(false);
    expect(canAccess(session, "/radiology/reporting-workspace")).toBe(false);
  });

  it("a staff member WITH /radiology is allowed", () => {
    const session = sessionWithPermissions(["/radiology"]);
    expect(canAccess(session, "/radiology/cockpit")).toBe(true);
  });

  it("no session denies /radiology/cockpit (permissioned path, not public)", () => {
    expect(canAccess(null, "/radiology/cockpit")).toBe(false);
  });
});

// R1.4 review finding: RadiologyWorklist's "Report" button gates on
// may("/radiology/report") — the same class of gap /radiology/cockpit had
// above, just on a different literal path string.
describe("canAccess — /radiology/report (the Worklist Report button) is gated like every sibling radiology route", () => {
  function sessionWithPermissions(permissions: string[]): StaffSession {
    return {
      token: "t",
      user: {
        id: 1, name: "Front Desk", email: "fd@x.com", role: "receptionist",
        permissions, maxDiscount: null,
      },
    };
  }

  it("a staff member WITHOUT /radiology is denied", () => {
    const session = sessionWithPermissions(["/billing"]);
    expect(canAccess(session, "/radiology/report")).toBe(false);
  });

  it("a staff member WITH /radiology is allowed", () => {
    const session = sessionWithPermissions(["/radiology"]);
    expect(canAccess(session, "/radiology/report")).toBe(true);
  });

  it("no session denies /radiology/report (permissioned path, not public)", () => {
    expect(canAccess(null, "/radiology/report")).toBe(false);
  });
});
