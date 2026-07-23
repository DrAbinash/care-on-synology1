import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_SOURCES,
  dbSourceFor,
  isKnownSourceKind,
  toAttendanceEvent,
  type AttendanceSourceKind,
} from "./attendanceSource";

describe("attendance source registry", () => {
  it("registers every source kind consistently (key === descriptor.kind)", () => {
    for (const [key, desc] of Object.entries(ATTENDANCE_SOURCES)) {
      expect(desc.kind).toBe(key);
      expect(desc.dbSource.length).toBeGreaterThan(0);
    }
  });

  it("maps the three existing db source strings for the current live/dormant kinds", () => {
    expect(dbSourceFor("manual")).toBe("manual");
    expect(dbSourceFor("webauthn")).toBe("fingerprint");
    expect(dbSourceFor("usb_bridge")).toBe("usb-bridge");
  });

  it("marks the USB bridge dormant and offline-capable (not rewritten, just abstracted)", () => {
    expect(ATTENDANCE_SOURCES.usb_bridge.status).toBe("dormant");
    expect(ATTENDANCE_SOURCES.usb_bridge.offlineCapable).toBe(true);
  });

  it("includes the owner's future roadmap sources", () => {
    const kinds: AttendanceSourceKind[] = [
      "fingerprint_device",
      "csv_import",
      "api_import",
      "face_recognition",
      "rfid",
      "mobile_gps",
    ];
    for (const k of kinds) expect(ATTENDANCE_SOURCES[k].status).toBe("planned");
  });

  it("recognises known kinds and rejects unknown ones", () => {
    expect(isKnownSourceKind("usb_bridge")).toBe(true);
    expect(isKnownSourceKind("telepathy")).toBe(false);
  });
});

describe("toAttendanceEvent", () => {
  it("normalizes every source to the same canonical shape", () => {
    const ev = toAttendanceEvent({
      source: "usb_bridge",
      subjectRef: { kind: "template_id", value: "42" },
      timestamp: "2026-07-23T09:01:00+05:30",
      direction: "in",
      deviceId: "reception-1",
      score: 91,
      dedupeKey: "reception-1:42:2026-07-23T09:01:00+05:30",
    });
    expect(ev.source).toBe("usb_bridge");
    expect(ev.direction).toBe("in");
    expect(ev.subjectRef).toEqual({ kind: "template_id", value: "42" });
    expect(ev.dedupeKey).toBe("reception-1:42:2026-07-23T09:01:00+05:30");
  });

  it("defaults direction to 'unknown' when not provided", () => {
    const ev = toAttendanceEvent({
      source: "csv_import",
      subjectRef: { kind: "biometric_user_id", value: "E-100" },
      timestamp: "2026-07-23T09:00:00Z",
    });
    expect(ev.direction).toBe("unknown");
  });
});
