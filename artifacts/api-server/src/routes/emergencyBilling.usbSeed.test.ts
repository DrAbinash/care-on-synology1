import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
}));
vi.mock("@workspace/db/schema", () => ({
  portalSessionsTable: {},
  usersTable: {},
  clinicSettingsTable: {},
}));

const { requireSuperAdminRole } = await import("../middleware/requireStaffAuth");
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

function call(role: string | undefined) {
  const req = { staffSession: role ? { role } : undefined } as StaffAuthRequest;
  let status = 200;
  let body: unknown;
  const res = {
    status(code: number) { status = code; return this; },
    json(payload: unknown) { body = payload; return this; },
  };
  let next = false;
  requireSuperAdminRole(req, res as never, () => { next = true; });
  return { status, body, next };
}

describe("requireSuperAdminRole", () => {
  it("allows super_admin staff sessions", () => {
    expect(call("super_admin")).toEqual({ status: 200, body: undefined, next: true });
  });

  it("rejects regular admin (USB seed is super-admin login only)", () => {
    const r = call("admin");
    expect(r.next).toBe(false);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: "Super admin login required" });
  });

  it("rejects missing session", () => {
    const r = call(undefined);
    expect(r.next).toBe(false);
    expect(r.status).toBe(401);
  });
});

describe("GET /usb-seed wiring", () => {
  it("mounts requireSuperAdminRole on the USB seed download", () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "emergencyBilling.ts"),
      "utf8",
    );
    expect(src).toMatch(/get\(\s*"\/usb-seed"\s*,\s*requireSuperAdminRole/);
  });
});
