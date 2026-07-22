import { describe, it, expect } from "vitest";
import { isSessionDeadMessage } from "./fetchApi";

// Regression coverage for the stale-tab bug: a leftover token in localStorage
// passes the client-side route guard, so the ERP renders its authenticated
// shell; the first authenticated request the page fires then comes back 401
// with a "session is dead" body. fetchApi must recognise that body on ANY
// endpoint (not just the session-auth allowlist) so it can clear the session
// and redirect to the login page instead of leaving the stale shell up with an
// inline "please log in again" error.
//
// Runs under vitest's node environment (no jsdom) — isSessionDeadMessage is a
// pure string matcher with no window/localStorage dependency.
describe("isSessionDeadMessage", () => {
  it("matches the exact server messages that mean the session is dead", () => {
    expect(isSessionDeadMessage("Invalid or expired staff session. Please log in again.")).toBe(true);
    expect(isSessionDeadMessage("Session expired due to inactivity. Please log in again.")).toBe(true);
    expect(isSessionDeadMessage("Staff account is inactive or no longer exists. Please contact an administrator.")).toBe(true);
  });

  it("is case-insensitive and tolerates surrounding text", () => {
    expect(isSessionDeadMessage("INVALID OR EXPIRED STAFF SESSION")).toBe(true);
    expect(isSessionDeadMessage("Error: session expired due to inactivity now")).toBe(true);
  });

  it("does NOT match permission / auth-layer-mismatch errors (session must survive)", () => {
    // A 403 permission error or a mismatched-middleware 401 must not log the
    // user out — these are the cases the original path allowlist protected.
    expect(isSessionDeadMessage("Access denied: you do not have permission to access this module.")).toBe(false);
    expect(isSessionDeadMessage("Staff authentication required")).toBe(false);
    expect(isSessionDeadMessage("Access denied: you do not have permission to perform 'edit' on this resource.")).toBe(false);
  });

  it("returns false for empty / missing messages", () => {
    expect(isSessionDeadMessage("")).toBe(false);
    expect(isSessionDeadMessage(null)).toBe(false);
    expect(isSessionDeadMessage(undefined)).toBe(false);
  });
});
