import { describe, it, expect } from "vitest";
import {
  buildPaletteView, flattenSections, pushRecent, toggleFavourite,
  scoreItem, matchScore, type PaletteItem, type RankContext,
} from "./commandPalette";

const item = (id: string, kind: PaletteItem["kind"], title: string, extra: Partial<PaletteItem> = {}): PaletteItem =>
  ({ id, kind, title, ...extra });

const ITEMS: PaletteItem[] = [
  item("finding:1", "finding", "L4-L5 Disc Bulge", { favouritable: true, keywords: "LS Spine" }),
  item("finding:2", "finding", "L5-S1 Disc Bulge", { favouritable: true, keywords: "LS Spine" }),
  item("finding:3", "finding", "Cervical Disc Bulge", { favouritable: true, keywords: "Cervical" }),
  item("finding:4", "finding", "Fazekas Grade 1", { favouritable: true }),
  item("protocol:10", "protocol", "MRI Brain Stroke", { favouritable: true, keywords: "Brain" }),
  item("template:20", "template", "MRI Brain Routine", { favouritable: true, keywords: "Brain" }),
  item("history:30", "history", "Headache", {}),
  item("command:generate-impression", "command", "Generate Impression", {}),
  item("command:clear-findings", "command", "Clear Findings", {}),
  item("setting:qs", "setting", "Open Settings", {}),
];

const ctx = (over: Partial<RankContext> = {}): RankContext =>
  ({ query: "", recent: [], favourites: new Set(), ...over });

describe("matchScore / scoreItem", () => {
  it("ranks exact > prefix > word-boundary > substring > keyword", () => {
    expect(matchScore(item("x", "finding", "Disc Bulge"), "disc bulge")).toBe(50);
    expect(matchScore(item("x", "finding", "Disc Bulge"), "disc")).toBe(40);
    expect(matchScore(item("x", "finding", "L4-L5 Disc Bulge"), "disc")).toBe(30);
    expect(matchScore(item("x", "finding", "Subdiscal"), "disc")).toBe(20);
    expect(matchScore(item("x", "finding", "Nothing", { keywords: "spine disc" }), "disc")).toBe(10);
    expect(matchScore(item("x", "finding", "Nothing"), "disc")).toBe(-1);
  });

  it("recent outranks favourite outranks a plain match", () => {
    const q = "disc";
    const recent = scoreItem(ITEMS[0], ctx({ query: q, recent: ["finding:1"] }), q);
    const fav = scoreItem(ITEMS[1], ctx({ query: q, favourites: new Set(["finding:2"]) }), q);
    const plain = scoreItem(ITEMS[2], ctx({ query: q }), q);
    expect(recent).toBeGreaterThan(fav);
    expect(fav).toBeGreaterThan(plain);
  });
});

describe("buildPaletteView — search", () => {
  it("returns only matches, grouped by kind with the best group first", () => {
    const sections = buildPaletteView(ITEMS, ctx({ query: "Disc Bulge" }));
    expect(sections[0].label).toBe("Quick Findings");
    // All three match "disc bulge" at a word boundary equally, so the tie-break
    // is alphabetical (deterministic).
    expect(sections[0].items.map((i) => i.title)).toEqual([
      "Cervical Disc Bulge", "L4-L5 Disc Bulge", "L5-S1 Disc Bulge",
    ]);
    // No non-matching kinds leak in.
    expect(sections.some((s) => s.items.some((i) => i.title === "Headache"))).toBe(false);
  });

  it("floats a favourited match to the top of its group", () => {
    const sections = buildPaletteView(ITEMS, ctx({ query: "disc", favourites: new Set(["finding:3"]) }));
    expect(sections[0].items[0].title).toBe("Cervical Disc Bulge");
  });

  it("matches on keywords (Brain surfaces protocol + template)", () => {
    const titles = flattenSections(buildPaletteView(ITEMS, ctx({ query: "brain" }))).map((i) => i.title);
    expect(titles).toContain("MRI Brain Stroke");
    expect(titles).toContain("MRI Brain Routine");
  });

  it("caps each section to perSection", () => {
    const many = Array.from({ length: 20 }, (_, i) => item(`finding:${i}`, "finding", `Disc Variant ${i}`));
    const sections = buildPaletteView(many, ctx({ query: "disc" }), { perSection: 5 });
    expect(sections[0].items).toHaveLength(5);
  });
});

describe("buildPaletteView — empty query (landing view)", () => {
  it("shows Recent, then Favourites, then Commands — no full catalog", () => {
    const sections = buildPaletteView(ITEMS, ctx({
      recent: ["protocol:10", "finding:4"],
      favourites: new Set(["finding:1"]),
    }));
    expect(sections.map((s) => s.label)).toEqual(["Recent", "Favourites", "Commands"]);
    expect(sections[0].items.map((i) => i.id)).toEqual(["protocol:10", "finding:4"]);
    // Favourite already shown in Recent is not duplicated.
    expect(sections[1].items.map((i) => i.id)).toEqual(["finding:1"]);
    expect(sections[2].items.every((i) => i.kind === "command")).toBe(true);
  });

  it("omits empty sections and respects the recent cap", () => {
    const recent = Array.from({ length: 15 }, (_, i) => `finding:${i}`);
    const many = recent.map((id, i) => item(id, "finding", `F${i}`));
    const sections = buildPaletteView(many, ctx({ recent }), { recentLimit: 10 });
    expect(sections[0].items).toHaveLength(10);
    expect(sections.some((s) => s.label === "Favourites")).toBe(false);
  });
});

describe("pushRecent / toggleFavourite", () => {
  it("pushRecent moves to front, de-dupes, and caps", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent(["a", "b"], "c")).toEqual(["c", "a", "b"]);
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
  it("toggleFavourite adds then removes", () => {
    expect(toggleFavourite([], "x")).toEqual(["x"]);
    expect(toggleFavourite(["x", "y"], "x")).toEqual(["y"]);
  });
});
