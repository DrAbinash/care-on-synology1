import { describe, expect, it } from "vitest";
import {
  matchQuickFindingBySpokenTerm,
  resolveQuickFindingFromSpeech,
  type SpeechCatalogFinding,
} from "./resolveQuickFindingFromSpeech";

const catalog: SpeechCatalogFinding[] = [
  { id: 1, label: "Fatty liver", tags: "steatosis, hepatosteatosis" },
  { id: 2, label: "Hydronephrosis", tags: "HN" },
  { id: 3, label: "Disc bulge", tags: "bulge" },
  { id: 4, label: "Canal stenosis", tags: "stenosis" },
  { id: 5, label: "Neural foraminal stenosis", tags: "stenosis" },
  { id: 6, label: "Liver", tags: "" },
];

describe("resolveQuickFindingFromSpeech (reverse / prose)", () => {
  it("zero-match → narrative fallback", () => {
    const r = resolveQuickFindingFromSpeech(
      "Mild mucosal thickening in the ethmoid air cells.",
      catalog,
    );
    expect(r.status).toBe("zero-match");
    if (r.status === "zero-match") {
      expect(r.narrativeFallback).toBe(true);
      expect(r.negated).toEqual([]);
    }
  });

  it("negation guard: \"no fatty liver\" must NOT yield a positive match", () => {
    const r = resolveQuickFindingFromSpeech("There is no fatty liver.", catalog);
    expect(r.status).toBe("zero-match");
    if (r.status === "zero-match") {
      expect(r.narrativeFallback).toBe(true);
      expect(r.negated.map((n) => n.finding.label)).toEqual(["Fatty liver"]);
    }
  });

  it("negation via alias tag", () => {
    const r = resolveQuickFindingFromSpeech("No steatosis identified.", catalog);
    expect(r.status).toBe("zero-match");
    if (r.status === "zero-match") {
      expect(r.negated[0]?.matchedVia).toBe("steatosis");
    }
  });

  it("two-finding sentence segments both positive hits", () => {
    const r = resolveQuickFindingFromSpeech(
      "Fatty liver and hydronephrosis are noted.",
      catalog,
    );
    expect(r.status).toBe("matches");
    if (r.status === "matches") {
      expect(r.findings.map((f) => f.finding.label)).toEqual([
        "Fatty liver",
        "Hydronephrosis",
      ]);
      expect(r.negated).toEqual([]);
    }
  });

  it("mixed: positive + negated in one utterance", () => {
    const r = resolveQuickFindingFromSpeech(
      "Fatty liver is present; no hydronephrosis.",
      catalog,
    );
    expect(r.status).toBe("matches");
    if (r.status === "matches") {
      expect(r.findings.map((f) => f.finding.id)).toEqual([1]);
      expect(r.negated.map((f) => f.finding.id)).toEqual([2]);
    }
  });

  it("longest-match wins: \"fatty liver\" suppresses bare \"liver\"", () => {
    const r = resolveQuickFindingFromSpeech("Grade 1 fatty liver.", catalog);
    expect(r.status).toBe("matches");
    if (r.status === "matches") {
      expect(r.findings).toHaveLength(1);
      expect(r.findings[0].finding.label).toBe("Fatty liver");
    }
  });

  it("ambiguity: shared alias \"stenosis\" matches two findings on the same span", () => {
    const r = resolveQuickFindingFromSpeech("Moderate stenosis is seen.", catalog);
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") {
      expect(r.matchedVia).toBe("stenosis");
      expect(r.candidates.map((c) => c.id).sort()).toEqual([4, 5]);
    }
  });

  it("clause breaker after negation: \"no mass but fatty liver\" toggles fatty liver", () => {
    const r = resolveQuickFindingFromSpeech(
      "No mass but fatty liver is present.",
      catalog,
    );
    expect(r.status).toBe("matches");
    if (r.status === "matches") {
      expect(r.findings.map((f) => f.finding.label)).toEqual(["Fatty liver"]);
    }
  });
});

describe("matchQuickFindingBySpokenTerm (forward / explicit select)", () => {
  it("exact label match", () => {
    const r = matchQuickFindingBySpokenTerm("fatty liver", catalog);
    expect(r.status).toBe("match");
    if (r.status === "match") expect(r.finding.id).toBe(1);
  });

  it("substring label match", () => {
    const r = matchQuickFindingBySpokenTerm("hydro", catalog);
    expect(r.status).toBe("match");
    if (r.status === "match") expect(r.finding.label).toBe("Hydronephrosis");
  });

  it("ambiguity when term matches multiple labels", () => {
    const r = matchQuickFindingBySpokenTerm("stenosis", catalog);
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") {
      expect(r.candidates.map((c) => c.id).sort()).toEqual([4, 5]);
    }
  });

  it("zero-match", () => {
    expect(matchQuickFindingBySpokenTerm("pleural effusion", catalog).status).toBe("zero-match");
  });
});
