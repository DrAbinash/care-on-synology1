import { describe, it, expect } from "vitest";
import {
  parseVoiceTranscript, normalizeTranscript, normalizeDictationText,
  describeIntent, describeVoiceGrammar, LOW_CONFIDENCE_THRESHOLD,
  type VoiceWorkflowCommand,
} from "./voiceCommandGrammar";

// Ticket M1.6B2 Phase 4/7 — the deterministic voice grammar. Strict allowlist:
// every supported phrase parses to a typed intent; everything else is
// AMBIGUOUS (with alternatives, executing nothing) or UNRECOGNIZED.

const intentOf = (raw: string) => parseVoiceTranscript(raw).intent;
const bandOf = (raw: string) => parseVoiceTranscript(raw).confidenceBand;

describe("normalization", () => {
  it("case, whitespace, terminal punctuation and politeness fillers only", () => {
    expect(normalizeTranscript("  Please SAVE Draft.  ")).toBe("save draft");
    expect(normalizeTranscript("Okay next study!")).toBe("next study");
    expect(normalizeTranscript("finalize,")).toBe("finalize");
  });

  it("dictation normalization: spoken punctuation, conservative casing", () => {
    expect(normalizeDictationText("small disc bulge at l4 l5 full stop", { autoPunctuation: true }))
      .toBe("Small disc bulge at l4 l5.");
    expect(normalizeDictationText("no acute infarct comma no bleed", { autoPunctuation: true }))
      .toBe("No acute infarct, no bleed.");
    expect(normalizeDictationText("first line new line second line", { autoPunctuation: false }))
      .toBe("first line\nsecond line");
    // never invents a period when off; never touches clinical words
    expect(normalizeDictationText("hyperintense lesion", { autoPunctuation: false })).toBe("hyperintense lesion");
  });
});

describe("workflow commands — every command + synonyms", () => {
  const cases: Array<[string, VoiceWorkflowCommand]> = [
    ["open study", "open-viewer"], ["open viewer", "open-viewer"], ["launch viewer", "open-viewer"], ["open the images", "open-viewer"],
    ["save", "save"], ["save draft", "save"], ["save the report", "save"],
    ["finalize", "finalize"], ["finalize report", "finalize"], ["sign report", "finalize"], ["sign off", "finalize"], ["finalise the report", "finalize"],
    ["verify", "verify"], ["verify report", "verify"], ["countersign", "verify"],
    ["next study", "next"], ["next", "next"], ["next patient", "next"],
    ["previous study", "previous"], ["previous", "previous"], ["go back", "previous"], ["last study", "previous"],
    ["park study", "park"], ["park", "park"], ["skip study", "park"],
    ["unpark study", "unpark"], ["unpark", "unpark"], ["resume parked", "unpark"],
    ["refresh queue", "refresh"], ["refresh", "refresh"], ["reload queue", "refresh"],
    ["reload current", "reload-current"], ["reload this study", "reload-current"], ["reload", "reload-current"],
    ["focus findings", "focus-findings"], ["go to findings", "focus-findings"],
    ["focus impression", "focus-impression"], ["go to impression", "focus-impression"],
    ["focus quick search", "focus-quick-search"], ["quick search", "focus-quick-search"], ["search", "focus-quick-search"], ["open search", "focus-quick-search"],
    ["close panel", "close-panel"], ["close preview", "close-panel"], ["close", "close-panel"],
  ];
  it.each(cases)('"%s" → %s (CLEAR)', (phrase, command) => {
    const parse = parseVoiceTranscript(phrase);
    expect(parse.confidenceBand).toBe("CLEAR");
    expect(parse.intent).toEqual(expect.objectContaining({ type: "workflow", command }));
  });

  it("park captures an optional spoken reason", () => {
    const parse = parseVoiceTranscript("park study waiting for prior imaging");
    expect(parse.intent).toEqual({ type: "workflow", command: "park", reason: "waiting for prior imaging" });
    expect(parse.parameters.reason).toBe("waiting for prior imaging");
    expect(intentOf("park study")).toEqual({ type: "workflow", command: "park", reason: undefined });
  });

  it("cancel vocabulary", () => {
    for (const phrase of ["cancel", "never mind", "dismiss", "stop listening"]) {
      expect(intentOf(phrase)).toEqual({ type: "cancel" });
    }
  });
});

