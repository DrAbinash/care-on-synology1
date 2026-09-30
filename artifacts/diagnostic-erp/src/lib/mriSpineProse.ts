/**
 * mriSpineProse.ts — the spine bracketed-group template engine.
 *
 * Lifted out of `mriLumbarLibrary.ts` without behaviour change so that more than
 * one spine segment can compile library prose through one engine. The only
 * structural difference from the original is that the level vocabulary is
 * supplied by a `SpineProseDialect` instead of being hard-coded to `L…`/`S1`:
 * `LUMBAR_PROSE_DIALECT` carries exactly the regexes the lumbar engine used.
 *
 * Contract, unchanged from the lumbar original:
 *
 *   1. Never invent. A placeholder the caller did not supply stays in the text
 *      verbatim and is reported in `unfilled`, so the UI shows a required
 *      fill-in rather than a fabricated level.
 *   2. Levels and vertebrae are *exemplary* in the library (they show the common
 *      example, not the only legal value), so a supplied level is accepted even
 *      when the library listed a different one. True enumerations — side,
 *      migration direction, Castellvi grade — are strict: an unlisted value is
 *      left unfilled rather than forced into the sentence.
 *   3. Pure functions and data only — no store, no React.
 */

export type SpineProseSide = "left" | "right" | "bilateral";
export type SpineProseDirection =
  | "superiorly"
  | "inferiorly"
  | "cranially"
  | "caudally";

export type SpineProseVars = {
  /** Disc / vertebral level, e.g. "L4-L5". */
  level?: string;
  /** Second level where a sentence spans two levels. */
  level2?: string;
  side?: SpineProseSide;
  /** Root designation, e.g. "S1", "L5". */
  root?: string;
  /** Millimetre measurement (the library's `[X] mm`). */
  mm?: string | number;
  /** Second millimetre measurement, e.g. "X mm (AP) x Y mm (transverse)". */
  mm2?: string | number;
  /** Centimetre measurement. */
  cm?: string | number;
  /** Second centimetre measurement. */
  cm2?: string | number;
  /** Percentage height loss (the library's `[X]%`). */
  pct?: string | number;
  direction?: SpineProseDirection;
  /** Castellvi grade, e.g. "IIa". */
  castellvi?: string;
  /** Conus termination level. */
  conusLevel?: string;
  /** Vertebra name for body/pars sentences, e.g. "L5". */
  vertebra?: string;
  /** "superior"/"inferior" endplate (Schmorl node). */
  endplateFace?: string;
};

export type SpineProseSlot = {
  /** The library's bracketed group, verbatim, e.g. "[L4-L5 / L5-S1]". */
  raw: string;
  alternatives: string[];
};

export type SpineProseResult = {
  text: string;
  /** Library placeholders the caller did not supply — left visible. */
  unfilled: SpineProseSlot[];
};

/**
 * The level vocabulary one reporting segment uses inside a library sentence.
 * Everything else in the engine is segment-independent.
 */
export type SpineProseDialect = {
  /** `L4-L5`, `L4 on L5` — a two-vertebra slot. */
  discLevelRe: RegExp;
  /** `L5`, `S1` — a single vertebra. */
  vertebraRe: RegExp;
  /** `[left L5]` — side and vertebra fused into one group. */
  sideVertebraRe: RegExp;
};

/** Exactly the vocabulary the lumbar library was written against. */
export const LUMBAR_PROSE_DIALECT: SpineProseDialect = {
  discLevelRe: /^(?:L\d\s*(?:-|on)\s*(?:L\d|S1)|L\d-(?:L\d|S1))$/i,
  vertebraRe: /^(?:L[1-6]|S1|TV)$/i,
  sideVertebraRe: /^(left|right)\s+(L\d|S1)$/i,
};

const CHOICE_GROUP = /\[[^\]]+\]/g;

const SIDE_RE = /^(?:left|right|bilateral)$/i;
const DIRECTION_RE = /^(?:superiorly|inferiorly|cranially|caudally|superior|inferior)$/i;
const CASTELLVI_RE = /^(?:I|II|III|IV|IIa|IIb|IIIa|IIIb)$/i;

type GroupKind =
  | "measurement"
  | "side"
  | "direction"
  | "castellvi"
  | "discLevel"
  | "vertebra"
  | "levelPair"
  | "mixed"
  | "unknown";

