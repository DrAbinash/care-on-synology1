import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { auditFromRequest } from "../lib/audit";

// Records an account-administration event (create/edit/delete/password reset)
// in the immutable audit trail. The acting user is taken from the staff
// session; the target user is the entity. Fire-and-forget — never blocks or
// fails the request.
function auditAccountAction(
  req: StaffAuthRequest,
  action: string,
  targetUserId: number,
  reason: string,
): void {
  void auditFromRequest(req, {
    userId: req.staffSession?.subjectId ?? null,
    userName: req.staffSession?.subjectName ?? "system",
    role: req.staffSession?.role ?? "system",
    action,
    module: "settings",
    entityType: "user",
    entityId: String(targetUserId),
    reason,
  });
}

const router = Router();

// Defense in depth: this router lives behind requireStaffAuth +
// requireStaffPermission("/settings"), which lets any "admin" / "manager"
// (or anyone manually granted /settings) administer staff. WITHOUT the
// guard below, a /settings-permitted user could PATCH their own row to
// role="super_admin" and silently jump the privilege fence. Only a caller
// whose own session role is super_admin may create, modify, or delete
// super_admin rows, or set any user's role to super_admin.
function blockSuperAdminEscalation(
  req: StaffAuthRequest,
  res: Response,
  opts: { existingRole?: string; nextRole?: string },
): boolean {
  const callerRole = req.staffSession?.role ?? "";
  if (callerRole === "super_admin") return false;
  const touchesSuperAdmin =
    opts.existingRole === "super_admin" || opts.nextRole === "super_admin";
  if (touchesSuperAdmin) {
    res.status(403).json({ error: "Only a super-admin can manage super-admin accounts" });
    return true;
  }
  return false;
}

const ROLES = ["super_admin", "admin", "manager", "accountant", "billing", "lab", "receptionist"];

const ALL_PATHS = ["/", "/patients", "/orders", "/tests", "/billing", "/payments", "/doctors", "/reports", "/report-generator", "/inventory", "/referrals", "/accounting", "/discounts", "/settings", "/register", "/pacs", "/dicom-nodes"];

const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  super_admin: ALL_PATHS,
  admin: ["/", "/patients", "/orders", "/tests", "/billing", "/payments", "/doctors", "/reports", "/report-generator", "/inventory", "/referrals", "/accounting", "/discounts", "/settings", "/register", "/pacs", "/dicom-nodes"],
  manager: ["/", "/patients", "/orders", "/billing", "/payments", "/doctors", "/reports", "/referrals", "/accounting", "/discounts", "/register", "/pacs", "/dicom-nodes"],
  accountant: ["/", "/accounting", "/reports", "/billing", "/payments"],
  // Billing Desk's save flow always does POST /api/orders then POST
  // /api/bills as one action (there's no separate "create order only" step
  // in the UI) — so a role literally named "billing" must include /orders
  // or every save 403s at step one before the bill is ever attempted.
  billing: ["/", "/patients", "/orders", "/billing", "/payments", "/register", "/discounts"],
  lab: ["/orders", "/tests", "/report-generator", "/inventory"],
  // Mirror of the billing-role fix above: receptionist could create an
  // order (has /orders) but then 403'd on the bill step of the same
  // Billing Desk save flow (missing /billing). Front-desk/reception staff
  // are the other role that routinely runs that combined save action.
  receptionist: ["/", "/patients", "/orders", "/billing", "/register"],
};

const BCRYPT_ROUNDS = 12;

function isBcryptHash(value: string): boolean {
  return value.startsWith("$2a$") || value.startsWith("$2b$") || value.startsWith("$2y$");
}

// Normalize username: trim, lowercase. Empty string becomes null so the
// unique index doesn't collide on multiple "" values across legacy rows.
function normUsername(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().toLowerCase();
  return s === "" ? null : s;
}

// Cap the staff portrait to ~800 KB so a careless 5-megapixel selfie
// can't blow up the users JSON payload that the whole ERP fetches.
function validatePhoto(v: unknown): string | null | { error: string } {
  if (v === undefined) return null; // sentinel — caller treats as "not provided"
  if (v === null || v === "") return null;
  const s = String(v);
  if (!s.startsWith("data:image/")) {
    return { error: "photoDataUrl must be a data:image/* URL" };
  }
  if (s.length > 1_100_000) {
    return { error: "Photo too large — please pick an image under 800 KB" };
  }
  return s;
}

