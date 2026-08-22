import { describe, expect, it } from "vitest";
import {
  GLOBAL_COMMANDS,
  commandSearchValue,
  filterGlobalCommands,
} from "./globalCommandCatalog";

describe("globalCommandCatalog", () => {
  it("includes Report Style under radiology settings", () => {
    const style = GLOBAL_COMMANDS.find((a) => a.id === "radiology-tab-style");
    expect(style).toBeDefined();
    expect(style?.path).toBe("/settings/radiology?tab=style");
    expect(commandSearchValue(style!)).toMatch(/report style/i);
  });

  it("finds Report Style when searching partial terms", () => {
    const hits = filterGlobalCommands("report style");
    expect(hits.some((a) => a.id === "radiology-tab-style")).toBe(true);
  });

  it("finds billing print settings by layout keywords", () => {
    const hits = filterGlobalCommands("bill format");
    expect(hits.some((a) => a.id === "settings-tab-billing-print")).toBe(true);
  });

  it("finds letterhead via report style keywords", () => {
    const hits = filterGlobalCommands("letterhead");
    expect(hits.some((a) => a.id === "radiology-tab-style")).toBe(true);
  });

  it("exposes a broad catalog beyond core nav pages", () => {
    expect(GLOBAL_COMMANDS.length).toBeGreaterThan(50);
  });
});