function innerOf(raw: string): string {
  return raw.slice(1, -1).trim();
}

function slashAlternatives(inner: string): string[] {
  return inner.split("/").map((s) => s.trim()).filter(Boolean);
}

/** `L4-L5 and L5-S1` — the library's two-level group, not a slash choice. */
function andLevelPair(inner: string, dialect: SpineProseDialect): string[] | null {
  const parts = inner.split(/\s+and\s+/i).map((s) => s.trim());
  if (parts.length === 2 && parts.every((p) => dialect.discLevelRe.test(p))) return parts;
  return null;
}

function classifyGroup(
  raw: string,
  dialect: SpineProseDialect,
): { kind: GroupKind; alternatives: string[] } {
  const inner = innerOf(raw);
  if (/^X$/i.test(inner)) return { kind: "measurement", alternatives: ["X"] };

  const pair = andLevelPair(inner, dialect);
  if (pair) return { kind: "levelPair", alternatives: pair };

  // `[left L5]` — side + vertebra in one group.
  const sideVertebra = inner.match(dialect.sideVertebraRe);
  if (sideVertebra) return { kind: "mixed", alternatives: [inner] };

  const alts = slashAlternatives(inner);
  if (alts.length === 0) return { kind: "unknown", alternatives: [inner] };
  if (alts.every((a) => SIDE_RE.test(a))) return { kind: "side", alternatives: alts };
  if (alts.every((a) => DIRECTION_RE.test(a))) return { kind: "direction", alternatives: alts };
  if (alts.every((a) => CASTELLVI_RE.test(a))) return { kind: "castellvi", alternatives: alts };
  if (alts.every((a) => dialect.discLevelRe.test(a))) return { kind: "discLevel", alternatives: alts };
  if (alts.every((a) => dialect.vertebraRe.test(a))) return { kind: "vertebra", alternatives: alts };
  return { kind: "mixed", alternatives: alts };
}

/**
 * Levels and vertebrae are *exemplary* in the library (they show the common
 * example, not the only legal value), so a supplied level is accepted even when
 * the library listed a different one. True enumerations — side, migration
 * direction, Castellvi grade — are strict: an unlisted value is left unfilled
 * rather than forced into the sentence.
 */
function resolveGroup(
  kind: GroupKind,
  alternatives: string[],
  vars: SpineProseVars,
  mmOccurrence: number,
  unit: "percent" | "cm" | "mm",
  dialect: SpineProseDialect,
): string {
  const loose = (v?: string | number) => (v == null ? "" : String(v)).trim();

  if (kind === "measurement") {
    if (unit === "percent") return loose(vars.pct);
    if (unit === "cm") return loose(mmOccurrence === 0 ? vars.cm : vars.cm2) || (mmOccurrence === 0 ? "" : loose(vars.cm));
    return loose(mmOccurrence === 0 ? vars.mm : vars.mm2) || (mmOccurrence === 0 ? "" : loose(vars.mm));
  }

  if (kind === "side") {
    const v = loose(vars.side);
    return v && alternatives.some((a) => a.toLowerCase() === v.toLowerCase()) ? v : "";
  }
  if (kind === "direction") {
    const v = loose(vars.direction);
    return v && alternatives.some((a) => a.toLowerCase() === v.toLowerCase()) ? v : "";
  }
  if (kind === "castellvi") {
    const v = loose(vars.castellvi);
    if (!v) return "";
    const upper = v.toUpperCase();
    // The library writes the group as [I/II/III/IV]; a subtype (IIa, IIIb)
    // still belongs to that listed grade, so it is accepted.
    return alternatives.some((a) => a.toUpperCase() === upper)
      || alternatives.some((a) => a.toUpperCase() === upper.replace(/[AB]$/, ""))
      ? v
      : "";
  }
  if (kind === "discLevel") {
    const a = loose(vars.level);
    const b = loose(vars.level2);
    // Slip sentences name two vertebrae ("L4 on L5"), not a disc level.
    if (alternatives.every((x) => /\son\b/i.test(x))) {
      return a && b ? `${a} on ${b}` : "";
    }
    return a || b;
  }
  if (kind === "vertebra") {
    return loose(vars.vertebra) || loose(vars.conusLevel) || loose(vars.root);
  }
  if (kind === "levelPair") {
    const a = loose(vars.level);
    const b = loose(vars.level2);
    return a && b ? `${a} and ${b}` : "";
  }
  if (kind === "mixed") {
    // `[left L5]`
    const sv = alternatives[0]?.match(dialect.sideVertebraRe);
    if (sv) {
      const side = loose(vars.side);
      const vert = loose(vars.root) || loose(vars.vertebra);
      return side && vert ? `${side} ${vert}` : "";
    }
    return loose(vars.conusLevel) || loose(vars.level) || loose(vars.vertebra) || loose(vars.root);
  }
  return "";
}