// Signature images are simple line-art, so a tighter cap than the staff
// portrait is plenty and keeps every printed bill's payload small.
function validateSignature(v: unknown): string | null | { error: string } {
  if (v === undefined) return null; // sentinel — caller treats as "not provided"
  if (v === null || v === "") return null;
  const s = String(v);
  if (!s.startsWith("data:image/")) {
    return { error: "signatureDataUrl must be a data:image/* URL" };
  }
  if (s.length > 400_000) {
    return { error: "Signature image too large — please pick an image under 300 KB" };
  }
  return s;
}

router.get("/", async (_req, res) => {
  const users = await db.select().from(usersTable).orderBy(usersTable.name);
  // Strip the PIN hash but keep the boolean signal "this user has a PIN"
  // so the UI can show the little Shield icon next to their name.
  res.json(users.map(u => ({ ...u, pin: undefined, hasPin: !!u.pin })));
  return;
});

router.post("/", async (req: StaffAuthRequest, res) => {
  const { name, email, role, permissions, pin, maxDiscount, defaultStartPage } = req.body;
  if (!name || !email || !role) {
    res.status(400).json({ error: "name, email and role are required" });
    return;
  }
  if (blockSuperAdminEscalation(req, res, { nextRole: role })) return;

  const perms = permissions ?? DEFAULT_PERMISSIONS[role] ?? DEFAULT_PERMISSIONS.receptionist;

  // Hash the PIN before storing — never persist plaintext credentials
  let hashedPin: string | null = null;
  if (pin) {
    if (String(pin).length < 4) {
      res.status(400).json({ error: "PIN must be at least 4 characters" });
      return;
    }
    hashedPin = await bcrypt.hash(String(pin), BCRYPT_ROUNDS);
  }

  const username = normUsername(req.body.username);
  const photoCheck = validatePhoto(req.body.photoDataUrl);
  if (photoCheck && typeof photoCheck === "object") {
    res.status(400).json({ error: photoCheck.error });
    return;
  }
  const signatureCheck = validateSignature(req.body.signatureDataUrl);
  if (signatureCheck && typeof signatureCheck === "object") {
    res.status(400).json({ error: signatureCheck.error });
    return;
  }

  try {
    const [user] = await db
      .insert(usersTable)
      .values({
        name,
        email,
        username,
        role,
        permissions: JSON.stringify(perms),
        pin: hashedPin,
        photoDataUrl: photoCheck as string | null,
        signatureDataUrl: signatureCheck as string | null,
        // Force a PIN change on the first successful sign-in whenever an
        // admin assigns the initial PIN.
        mustChangePin: !!hashedPin,
        maxDiscount: maxDiscount != null ? String(maxDiscount) : null,
        defaultStartPage: defaultStartPage || null,
      })
      .returning();
    auditAccountAction(req, "create", user.id, `Created user "${user.name}" (${user.role})`);
    res.status(201).json({ ...user, pin: undefined, hasPin: !!user.pin, maxDiscount: user.maxDiscount != null ? Number(user.maxDiscount) : null });
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? "";
    if (msg.includes("users_username_unique")) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }
    if (msg.includes("users_email_unique")) {
      res.status(409).json({ error: "Email already in use" });
      return;
    }
    throw e;
  }
  return;
});