describe("text-entry commands", () => {
  it("add/append finding → findings append with the text parameter", () => {
    expect(intentOf("add finding small pleural effusion")).toEqual(
      { type: "dictate", target: "findings", mode: "append", text: "small pleural effusion" });
    expect(intentOf("append findings trace free fluid")).toEqual(
      { type: "dictate", target: "findings", mode: "append", text: "trace free fluid" });
  });

  it("replace findings/impression need the explicit 'replace … with' form", () => {
    expect(intentOf("replace findings with normal study")).toEqual(
      { type: "dictate", target: "findings", mode: "replace", text: "normal study" });
    expect(intentOf("replace impression with no acute abnormality")).toEqual(
      { type: "dictate", target: "impression", mode: "replace", text: "no acute abnormality" });
  });

  it("impression / append impression / add recommendation", () => {
    expect(intentOf("impression no acute infarct")).toEqual(
      { type: "dictate", target: "impression", mode: "append", text: "no acute infarct" });
    expect(intentOf("append impression stable appearance")).toEqual(
      { type: "dictate", target: "impression", mode: "append", text: "stable appearance" });
    expect(intentOf("add recommendation clinical correlation")).toEqual(
      { type: "dictate", target: "recommendation", mode: "append", text: "clinical correlation" });
    expect(intentOf("recommendation follow up in six weeks")).toEqual(
      { type: "dictate", target: "recommendation", mode: "append", text: "follow up in six weeks" });
  });
});

describe("quick select commands", () => {
  it("search / select / remove finding with term extraction", () => {
    expect(intentOf("search finding disc bulge")).toEqual({ type: "quick-select", action: "search", term: "disc bulge" });
    expect(intentOf("select finding disc bulge")).toEqual({ type: "quick-select", action: "select", term: "disc bulge" });
    expect(intentOf("remove finding disc bulge")).toEqual({ type: "quick-select", action: "remove", term: "disc bulge" });
    expect(intentOf("deselect finding disc bulge")).toEqual({ type: "quick-select", action: "remove", term: "disc bulge" });
  });

  it("laterality/severity/level modifiers with validated values", () => {
    expect(intentOf("laterality left")).toEqual({ type: "quick-modifier", property: "side", value: "left" });
    expect(intentOf("bilateral")).toEqual({ type: "quick-modifier", property: "side", value: "bilateral" });
    expect(intentOf("severity moderate")).toEqual({ type: "quick-modifier", property: "severity", value: "moderate" });
    expect(intentOf("level l4 l5")).toEqual({ type: "quick-modifier", property: "level", value: "l4 l5" });
    expect(intentOf("location hepatic dome")).toEqual({ type: "quick-modifier", property: "level", value: "hepatic dome" });
  });

  it("invalid enumerated values become AMBIGUOUS with the valid options — never executed", () => {
    const sev = parseVoiceTranscript("severity gigantic");
    expect(sev.intent).toBeNull();
    expect(sev.confidenceBand).toBe("AMBIGUOUS");
    expect(sev.alternatives).toEqual(["severity mild", "severity moderate", "severity severe"]);
    const side = parseVoiceTranscript("laterality upwards");
    expect(side.intent).toBeNull();
    expect(side.alternatives).toContain("laterality left");
  });
});

describe("viewer commands — real vs truthfully unsupported", () => {
  it("supported: frame navigation, zoom, reset", () => {
    expect(intentOf("next image")).toEqual({ type: "viewer", op: "next-image" });
    expect(intentOf("previous slice")).toEqual({ type: "viewer", op: "previous-image" });
    expect(intentOf("zoom in")).toEqual({ type: "viewer", op: "zoom-in" });
    expect(intentOf("zoom out")).toEqual({ type: "viewer", op: "zoom-out" });
    expect(intentOf("reset view")).toEqual({ type: "viewer", op: "reset-view" });
  });

  it("recognized but unsupported: window presets, pan, measurements", () => {
    expect(intentOf("window brain")).toEqual({ type: "viewer-unsupported", capability: 'window preset "brain"' });
    expect(intentOf("window bone")).toEqual({ type: "viewer-unsupported", capability: 'window preset "bone"' });
    expect(intentOf("pan left")).toEqual({ type: "viewer-unsupported", capability: "voice-driven pan" });
    expect(intentOf("length measurement")).toEqual({ type: "viewer-unsupported", capability: "measurements" });
  });

  it('"next image" is viewer, bare "next" is workflow — no ambiguity', () => {
    expect(intentOf("next image")?.type).toBe("viewer");
    expect(intentOf("next")).toEqual(expect.objectContaining({ type: "workflow", command: "next" }));
  });
});

