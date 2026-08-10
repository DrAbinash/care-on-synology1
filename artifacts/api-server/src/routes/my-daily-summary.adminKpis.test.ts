import { describe, expect, test, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() } }));
vi.mock("../email", () => ({ getTransporter: vi.fn(), getEmailSettings: vi.fn() }));
vi.mock("../lib/pacs/billingVsPacsSummary", () => ({ buildBillingVsPacsSummary: vi.fn() }));
vi.mock("../lib/pacs/modalityBillingSummary", () => ({
  buildModalityBillingSummary: vi.fn(),
  listModalityBills: vi.fn(),
}));
vi.mock("../lib/inventoryLowStockSummary", () => ({ buildLowStockSummary: vi.fn() }));

import { myDailySummaryRouter } from "./my-daily-summary";
import { requireAdminRole } from "../middleware/requireStaffAuth";

function routeStack(path: string, method: "get" | "post" = "get") {
  // Express 5 typings omit Route.methods; runtime still has it (same pattern as featureFlags.test).
  const layer = myDailySummaryRouter.stack.find((l) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const route = (l as any).route;
    return route && route.path === path && !!route.methods?.[method];
  });
  expect(layer?.route, `route ${method.toUpperCase()} ${path}`).toBeTruthy();
  return layer!.route!.stack;
}

describe("My Daily Summary clinic-wide KPIs — admin gate", () => {
  test.each([
    "/billing-vs-pacs",
    "/modality-billing",
    "/modality-bills",
    "/low-stock",
  ])("%s is wired [requireAdminRole, handler]", (path) => {
    const stack = routeStack(path);
    expect(stack).toHaveLength(2);
    expect(stack[0].handle).toBe(requireAdminRole);
  });
});
