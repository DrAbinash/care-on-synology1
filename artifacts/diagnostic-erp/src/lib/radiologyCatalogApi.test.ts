import { describe, it, expect } from "vitest";
import { catalogStatusBadgeClass } from "./radiologyCatalogShared";

describe("radiologyCatalogApi", () => {
  it("maps catalog status to badge classes", () => {
    expect(catalogStatusBadgeClass("active")).toContain("emerald");
    expect(catalogStatusBadgeClass("draft")).toContain("amber");
    expect(catalogStatusBadgeClass("deprecated")).toContain("muted");
  });
});