/** Unit that governs a measurement placeholder, looking past an `x [X]` pair. */
function unitAfter(template: string, from: number): "percent" | "cm" | "mm" {
  const rest = template.slice(from);
  const m = rest.match(/^\s*(?:x\s*(?:\[X\]|X)\s*)?(%|cm|mm)/i);
  if (!m) return "mm";
  const u = m[1]!.toLowerCase();
  return u === "%" ? "percent" : u === "cm" ? "cm" : "mm";
}

function scalar(v: string | number | undefined): string {
  const s = (v == null ? "" : String(v)).trim();
  return s;
}

/**
 * Library macros write measurements as bare `X mm` / `X x X cm` / `X%`. Values
 * are consumed in order per unit so "AP x transverse" gets mm then mm2.
 */
function fillBareMeasurements(text: string, vars: SpineProseVars): string {
  const queues: Record<"mm" | "cm" | "percent", string[]> = {
    mm: [scalar(vars.mm), scalar(vars.mm2)].filter(Boolean),
    cm: [scalar(vars.cm), scalar(vars.cm2)].filter(Boolean),
    percent: [scalar(vars.pct)].filter(Boolean),
  };
  return text.replace(
    /\bX\b(\s*)(%|cm|mm)/gi,
    (whole, _gap: string, unitRaw: string) => {
      const unit = unitRaw.toLowerCase();
      const key: "percent" | "cm" | "mm" = unit === "%" ? "percent" : unit === "cm" ? "cm" : "mm";
      const value = queues[key].shift();
      return value == null ? whole : `${value}${unitRaw === "%" ? "" : " "}${unitRaw}`;
    },
  );
}

/**
 * Substitute library placeholders from structured input. Never invents: an
 * unsupplied placeholder stays exactly as the library wrote it and is reported
 * in `unfilled`, so the UI renders it as a required fill-in.
 */
export function fillSpineProse(
  template: string,
  vars: SpineProseVars = {},
  dialect: SpineProseDialect,
): SpineProseResult {
  const unfilled: SpineProseSlot[] = [];
  const occurrences: Record<string, number> = { mm: 0, cm: 0, percent: 0 };
  let text = "";
  let cursor = 0;

  CHOICE_GROUP.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHOICE_GROUP.exec(template)) !== null) {
    text += template.slice(cursor, m.index);
    cursor = m.index + m[0].length;
    const group = m[0];
    const { kind, alternatives } = classifyGroup(group, dialect);

    let chosen = "";
    if (kind === "measurement") {
      const unit = unitAfter(template, cursor);
      chosen = resolveGroup(kind, alternatives, vars, occurrences[unit]++, unit, dialect);
    } else {
      chosen = resolveGroup(kind, alternatives, vars, 0, "mm", dialect);
    }

    if (chosen) {
      text += chosen;
    } else {
      unfilled.push({ raw: group, alternatives });
      text += group;
    }
  }
  text += template.slice(cursor);

  // The library writes some choices inline ("superior/inferior endplate").
  let out = text;
  if (vars.endplateFace && /superior\/inferior/i.test(out)) {
    out = out.replace(/\bsuperior\/inferior\b/i, vars.endplateFace);
  }

  return {
    text: fillBareMeasurements(out, vars).replace(/\s+/g, " ").trim(),
    unfilled,
  };
}

/** A rendered sentence that still contains a library placeholder or a bare `X`. */
export function isUnfilledSpineProse(text: string): boolean {
  return /\[[^\]]+\]/.test(text) || /\bX\b(?=\s*(?:mm|cm|%))/.test(text);
}
