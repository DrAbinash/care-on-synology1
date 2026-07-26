import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { canAccess, PERMISSIONED_PATHS } from "../lib/staffSession";
import type { StaffSession } from "../lib/staffSession";

// The new-DICOM-study poller in Layout.tsx hit /api/dicom-studies/new every 30s
// for EVERY logged-in staff user, but the server mounts that router behind
// requireStaffPermission("/dicom-nodes"). Any user without the permission took
// a 403 on every poll, forever. The poller's `catch {}` swallowed it, so the
// only evidence was a steady stream of 403s in the nginx access log.
//
// A second, separate bug made it worse: the effect depended on `session`, and
// readStaffSession() JSON.parses localStorage — a NEW object identity on every
// render. So the effect re-ran on every render, each time firing an immediate
// poll and rebuilding the interval. Production logs show five requests inside
// three seconds where a 30s interval should produce one.

const __dirname = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(join(__dirname, "Layout.tsx"), "utf8");

/** Layout.tsx documents the bug it fixes, so absence checks must skip comments. */
const layoutCode = layout
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"))
  .join("\n");

function sessionWith(role: string, permissions: string[]): StaffSession {
  return { user: { id: 1, role, permissions } } as unknown as StaffSession;
}

describe("the client's permission check matches the server's", () => {
  test('"/dicom-studies" resolves to the "/dicom-nodes" permission the server enforces', () => {
    // routes/index.ts mounts:
    //   router.use("/dicom-studies", requireStaffAuth,
    //              requireStaffPermission("/dicom-nodes"), dicomStudyManagerRouter)
    //
    // PERMISSION_ALIASES is module-private, so assert the alias through the
    // public contract instead of exporting the constant for a test. Holding
    // "/dicom-nodes" must grant "/dicom-studies", while holding the literal
    // "/dicom-studies" string must NOT — which is only true if the alias
    // resolves to /dicom-nodes rather than to itself.
    expect(PERMISSIONED_PATHS.has("/dicom-nodes")).toBe(true);
    expect(canAccess(sessionWith("technician", ["/dicom-nodes"]), "/dicom-studies")).toBe(true);
    expect(canAccess(sessionWith("technician", ["/dicom-studies"]), "/dicom-studies")).toBe(false);
  });

  test("a staff user without the permission is denied — this is the 403 case", () => {
    const receptionist = sessionWith("receptionist", ["/billing", "/patients"]);
    expect(canAccess(receptionist, "/dicom-studies")).toBe(false);
  });

  test("a user holding /dicom-nodes is allowed", () => {
    expect(canAccess(sessionWith("technician", ["/dicom-nodes"]), "/dicom-studies")).toBe(true);
  });

  test("a sub-permission on /dicom-nodes also grants it", () => {
    expect(canAccess(sessionWith("technician", ["/dicom-nodes:view"]), "/dicom-studies")).toBe(true);
  });

  test("a full-access role is allowed without an explicit grant", () => {
    expect(canAccess(sessionWith("admin", []), "/dicom-studies")).toBe(true);
  });

  test("no session is denied", () => {
    expect(canAccess(null, "/dicom-studies")).toBe(false);
  });
});

describe("Layout.tsx gates the poll and depends on stable values", () => {
  test("the poll is gated on the permission", () => {
    expect(layoutCode).toContain('const canSeeNewStudies = canAccess(session, "/dicom-studies")');
    expect(layoutCode).toMatch(/if \(!sessionUserId \|\| !canSeeNewStudies\) return;/);
  });

  test("the effect no longer depends on the unstable session object", () => {
    // `session` is a fresh object each render, so [session] re-ran the effect
    // constantly. Depending on the id + the boolean makes it stable.
    expect(layoutCode).toContain("}, [sessionUserId, canSeeNewStudies]);");
    expect(layoutCode, "the old unstable dependency must be gone").not.toMatch(
      /\/api\/dicom-studies\/new[\s\S]{0,1200}?\}, \[session\]\);/,
    );
  });

  test("the endpoint and its 30s cadence are otherwise unchanged", () => {
    // The fix is who polls and how often the effect re-arms — not what it calls.
    expect(layoutCode).toContain("/api/dicom-studies/new?since=");
    expect(layoutCode).toContain("30_000");
  });
});
