import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { testTokensTable, patientsTable, testsTable, clinicSettingsTable } from "@workspace/db/schema";
import { and, asc, desc, eq, isNull, or, sql, inArray } from "drizzle-orm";
import { requireStaffAuth } from "../middleware/requireStaffAuth";

// Staff-authenticated display feed for waiting-room LCDs.
export const displayRouter: IRouter = Router();

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

displayRouter.get("/queue", requireStaffAuth, async (req, res): Promise<void> => {
  const raw = req.query.ledgerId;
  const ledgerId = Number(raw);
  if (raw === undefined || raw === "" || !Number.isInteger(ledgerId) || ledgerId <= 0) {
    res.status(400).json({
      error: "Invalid request",
      details: [{ path: ["ledgerId"], message: "ledgerId is required and must be a positive integer" }],
    });
    return;
  }
  const date = (req.query.date as string) || todayISO();
  const departmentsRaw = (req.query.departments as string) || "";
  const departments = departmentsRaw.split(",").map((s) => s.trim()).filter(Boolean);

  const [settings] = await db.select().from(clinicSettingsTable).limit(1);
  const privacyMode = settings?.queuePrivacyMode || "masked";

  const conds = [
    eq(testTokensTable.tokenDate, date),
    inArray(testTokensTable.status, ["waiting", "serving"]),
    ledgerId === 1
      ? or(eq(testTokensTable.ledgerId, 1), isNull(testTokensTable.ledgerId))
      : eq(testTokensTable.ledgerId, ledgerId),
  ];
  if (departments.length > 0) conds.push(inArray(testTokensTable.department, departments));

  const rows = await db
    .select({
      id: testTokensTable.id,
      tokenNo: testTokensTable.tokenNo,
      status: testTokensTable.status,
      priority: testTokensTable.priority,
      department: testTokensTable.department,
      roomNumber: testTokensTable.roomNumber,
      firstName: patientsTable.firstName,
      lastName: patientsTable.lastName,
      testName: testsTable.name,
      calledAt: testTokensTable.calledAt,
    })
    .from(testTokensTable)
    .leftJoin(patientsTable, eq(patientsTable.id, testTokensTable.patientId))
    .leftJoin(testsTable, eq(testsTable.id, testTokensTable.testId))
    .where(and(...conds))
    .orderBy(desc(testTokensTable.priority), asc(testTokensTable.tokenNo))
    .limit(200);

  const mappedRows = rows.map((r) => {
    let patientLabel = "";
    if (privacyMode === "none") {
      patientLabel = `${r.firstName || ""} ${r.lastName || ""}`.trim();
    } else if (privacyMode === "masked") {
      const maskWord = (w: string) => {
        if (!w) return "";
        if (w.length <= 2) return w[0] + "*".repeat(w.length - 1);
        return w[0] + "*".repeat(w.length - 2) + w[w.length - 1];
      };
      patientLabel = `${maskWord(r.firstName || "")} ${maskWord(r.lastName || "")}`.trim();
    } else { // "token_only"
      patientLabel = `Patient #${r.tokenNo}`;
    }

    return {
      id: r.id,
      tokenNo: r.tokenNo,
      status: r.status,
      priority: r.priority,
      department: r.department,
      roomNumber: r.roomNumber,
      patientLabel,
      testName: r.testName,
      calledAt: r.calledAt,
    };
  });

  // Group by department for the display UI.
  const byDept: Record<string, typeof mappedRows> = {};
  for (const r of mappedRows) {
    (byDept[r.department] ??= []).push(r);
  }
  res.json({
    date,
    departments: Object.entries(byDept).map(([department, tokens]) => {
      const serving = tokens.find((t) => t.status === "serving");
      const waiting = tokens.filter((t) => t.status === "waiting");
      return {
        department,
        roomNumber: tokens[0]?.roomNumber ?? "",
        nowServing: serving ?? null,
        waiting: waiting.slice(0, 8),
        waitingCount: waiting.length,
      };
    }).sort((a, b) => a.department.localeCompare(b.department)),
  });
});

export default displayRouter;
