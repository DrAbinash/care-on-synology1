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
  | "caudally"
  | "superior"
  | "inferior";

export type SpineProseVars = {
  /** Disc / vertebral level, e.g. "L4-L5" or "T8-T9". */
  level?: string;
  /** Second level where a sentence spans two levels. */
  level2?: string;
  side?: SpineProseSide;
  /** Root designation, e.g. "S1", "T12". */
  root?: string;
  /** Millimetre measurement (the library's `[X] mm`). */
  mm?: string | number | null;
  /** Second millimetre measurement, e.g. "X mm (AP) x Y mm (transverse)". */
  mm2?: string | number | null;
  /** Centimetre measurement. */
  cm?: string | number | null;
  /** Second centimetre measurement. */
  cm2?: string | number | null;
  /** Third centimetre measurement (a macro's `X x X x X cm` triple). */
  cm3?: string | number | null;
  /** Percentage height loss (the library's `[X]%`). */
  pct?: string | number | null;
  direction?: SpineProseDirection;
  /** Castellvi grade, e.g. "IIa". */
  castellvi?: string;
  /** Conus termination level. */
  conusLevel?: string;
  /** Vertebra name for body/pars sentences, e.g. "L5", "T6". */
  vertebra?: string;
  /** Second vertebra, e.g. "[vertebra] over [vertebra]". */
  vertebra2?: string;
  /** "superior"/"inferior" endplate (Schmorl node). */
  endplateFace?: string;
  /** Word the radiologist picked inside a `[with / without]`-style group. */
  choice?: string;
  /** Stenosis / compromise wording, e.g. "severe", "moderate". */
  degree?: string;
  /**
   * Values for one specific library group, keyed by its bracket text with the
   * slashes kept, e.g. `"cord/conus"` or `"level"`. A macro that asks three
   * different questions in one sentence cannot be filled from a single shared
   * `choice`, and filling them positionally would silently swap two answers.
   */
  slotValues?: Record<string, string>;
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
  /**
   * Lumbar prose is frozen. It shipped before this engine existed, and the
   * extraction PR proved every sentence byte-for-byte, so the lumbar dialect
   * keeps the original grammar and nothing else.
   *
   * A segment whose library uses the wider grammar — a craniocaudal extent
   * (`[T4 through T7]`), a bare word choice (`[with / without]`), a slot mixing
   * a two-vertebra level with a single vertebra (`[T12-L1 / L1]`), or a third
   * centimetre — opts in here. The extra readings then apply only to that
   * segment's sentences, so widening one segment's vocabulary can never silently
   * re-classify another segment's already-shipped prose.
   */
  extendedGrammar?: boolean;
  /**
   * The library names the question instead of offering alternatives (`[level]`,
   * `[vertebra]`, `[degree]`, `[side]`, `[root]`), and a caller may answer a
   * specific bracket through `slotValues`. Lumbar and dorsal prose never asks
   * that kind of question, so the readings stay off unless a library opts in.
   */
  genericSlots?: boolean;
};

/** Exactly the vocabulary the lumbar library was written against. */
export const LUMBAR_PROSE_DIALECT: SpineProseDialect = {
  discLevelRe: /^(?:L\d\s*(?:-|on)\s*(?:L\d|S1)|L\d-(?:L\d|S1))$/i,
  vertebraRe: /^(?:L[1-6]|S1|TV)$/i,
  sideVertebraRe: /^(left|right)\s+(L\d|S1)$/i,
};

export const DORSAL_PROSE_DIALECT: SpineProseDialect = {
  // Thoracic reporting reaches the thoracolumbar junction, so `T12-L1` and
  // `T12 on L1` are ordinary slots here.
  discLevelRe:
    /^(?:T\d{1,2}\s*(?:-|on)\s*(?:T\d{1,2}|L\d{1,2})|T\d{1,2}-(?:T\d{1,2}|L\d{1,2})|L\d\s*(?:-|on)\s*L\d)$/i,
  vertebraRe: /^(?:T[1-9]|T1[0-2]|L[1-5]|S1)$/i,
  sideVertebraRe: /^(left|right)\s+(T\d{1,2}|L\d|S1)$/i,
  extendedGrammar: true,
};

const CHOICE_GROUP = /\[[^\]]+\]/g;