router.patch("/:id", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  // Look up the existing role so we can also block demoting/editing a
  // super_admin row by a non-super_admin caller.
  const [existing] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (blockSuperAdminEscalation(req, res, { existingRole: existing.role, nextRole: req.body?.role })) return;
  const updates: Record<string, unknown> = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.email !== undefined) updates.email = req.body.email;
  if (req.body.username !== undefined) updates.username = normUsername(req.body.username);
  if (req.body.role !== undefined) updates.role = req.body.role;
  if (req.body.permissions !== undefined) updates.permissions = JSON.stringify(req.body.permissions);
  if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
  if (req.body.maxDiscount !== undefined) updates.maxDiscount = req.body.maxDiscount != null ? String(req.body.maxDiscount) : null;
  if (req.body.defaultStartPage !== undefined) updates.defaultStartPage = req.body.defaultStartPage || null;

  if (req.body.photoDataUrl !== undefined) {
    const photoCheck = validatePhoto(req.body.photoDataUrl);
    if (photoCheck && typeof photoCheck === "object") {
      res.status(400).json({ error: photoCheck.error });
      return;
    }
    updates.photoDataUrl = photoCheck as string | null;
  }

  if (req.body.signatureDataUrl !== undefined) {
    const signatureCheck = validateSignature(req.body.signatureDataUrl);
    if (signatureCheck && typeof signatureCheck === "object") {
      res.status(400).json({ error: signatureCheck.error });
      return;
    }
    updates.signatureDataUrl = signatureCheck as string | null;
  }

  if (req.body.sidebarTheme !== undefined) {
    updates.sidebarTheme = typeof req.body.sidebarTheme === "string" ? req.body.sidebarTheme : null;
  }

  // Hash the PIN before storing when an admin sets/resets it
  if (req.body.pin !== undefined) {
    if (req.body.pin === null || req.body.pin === "") {
      updates.pin = null;
      updates.mustChangePin = false;
    } else {
      const pinStr = String(req.body.pin);
      if (pinStr.length < 4) {
        res.status(400).json({ error: "PIN must be at least 4 characters" });
        return;
      }
      updates.pin = await bcrypt.hash(pinStr, BCRYPT_ROUNDS);
      // Admin resets always force a change on next login
      updates.mustChangePin = true;
    }
  }

  try {
    const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    // Audit the sensitive parts of an account edit: role changes, PIN resets,
    // and activation toggles. These are the fields a security review cares
    // about; cosmetic edits (photo, theme) are intentionally not logged.
    const changed: string[] = [];
    if (req.body.role !== undefined && req.body.role !== existing.role) changed.push(`role → ${req.body.role}`);
    if (req.body.pin !== undefined && req.body.pin !== null && req.body.pin !== "") changed.push("PIN reset");
    if (req.body.isActive !== undefined) changed.push(req.body.isActive ? "activated" : "deactivated");
    if (req.body.permissions !== undefined) changed.push("permissions updated");
    if (changed.length > 0) {
      auditAccountAction(req, req.body.pin ? "password_change" : "edit", user.id, `Edited user "${user.name}": ${changed.join(", ")}`);
    }
    res.json({ ...user, pin: undefined, hasPin: !!user.pin, maxDiscount: user.maxDiscount != null ? Number(user.maxDiscount) : null });
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? "";
    if (msg.includes("users_username_unique")) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }
    if (msg.includes("users_email_unique")) {
      res.status(409).json({ error: "Email already in use" });
      return;
    }
    throw e;
  }
  return;
});

router.patch("/:id/password", async (req, res) => {
  const id = Number(req.params.id);
  const { currentPin, newPin } = req.body;
  if (!currentPin || !newPin) {
    res.status(400).json({ error: "currentPin and newPin are required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!user.pin) {
    res.status(401).json({ error: "Current PIN is incorrect" });
    return;
  }

  // Verify current PIN — support both bcrypt hashes and legacy plaintext
  let currentPinMatches: boolean;
  if (isBcryptHash(user.pin)) {
    currentPinMatches = await bcrypt.compare(String(currentPin), user.pin);
  } else {
    // Legacy plaintext — constant-time compare, then upgrade hash below
    const a = Buffer.from(String(currentPin));
    const b = Buffer.from(user.pin);
    currentPinMatches = a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  if (!currentPinMatches) {
    res.status(401).json({ error: "Current PIN is incorrect" });
    return;
  }

  const newPinStr = String(newPin);
  if (newPinStr.length < 4) {
    res.status(400).json({ error: "New PIN must be at least 4 characters" });
    return;
  }

  const hashed = await bcrypt.hash(newPinStr, BCRYPT_ROUNDS);
  const [updated] = await db.update(usersTable).set({ pin: hashed }).where(eq(usersTable.id, id)).returning();
  auditAccountAction(req as StaffAuthRequest, "password_change", id, `Changed PIN for "${updated.name}"`);
  res.json({ ...updated, pin: undefined, maxDiscount: updated.maxDiscount != null ? Number(updated.maxDiscount) : null });
  return;
});

router.delete("/:id", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select({ role: usersTable.role, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!existing) {
    res.json({ ok: true });
    return;
  }
  if (blockSuperAdminEscalation(req, res, { existingRole: existing.role })) return;
  await db.delete(usersTable).where(eq(usersTable.id, id));
  auditAccountAction(req, "delete", id, `Deleted user "${existing.name}" (${existing.role})`);
  res.json({ ok: true });
  return;
});

router.get("/default-permissions", async (_req, res) => {
  res.json(DEFAULT_PERMISSIONS);
  return;
});

export default router;
