import { describe, expect, test } from "vitest";
import { detectGenderFromName } from "./nameGender";

describe("detectGenderFromName — North / East Indian coverage", () => {
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
});
