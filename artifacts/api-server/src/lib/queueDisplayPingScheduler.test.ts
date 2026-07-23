import { describe, expect, it } from "vitest";
import { buildPingMessage } from "./queueDisplayPingScheduler";

// The wording here is shared between the real "you're almost up" sweep and
// the settings UI's "send test ping" action (routes/queueDisplaySettings.ts)
// specifically so the two can never drift apart into different copy.

describe("buildPingMessage", () => {
  it("greets by first name when known", () => {
    expect(buildPingMessage({ roomTitle: "USG ROOM", roomKey: "usg", tokenLabel: "42", firstName: "Asha" }))
      .toBe("Hi, Asha! You're almost up at USG ROOM — token #42. Please make your way to the waiting area.");
  });

  it("omits the name entirely when unknown", () => {
    expect(buildPingMessage({ roomTitle: "USG ROOM", roomKey: "usg", tokenLabel: "42", firstName: null }))
      .toBe("Hi! You're almost up at USG ROOM — token #42. Please make your way to the waiting area.");
  });

  it("falls back to roomKey when roomTitle is unset", () => {
    expect(buildPingMessage({ roomTitle: null, roomKey: "xray", tokenLabel: "7" }))
      .toContain("almost up at xray —");
  });

  it("falls back to roomKey when roomTitle is an empty string", () => {
    expect(buildPingMessage({ roomTitle: "", roomKey: "reception", tokenLabel: "3" }))
      .toContain("almost up at reception —");
  });

  it("accepts a non-numeric token label (used by the test-ping action)", () => {
    expect(buildPingMessage({ roomTitle: "USG ROOM", roomKey: "usg", tokenLabel: "TEST" }))
      .toContain("token #TEST");
  });
});
