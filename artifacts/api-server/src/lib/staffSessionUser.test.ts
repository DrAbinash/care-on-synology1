import { describe, expect, test, vi, beforeEach } from "vitest";

// The staff-session payload shared by the two login routes (PIN and WebAuthn).
// The WebAuthn route used to return only {id, name, role}, which the ERP's
// readStaffSession() rejects (it requires user.permissions to be an array) and
// which made the portal's finalizeSession() throw on user.email.toLowerCase().
// These tests pin the payload shape and the permission derivation so the two
// routes cannot drift apart again.

let rolePermRows: Array<Record<string, unknown>>;
let updatedPermissions: string | null;

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => rolePermRows }) }),
    update: () => ({
      set: (v: { permissions: string }) => {
        updatedPermissions = v.permissions;
        return { where: async () => undefined };
      },
    }),
  },
}));

vi.mock("@workspace/db/schema", () => ({
  usersTable: { __name: "users", id: "id" },
  rolePermissionsTable: { __name: "role_permissions", role: "role" },
}));

import { buildStaffSessionUser, resolveStaffPermissions, MODULE_TO_PATH } from "./staffSessionUser";

const USER = {
  id: 7,
  name: "Asha Receptionist",
  email: "asha@example.com",
  username: "asha",
  role: "receptionist",
  permissions: null as string | null,
  maxDiscount: "10.00",
  photoDataUrl: null,
  signatureDataUrl: null,
  sidebarTheme: null,
  pacsNetworkProfile: null,
  defaultStartPage: null,
  mustChangePin: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

beforeEach(() => {
  rolePermRows = [];
  updatedPermissions = null;
});

describe("resolveStaffPermissions", () => {
  test("derives module paths plus their legacy piggybacks and persists them", async () => {
    rolePermRows = [{ module: "reports", canView: true }];
    const perms = await resolveStaffPermissions({ ...USER });
    expect(perms).toContain("/reports");
    // Piggybacks that ride along with /reports:
    expect(perms).toEqual(expect.arrayContaining(["/report-generator", "/patient-reports", "/signatures"]));
    expect(JSON.parse(updatedPermissions!)).toEqual(perms);
  });

  test("a module with canView false grants nothing", async () => {
    rolePermRows = [{ module: "reports", canView: false }];
    expect(await resolveStaffPermissions({ ...USER })).toEqual([]);
  });

  test("Form F is its own module — /reports never grants it", async () => {
    rolePermRows = [{ module: "reports", canView: true }];
    expect(await resolveStaffPermissions({ ...USER })).not.toContain("/form-f");

    rolePermRows = [{ module: "form_f", canView: true }];
    expect(await resolveStaffPermissions({ ...USER })).toContain("/form-f");
    expect(MODULE_TO_PATH.form_f).toBe("/form-f");
  });

  test("legacy JSON permissions merge in, and malformed JSON is ignored", async () => {
    rolePermRows = [{ module: "billing", canView: true }];
    const perms = await resolveStaffPermissions({ ...USER, permissions: '["/legacy-page"]' });
    expect(perms).toContain("/billing");
    expect(perms).toContain("/legacy-page");

    // Malformed legacy JSON is ignored — only the derived paths survive
    // (/billing brings its "/" and "/dues" piggybacks with it).
    await expect(resolveStaffPermissions({ ...USER, permissions: "{not json" }))
      .resolves.toEqual(["/billing", "/", "/dues"]);
  });

  test("admins keep only their legacy list and are never written back", async () => {
    rolePermRows = [{ module: "reports", canView: true }];
    const perms = await resolveStaffPermissions({ ...USER, role: "Super Admin", permissions: '["/x"]' });
    expect(perms).toEqual(["/x"]);
    expect(updatedPermissions).toBeNull();
  });
});

describe("buildStaffSessionUser", () => {
  test("returns every field the ERP session needs, with a normalized role", async () => {
    rolePermRows = [{ module: "form_f", canView: true }];
    const payload = await buildStaffSessionUser({ ...USER, role: "owner" });

    // readStaffSession() discards the session unless permissions is an array,
    // and finalizeSession() reads user.email — both must be present.
    expect(Array.isArray(payload.permissions)).toBe(true);
    expect(payload.email).toBe("asha@example.com");
    expect(payload.role).toBe("super_admin"); // owner → super_admin
    expect(payload).toMatchObject({
      id: 7,
      name: "Asha Receptionist",
      username: "asha",
      maxDiscount: "10.00",
      mustChangePin: false,
    });
    for (const key of ["photoDataUrl", "signatureDataUrl", "sidebarTheme", "pacsNetworkProfile", "defaultStartPage"]) {
      expect(payload).toHaveProperty(key);
    }
  });

  test("a missing e-mail becomes null rather than undefined", async () => {
    const payload = await buildStaffSessionUser({ ...USER, email: null });
    expect(payload.email).toBeNull();
  });
});
