import { describe, expect, test, beforeEach } from "vitest";
import {
  detectGenderFromName,
  applyNameGenderExtras,
  parseNameGenderExtraList,
} from "./nameGender";

describe("detectGenderFromName — North / East Indian coverage", () => {
  beforeEach(() => {
    applyNameGenderExtras([], []);
  });

  test.each([
    ["Guddu", "male"],
    ["Pintu Kumar", "male"],
    ["Ghanshyam", "male"],
    ["Hanuman", "male"],
    ["Shyam", "male"],
    ["Babalu", "male"],
    ["Arnab", "male"],
    ["Soumitra", "male"],
    ["Jayanta", "male"],
    ["Krushna", "male"],
    ["Trilochan", "male"],
    ["Nabajyoti", "male"],
    ["Parag", "male"],
    ["Tomba", "male"],
  ] as const)("%s → %s", (name, gender) => {
    expect(detectGenderFromName(name)).toBe(gender);
  });

  test.each([
    ["Babita", "female"],
    ["Gudiya", "female"],
    ["Munni", "female"],
    ["Mamata", "female"],
    ["Laboni", "female"],
    ["Rituparna", "female"],
    ["Paromita", "female"],
    ["Sasmita", "female"],
    ["Snigdha", "female"],
    ["Junmoni", "female"],
    ["Trishna", "female"],
    ["Leima", "female"],
  ] as const)("%s → %s", (name, gender) => {
    expect(detectGenderFromName(name)).toBe(gender);
  });

  test("still respects honorifics and known pan-India names", () => {
    expect(detectGenderFromName("Mrs Sunita Devi")).toBe("female");
    expect(detectGenderFromName("Rahul")).toBe("male");
  });

  test("unisex / unknown returns null", () => {
    expect(detectGenderFromName("Kiran")).toBeNull();
    expect(detectGenderFromName("xyzabc")).toBeNull();
  });

  test("clinic extras override unknown names", () => {
    expect(detectGenderFromName("Zorblax")).toBeNull();
    applyNameGenderExtras(["zorblax"], ["zorblina"]);
    expect(detectGenderFromName("Zorblax")).toBe("male");
    expect(detectGenderFromName("Mrs Zorblina")).toBe("female");
  });

  test("parseNameGenderExtraList accepts JSON array or newlines", () => {
    expect(parseNameGenderExtraList('["A","B"]')).toEqual(["a", "b"]);
    expect(parseNameGenderExtraList("A\nB, C")).toEqual(["a", "b", "c"]);
    expect(parseNameGenderExtraList("")).toEqual([]);
  });
});
