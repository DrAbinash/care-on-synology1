import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Expense creator/approver separation — admin-toggleable.
//
// approvedBy has always been free text set at expense-creation time, with no
// record of who actually created the row. This adds:
//   - expenses.created_by, session-derived (never client-editable), so there is
//     something to compare an approver against.
//   - clinic_settings.expense_self_approval_allowed, an admin-configurable
//     toggle. Default TRUE — self-approval allowed — matches TODAY'S real
//     behaviour exactly, per explicit product direction ("for the time being
//     let the approver be the creator... make it a toggle in admin settings").
//     Only when an admin flips it off is approver == creator rejected.
//
// Source-contract style (no DB): pins that createdBy is session-derived on
// create, that both create and edit paths enforce the toggle when it is off,
// and that the clinic-settings route/schema actually expose the toggle rather
// than it being a column nobody can flip.

const __dirname = dirname(fileURLToPath(import.meta.url));
const expenses = readFileSync(join(__dirname, "expenses.ts"), "utf8");
const clinicSettingsRoute = readFileSync(join(__dirname, "clinicSettings.ts"), "utf8");
const clinicSettingsSchema = readFileSync(
  join(__dirname, "..", "..", "..", "..", "lib", "db", "src", "schema", "clinicSettings.ts"),
  "utf8",
);
const expensesSchema = readFileSync(
  join(__dirname, "..", "..", "..", "..", "lib", "db", "src", "schema", "expenses.ts"),
  "utf8",
);

describe("expenses.created_by — session-derived, never client-editable", () => {
  test("the column exists on the expenses table", () => {
    expect(expensesSchema).toContain('createdBy: text("created_by")');
  });

  test("create derives it from the authenticated session", () => {
    expect(expenses).toContain(
      'const createdBy = (req as StaffAuthRequest).staffSession?.subjectName?.trim() || null;',
    );
    expect(expenses).toContain("createdBy,");
  });
});

describe("clinic_settings.expense_self_approval_allowed — admin toggle", () => {
  test("the column exists, defaulting to TRUE (today's real behaviour)", () => {
    expect(clinicSettingsSchema).toContain(
      'expenseSelfApprovalAllowed: boolean("expense_self_approval_allowed").notNull().default(true)',
    );
  });

  test("PUT /clinic-settings actually accepts it (not a dead column)", () => {
    expect(clinicSettingsRoute).toContain('"expenseSelfApprovalAllowed"');
  });

  test("GET fallback (pre-migration safety path) also defaults it true", () => {
    expect(clinicSettingsRoute).toContain("expenseSelfApprovalAllowed: true,");
  });
});

describe("expenses.ts enforces the toggle on both create and edit", () => {
  test("a helper reads the toggle with a fail-open default matching the column default", () => {
    expect(expenses).toContain("async function isSelfApprovalAllowed(): Promise<boolean>");
    expect(expenses).toContain("return row?.v ?? true;");
  });

  test("create rejects self-approval only when the toggle is off", () => {
    expect(expenses).toContain(
      "if (approvedBy && !(await isSelfApprovalAllowed()) && sameActor(approvedBy, createdBy)) {",
    );
  });

  test("edit rejects self-approval against the expense's EXISTING createdBy, not the editor's own session", () => {
    // Deliberately compares against `before.createdBy` — the actor who created
    // THIS expense — not the session making the edit, since an edit can be made
    // by a third party correcting the approver field.
    expect(expenses).toContain("sameActor(updates.approvedBy, before.createdBy)");
  });

  test("both checks return the same rejection shape", () => {
    const rejections = expenses.match(/Self-approval is currently disabled\./g) ?? [];
    expect(rejections.length).toBe(2);
  });
});

describe("sameActor comparison is case/whitespace-insensitive but never matches blank", () => {
  test("the helper trims and lowercases before comparing", () => {
    expect(expenses).toContain("an.length > 0 && an === bn");
  });
});
