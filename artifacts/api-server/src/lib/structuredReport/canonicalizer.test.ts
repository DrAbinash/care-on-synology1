import { describe, it, expect } from "vitest";
import { jcsCanonicalize, compareByCodeUnit, JcsError } from "./canonicalizer";

// RFC 8785 (JSON Canonicalization Scheme) conformance for the canonicalizer that
// backs content_sha256 (D1 §10). These assertions pin the three things JCS adds
// over plain JSON — key ordering, number form, string escaping — plus the JSON
// structural cases, so any regression in the hash preimage is caught here rather
// than only as an opaque digest mismatch downstream.
//
// Control/DEL characters are built with String.fromCharCode rather than embedded
// literally, so the source file stays plain-ASCII and unambiguous.
const CH = (code: number) => String.fromCharCode(code);

describe("jcsCanonicalize — object member ordering (RFC 8785 §3.2.3, UTF-16 code unit)", () => {
  it("sorts keys by UTF-16 code unit, not insertion order", () => {
    expect(jcsCanonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("orders digit-leading keys by code unit ('10' < '2', because '1' < '2')", () => {
    expect(jcsCanonicalize({ "2": 0, "10": 0, a: 0, A: 0, _: 0 })).toBe('{"10":0,"2":0,"A":0,"_":0,"a":0}');
  });

  it("sorts keys recursively at every nesting level", () => {
    expect(jcsCanonicalize({ z: { y: 1, x: 2 }, a: { c: 3, b: 4 } })).toBe(
      '{"a":{"b":4,"c":3},"z":{"x":2,"y":1}}',
    );
  });

  it("does NOT reorder array elements (only object members are sorted)", () => {
    expect(jcsCanonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(jcsCanonicalize({ list: ["c", "a", "b"] })).toBe('{"list":["c","a","b"]}');
  });

  it("compareByCodeUnit is a total UTF-16-code-unit order", () => {
    expect(compareByCodeUnit("a", "b")).toBe(-1);
    expect(compareByCodeUnit("b", "a")).toBe(1);
    expect(compareByCodeUnit("a", "a")).toBe(0);
    expect(compareByCodeUnit("10", "2")).toBe(-1); // '1'(0x31) < '2'(0x32)
    expect(compareByCodeUnit("Z", "a")).toBe(-1); // 'Z'(0x5A) < 'a'(0x61)
  });
});

describe("jcsCanonicalize — numbers (RFC 8785 §3.2.2.3 === ECMAScript Number::toString)", () => {
  it("drops an insignificant trailing zero: 102.0 canonicalizes to 102", () => {
    expect(jcsCanonicalize(102.0)).toBe("102");
    expect(jcsCanonicalize({ v: 4.5 })).toBe('{"v":4.5}');
  });

  it("serializes negative zero as 0 (RFC 8785 §3.2.2.3)", () => {
    expect(jcsCanonicalize(-0)).toBe("0");
    expect(jcsCanonicalize({ v: -0 })).toBe('{"v":0}');
  });

  it("keeps integers and simple decimals verbatim", () => {
    expect(jcsCanonicalize(0)).toBe("0");
    expect(jcsCanonicalize(1)).toBe("1");
    expect(jcsCanonicalize(-17)).toBe("-17");
    expect(jcsCanonicalize(0.74)).toBe("0.74");
    expect(jcsCanonicalize(102.4)).toBe("102.4");
  });

  it("rejects non-finite numbers (RFC 8785 forbids NaN/Infinity)", () => {
    expect(() => jcsCanonicalize(NaN)).toThrow(JcsError);
    expect(() => jcsCanonicalize(Infinity)).toThrow(JcsError);
    expect(() => jcsCanonicalize(-Infinity)).toThrow(JcsError);
  });
});

describe("jcsCanonicalize — strings (RFC 8785 §3.2.2.2 minimal escaping)", () => {
  it("escapes the mandatory characters with short escapes", () => {
    expect(jcsCanonicalize('a"b')).toBe('"a\\"b"'); // quote
    expect(jcsCanonicalize("a\\b")).toBe('"a\\\\b"'); // backslash
    expect(jcsCanonicalize("a\nb")).toBe('"a\\nb"'); // newline
    expect(jcsCanonicalize("a\tb")).toBe('"a\\tb"'); // tab
    expect(jcsCanonicalize(CH(8) + CH(12) + CH(13))).toBe('"\\b\\f\\r"'); // \b \f \r
  });

  it("uses lowercase \\u00xx for the other C0 control characters", () => {
    expect(jcsCanonicalize(CH(0))).toBe('"\\u0000"');
    expect(jcsCanonicalize(CH(1))).toBe('"\\u0001"');
    expect(jcsCanonicalize(CH(0x1f))).toBe('"\\u001f"'); // lowercase hex
  });

  it("does NOT escape '/', DEL (U+007F), or any non-ASCII (emitted literally as UTF-8)", () => {
    expect(jcsCanonicalize("a/b")).toBe('"a/b"'); // forward slash unescaped
    expect(jcsCanonicalize(CH(0x7f))).toBe('"' + CH(0x7f) + '"'); // DEL is NOT escaped by JCS
    expect(jcsCanonicalize("café — 中文 — π")).toBe('"café — 中文 — π"');
  });
});

describe("jcsCanonicalize — JSON structural cases", () => {
  it("handles booleans and null", () => {
    expect(jcsCanonicalize(true)).toBe("true");
    expect(jcsCanonicalize(false)).toBe("false");
    expect(jcsCanonicalize(null)).toBe("null");
    expect(jcsCanonicalize({ a: null, b: true })).toBe('{"a":null,"b":true}');
  });

  it("emits empty object/array without whitespace", () => {
    expect(jcsCanonicalize({})).toBe("{}");
    expect(jcsCanonicalize([])).toBe("[]");
  });

  it("drops undefined object members (matches JSON.stringify) and nulls undefined array slots", () => {
    expect(jcsCanonicalize({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
    expect(jcsCanonicalize([1, undefined, 3])).toBe("[1,null,3]");
  });

  it("throws on values JSON cannot represent (bigint/function/symbol)", () => {
    expect(() => jcsCanonicalize(10n)).toThrow(JcsError);
    expect(() => jcsCanonicalize(() => 0)).toThrow(JcsError);
    expect(() => jcsCanonicalize(Symbol("x"))).toThrow(JcsError);
  });
});

describe("jcsCanonicalize — RFC 8785 boundary cases (the parts a naive reimplementation gets wrong)", () => {
  // These are the cases that actually distinguish RFC 8785 from a hand-rolled
  // serializer, and where content_sha256 would silently diverge if the delegated
  // JSON.stringify behavior or the code-unit ordering were ever replaced. The
  // ordinary-value blocks above would NOT catch such a regression.

  it("numbers: exponential forms match ECMAScript Number::toString exactly", () => {
    expect(jcsCanonicalize(1e21)).toBe("1e+21"); // >= 1e21 switches to exponent form
    expect(jcsCanonicalize(1e-7)).toBe("1e-7"); // <= 1e-7 switches to exponent form
    expect(jcsCanonicalize(1e-6)).toBe("0.000001"); // just above the boundary: fixed form
    expect(jcsCanonicalize(5e-324)).toBe("5e-324"); // smallest positive denormal (Number.MIN_VALUE)
  });

  it("strings: lone surrogates are escaped as lowercase \\uXXXX (ES2019 well-formed stringify)", () => {
    // 0xD800 is a lone high surrogate — RFC 8785 requires a lowercase \uXXXX escape.
    expect(jcsCanonicalize(String.fromCharCode(0xd800))).toBe('"\\ud800"');
    // 0xDC00 lone low surrogate likewise.
    expect(jcsCanonicalize(String.fromCharCode(0xdc00))).toBe('"\\udc00"');
  });

  it("strings: a valid supplementary-plane character is emitted literally (as UTF-8), not escaped", () => {
    const grinning = String.fromCodePoint(0x1f600); // U+1F600, surrogate pair D83D DE00
    expect(jcsCanonicalize(grinning)).toBe('"' + grinning + '"');
    // round-trips through parse
    expect(JSON.parse(jcsCanonicalize(grinning))).toBe(grinning);
  });

  it("keys: ordering is by UTF-16 CODE UNIT, so a supplementary-plane key sorts before a U+E000+ BMP key", () => {
    const supp = String.fromCodePoint(0x10000); // leading code unit 0xD800
    const bmpHigh = String.fromCodePoint(0xe000); // single code unit 0xE000 (> 0xD800)
    const out = jcsCanonicalize({ [bmpHigh]: 2, [supp]: 1 });
    // Under code-UNIT order (RFC 8785) supp (0xD800…) precedes bmpHigh (0xE000).
    // Under code-POINT order it would NOT (U+10000 > U+E000) — this asserts the
    // correct one.
    expect(out.indexOf(JSON.stringify(supp))).toBeLessThan(out.indexOf(JSON.stringify(bmpHigh)));
    expect(out).toBe("{" + JSON.stringify(supp) + ":1," + JSON.stringify(bmpHigh) + ":2}");
  });
});

describe("jcsCanonicalize — determinism & idempotence", () => {
  it("is independent of source key order (the whole point of canonicalization)", () => {
    const a = jcsCanonicalize({ x: 1, y: 2, z: { p: 3, q: 4 } });
    const b = jcsCanonicalize({ z: { q: 4, p: 3 }, y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it("is a fixed point: parsing then re-canonicalizing yields the same string", () => {
    const value = { c: [1, 2, { b: "y", a: "x" }], a: "café", b: 4.5 };
    const once = jcsCanonicalize(value);
    const twice = jcsCanonicalize(JSON.parse(once));
    expect(twice).toBe(once);
  });
});