describe("ambiguity + unrecognized (Phase 7)", () => {
  it('verb-less "finding <term>" offers select/add/search and executes nothing', () => {
    const parse = parseVoiceTranscript("finding pleural effusion");
    expect(parse.intent).toBeNull();
    expect(parse.confidenceBand).toBe("AMBIGUOUS");
    expect(parse.alternatives).toEqual([
      "select finding pleural effusion",
      "add finding pleural effusion",
      "search finding pleural effusion",
    ]);
  });

  it("unmatched input is UNRECOGNIZED with a help hint", () => {
    const parse = parseVoiceTranscript("make me a sandwich");
    expect(parse.intent).toBeNull();
    expect(parse.confidenceBand).toBe("UNRECOGNIZED");
    expect(parse.parseErrors[0]).toContain("No matching command");
    expect(parse.alternatives.length).toBeGreaterThan(0);
  });

  it("empty transcript is UNRECOGNIZED", () => {
    expect(bandOf("")).toBe("UNRECOGNIZED");
    expect(bandOf("   ")).toBe("UNRECOGNIZED");
  });

  it("low provider confidence demotes a CLEAR match to AMBIGUOUS (never a fake percentage)", () => {
    const low = parseVoiceTranscript("save draft", { providerConfidence: LOW_CONFIDENCE_THRESHOLD - 0.1 });
    expect(low.confidenceBand).toBe("AMBIGUOUS");
    expect(low.intent).toEqual(expect.objectContaining({ type: "workflow", command: "save" }));
    expect(low.parseErrors[0]).toMatch(/low speech-engine confidence/i);
    const high = parseVoiceTranscript("save draft", { providerConfidence: 0.92 });
    expect(high.confidenceBand).toBe("CLEAR");
    const none = parseVoiceTranscript("save draft", { providerConfidence: null });
    expect(none.confidenceBand).toBe("CLEAR");
  });
});

describe("no arbitrary intent injection — strict allowlist", () => {
  it.each([
    "constructor", "__proto__", "eval save", "save; rm -rf /",
    "execute shell command", "drop table reports", "dispatch self-destruct",
  ])('"%s" never becomes an executable intent', (raw) => {
    const parse = parseVoiceTranscript(raw);
    expect(parse.intent).toBeNull();
    expect(parse.confidenceBand).not.toBe("CLEAR");
  });

  it("hostile text stays inert as a dictation PARAMETER (plain string, typed target)", () => {
    const parse = parseVoiceTranscript("add finding <script>alert(1)</script>");
    expect(parse.intent).toEqual(expect.objectContaining({ type: "dictate", target: "findings", mode: "append" }));
    // the payload rides only in the typed text field — nothing else to run
    expect(Object.keys(parse.parameters)).toEqual(["text"]);
  });
});

describe("descriptions + help", () => {
  it("describeIntent covers every intent shape", () => {
    expect(describeIntent({ type: "workflow", command: "finalize" })).toBe("Finalize report");
    expect(describeIntent({ type: "dictate", target: "impression", mode: "replace", text: "x" })).toContain("REPLACE");
    expect(describeIntent({ type: "quick-select", action: "select", term: "disc bulge" })).toContain("disc bulge");
    expect(describeIntent({ type: "quick-modifier", property: "side", value: "left" })).toContain("side = left");
    expect(describeIntent({ type: "viewer", op: "zoom-in" })).toBe("Viewer: zoom in");
    expect(describeIntent({ type: "viewer-unsupported", capability: "measurements" })).toContain("not supported");
    expect(describeIntent({ type: "cancel" })).toBe("Cancel");
  });

  it("the help popover derives every category from the grammar itself", () => {
    const help = describeVoiceGrammar();
    const categories = help.map((h) => h.category);
    expect(categories).toEqual(expect.arrayContaining(["Workflow", "Dictation", "Quick Select", "Viewer", "Voice"]));
    expect(help.find((h) => h.category === "Workflow")!.examples).toContain("save draft");
  });
});