const SIDE_RE = /^(?:left|right|bilateral)$/i;
const DIRECTION_RE = /^(?:superiorly|inferiorly|cranially|caudally|superior|inferior)$/i;
const CASTELLVI_RE = /^(?:I|II|III|IV|IIa|IIb|IIIa|IIIb)$/i;
/** `T4 through T7` / `T8 to T11` — the library's craniocaudal extent group. */
const LEVEL_RANGE_RE = /^([A-Z]\d{1,2})\s+(through|to)\s+([A-Z]\d{1,2})$/i;
/** A plain word choice such as `[with / without]`. */
const WORD_RE = /^[A-Za-z][A-Za-z' -]{1,20}$/;

type GroupKind =
  | "measurement"
  | "side"
  | "direction"
  | "castellvi"
  | "discLevel"
  | "vertebra"
  | "levelOrVertebra"
  | "levelPair"
  | "levelRange"
  | "wordChoice"
  | "generic"
  | "mixed"
  | "unknown";

/**
 * The dorso-lumbar library names the question instead of giving an example
 * value ("at [level]", "involving [levels]", "[degree] canal compromise"), so
 * those groups are filled from the matching structured field rather than being
 * treated as a word choice the radiologist has to spell out.
 */
const GENERIC_SLOT_RE = /^(levels?|vertebra|degree|side|root)$/i;

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
): { kind: GroupKind; alternatives: string[]; joiner?: string } {
  const inner = innerOf(raw);
  if (/^X$/i.test(inner)) return { kind: "measurement", alternatives: ["X"] };
  if (dialect.genericSlots && GENERIC_SLOT_RE.test(inner)) return { kind: "generic", alternatives: [inner.toLowerCase()] };

  const pair = andLevelPair(inner, dialect);
  if (pair) return { kind: "levelPair", alternatives: pair };

  if (dialect.extendedGrammar) {
    const range = inner.match(LEVEL_RANGE_RE);
    if (range) {
      return { kind: "levelRange", alternatives: [range[1]!, range[3]!], joiner: range[2]! };
    }
  }

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
  if (dialect.extendedGrammar) {
    // `[T12-L1 / L1]` — a group mixing a two-vertebra slot with a single
    // vertebra. The dorsal library writes it for the conus, whose site is the
    // cord termination rather than the level a tile was captured at.
    if (alts.every((a) => dialect.discLevelRe.test(a) || dialect.vertebraRe.test(a))) {
      return { kind: "levelOrVertebra", alternatives: alts };
    }
    // A bare word group is selectable only when every alternative is a word;
    // anything clinical (an abbreviation, a phrase with digits) stays unfilled
    // rather than being silently substituted.
    if (alts.every((a) => WORD_RE.test(a))) return { kind: "wordChoice", alternatives: alts };
  }
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
  genericOccurrence = 0,
): string {
  const loose = (v?: string | number | null) => (v == null ? "" : String(v)).trim();

  // A value supplied for this exact bracket outranks every positional rule, so a
  // sentence with three bracketed questions cannot have its answers shuffled by
  // filling them in order.
  const slotKey = alternatives.join("/").toLowerCase().replace(/\s+/g, "");
  const suppliedSlot = dialect.genericSlots
    ? loose(vars.slotValues?.[slotKey])
      || loose(vars.slotValues?.[(alternatives[0] ?? "").toLowerCase().replace(/\s+/g, "")])
    : "";
  if (suppliedSlot) return suppliedSlot;

  if (kind === "generic") {
    const name = alternatives[0] ?? "";
    // A sentence that asks for two levels or two vertebrae ("extends from
    // [level] to [level]", "[vertebra] over [vertebra]") takes the second value
    // from the paired field, exactly as repeated measurements do.
    if (name === "levels") {
      const both = [loose(vars.level), loose(vars.level2)].filter(Boolean);
      return both.join(" and ");
    }
    if (name === "level") {
      return genericOccurrence === 0 ? loose(vars.level) : loose(vars.level2) || loose(vars.level);
    }
    if (name === "vertebra") {
      return genericOccurrence === 0 ? loose(vars.vertebra) : loose(vars.vertebra2) || loose(vars.vertebra);
    }
    if (name === "degree") return loose(vars.degree);
    if (name === "side") return loose(vars.side);
    if (name === "root") return loose(vars.root);
    return "";
  }

  if (kind === "measurement") {
    if (unit === "percent") return loose(vars.pct);
    if (unit === "cm") {
      if (!dialect.extendedGrammar) {
        return loose(mmOccurrence === 0 ? vars.cm : vars.cm2) || (mmOccurrence === 0 ? "" : loose(vars.cm));
      }
      const primary = mmOccurrence === 0 ? vars.cm : mmOccurrence === 1 ? vars.cm2 : vars.cm3;
      const fallback = mmOccurrence === 0 ? "" : mmOccurrence === 1 ? vars.cm : vars.cm2;
      return loose(primary) || loose(fallback);
    }
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
  if (kind === "wordChoice") {
    const v = loose(vars.choice);
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
  if (kind === "levelOrVertebra") {
    return loose(vars.conusLevel) || loose(vars.vertebra) || loose(vars.root);
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

function scalar(v: string | number | null | undefined): string {
  const s = (v == null ? "" : String(v)).trim();
  return s;
}

/**
 * Library macros write measurements as bare `X mm` / `X x X cm` / `X%`. Values
 * are consumed in order per unit so "AP x transverse" gets mm then mm2.
 *
 * Two readings, chosen by dialect. Lumbar keeps the original exactly: it is
 * frozen, and a partial measurement there already renders as it always did.
 * The extended reading serves a library that writes a three-part dimension
 * (`X x X x X cm`) as one group, where the whole group must either fill or stay
 * as the library wrote it — filling two of three would read as a real size.
 */
function fillBareMeasurements(
  text: string,
  vars: SpineProseVars,
  dialect: SpineProseDialect,
): string {
  if (!dialect.extendedGrammar) {
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

  const queues: Record<"mm" | "cm" | "percent", string[]> = {
    mm: [scalar(vars.mm), scalar(vars.mm2)].filter(Boolean),
    cm: [scalar(vars.cm), scalar(vars.cm2), scalar(vars.cm3)].filter(Boolean),
    percent: [scalar(vars.pct)].filter(Boolean),
  };
  return text.replace(
    /\bX\b((?:\s+x\s+\bX\b)*)\s*(%|cm|mm)/gi,
    (whole, chain: string, unitRaw: string) => {
      const unit = unitRaw.toLowerCase();
      const key: "percent" | "cm" | "mm" = unit === "%" ? "percent" : unit === "cm" ? "cm" : "mm";
      const count = 1 + ((chain.match(/\bX\b/g) ?? []).length);
      const values: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const value = queues[key].shift();
        if (value == null) return whole;
        values.push(value);
      }
      let index = 0;
      const filled = whole.replace(/\bX\b/g, () => values[index++] ?? "X");
      return unit === "%"
        ? filled.replace(/\s+%$/, "%")
        : filled.replace(/\s+(?:cm|mm)$/i, ` ${unitRaw}`);
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
  varsIn: SpineProseVars = {},
  dialect: SpineProseDialect,
): SpineProseResult {
  const unfilled: SpineProseSlot[] = [];
  const occurrences: Record<string, number> = { mm: 0, cm: 0, percent: 0 };
  // Slot keys are matched case- and whitespace-insensitively, so a caller can
  // write `slotValues["cord/conus"]` without knowing how the library spaced it.
  const vars: SpineProseVars = varsIn.slotValues
    ? {
        ...varsIn,
        slotValues: Object.fromEntries(
          Object.entries(varsIn.slotValues).map(([k, v]) => [k.toLowerCase().replace(/\s+/g, ""), v]),
        ),
      }
    : varsIn;
  let text = "";
  let cursor = 0;

  CHOICE_GROUP.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHOICE_GROUP.exec(template)) !== null) {
    text += template.slice(cursor, m.index);
    cursor = m.index + m[0].length;
    const group = m[0];
    const { kind, alternatives, joiner } = classifyGroup(group, dialect);

    let chosen = "";
    if (kind === "measurement") {
      const unit = unitAfter(template, cursor);
      chosen = resolveGroup(kind, alternatives, vars, occurrences[unit]++, unit, dialect);
    } else if (kind === "levelRange") {
      const upper = String(vars.level ?? "").trim();
      const lower = String(vars.level2 ?? "").trim();
      chosen = upper && lower ? `${upper} ${joiner ?? "to"} ${lower}` : "";
    } else {
      const genericName = kind === "generic" ? alternatives[0] ?? "" : "";
      const genericOccurrence = genericName ? occurrences[genericName] ?? 0 : 0;
      if (genericName) occurrences[genericName] = genericOccurrence + 1;
      chosen = resolveGroup(kind, alternatives, vars, 0, "mm", dialect, genericOccurrence);
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
    text: fillBareMeasurements(out, vars, dialect).replace(/\s+/g, " ").trim(),
    unfilled,
  };
}

/** A rendered sentence that still contains a library placeholder or a bare `X`. */
export function isUnfilledSpineProse(text: string): boolean {
  return /\[[^\]]+\]/.test(text) || /\bX\b(?=\s*(?:mm|cm|%))/.test(text);
}
