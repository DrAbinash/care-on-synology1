// ─────────────────────────────────────────────────────────────────────────────
// RFC 8785 JSON Canonicalization Scheme (JCS) — Ticket D2 (writer/serializer),
// the canonicalization half of D1 §10's hash definition
// (docs/STRUCTURED_REPORT_JSON_SPEC_v1.md, frozen spec revision 2).
//
// D1 §10 pins `content_sha256 = SHA-256( JCS(document_root_with_exclusions) )`,
// where JCS is https://datatracker.ietf.org/doc/html/rfc8785. This module is
// that JCS. It is PURE and DETERMINISTIC: the same JSON value always produces
// the same byte string, independent of source key order or whitespace.
//
// Why this is a thin wrapper over JSON.stringify (and why that is CORRECT, not
// lazy): RFC 8785 defines exactly three things a serializer must do beyond
// plain JSON, and JavaScript's own JSON.stringify already does two of them
// verbatim —
//   1. Numbers — RFC 8785 §3.2.2.3 defines number serialization *by reference
//      to* ECMAScript `Number::toString`. `JSON.stringify(n)` is defined to
//      produce exactly `Number::toString(n)` for every finite n (including the
//      `-0 → "0"`, integer, and exponential-form cases). So delegating numbers
//      to JSON.stringify is not an approximation — it is the same algorithm.
//   2. Strings — RFC 8785 §3.2.2.2 mandates minimal RFC 8259 escaping with the
//      two-char short escapes (\b \t \n \f \r \" \\), lowercase `\u00xx` for
//      the remaining C0 control chars, no escaping of `/` or of any non-ASCII
//      (emitted literally as UTF-8), and `\uXXXX` (lowercase) for lone
//      surrogates. Modern V8 `JSON.stringify` (ES2019+ well-formed stringify)
//      produces precisely this. So delegating strings to JSON.stringify is,
//      again, the same output — not a lookalike.
//   3. Object member ordering — sort keys by UTF-16 code unit. This is the ONE
//      thing JSON.stringify does NOT do (it preserves insertion order), so it
//      is the only thing this module actually adds: recurse, emit each object's
//      keys in sorted order, and hand every scalar back to JSON.stringify.
//
// Scope note: JCS operates on a parsed JSON *value*. `undefined`, functions,
// bigint, and symbols are not JSON values. To stay consistent with
// JSON.stringify's own contract (which this module is otherwise identical to),
// an `undefined` object member is DROPPED and an `undefined` array element
// becomes `null` — matching JSON.stringify exactly — while bigint/function/
// symbol throw a JcsError rather than silently corrupting the hash preimage.
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when a value cannot be represented as canonical JSON (non-finite
 *  number, bigint, function, symbol). Never thrown for any well-formed
 *  structured-report document. */
export class JcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JcsError";
  }
}

/**
 * Serialize `value` to its RFC 8785 canonical JSON string. Pure and
 * deterministic. Throws {@link JcsError} on a value JSON cannot represent.
 */
export function jcsCanonicalize(value: unknown): string {
  const out: string[] = [];
  writeValue(value, out);
  return out.join("");
}

function writeValue(value: unknown, out: string[]): void {
  if (value === null) {
    out.push("null");
    return;
  }
  switch (typeof value) {
    case "string":
      // JSON.stringify string escaping === RFC 8785 §3.2.2.2 (see header).
      out.push(JSON.stringify(value));
      return;
    case "number":
      if (!Number.isFinite(value)) {
        throw new JcsError(`non-finite number cannot be canonicalized (RFC 8785 §3.2.2.3 forbids NaN/Infinity): ${String(value)}`);
      }
      // JSON.stringify(n) === ECMAScript Number::toString(n) for every finite
      // n, which IS the RFC 8785 §3.2.2.3 number serialization (see header).
      out.push(JSON.stringify(value));
      return;
    case "boolean":
      out.push(value ? "true" : "false");
      return;
    case "object":
      if (Array.isArray(value)) writeArray(value, out);
      else writeObject(value as Record<string, unknown>, out);
      return;
    default:
      // "bigint" | "function" | "symbol" | "undefined" — not JSON values. A
      // top-level/undefined-inside-array is normalized by the callers below;
      // reaching here with these types is a real programming error, not a
      // representable document.
      throw new JcsError(`value of type "${typeof value}" is not serializable as canonical JSON`);
  }
}

function writeArray(arr: unknown[], out: string[]): void {
  out.push("[");
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) out.push(",");
    // JSON.stringify serializes an `undefined` array element as `null`; match it.
    writeValue(arr[i] === undefined ? null : arr[i], out);
  }
  out.push("]");
}

function writeObject(obj: Record<string, unknown>, out: string[]): void {
  // Drop members whose value is `undefined` (JSON.stringify does the same),
  // then sort the remaining keys by UTF-16 code unit — RFC 8785 §3.2.3.
  const keys: string[] = [];
  for (const k of Object.keys(obj)) {
    if (obj[k] !== undefined) keys.push(k);
  }
  keys.sort(compareByCodeUnit);

  out.push("{");
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) out.push(",");
    out.push(JSON.stringify(keys[i])); // canonical string form for the key too
    out.push(":");
    writeValue(obj[keys[i]], out);
  }
  out.push("}");
}

/**
 * Compare two strings by UTF-16 code unit (RFC 8785 §3.2.3). JavaScript's
 * relational operators on strings already compare by UTF-16 code unit, so this
 * is exactly the ordering the RFC requires — spelled out explicitly rather than
 * relying on the default `Array.prototype.sort` comparator (which coerces via
 * `toString` and is easy to mistake for locale-aware).
 */
export function compareByCodeUnit(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
