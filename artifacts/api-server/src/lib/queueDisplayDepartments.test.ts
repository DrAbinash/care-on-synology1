import { describe, expect, it } from "vitest";
import {
  inferDepartmentFromRoomKey,
  normalizeQueueDisplayRoomKey,
  resolveQueueDisplayDepartments,
} from "./queueDisplayDepartments";

describe("queueDisplayDepartments", () => {
  it("normalizes room keys with optional -room suffix", () => {
    expect(normalizeQueueDisplayRoomKey("usg-room")).toBe("usg");
    expect(normalizeQueueDisplayRoomKey("MRI")).toBe("mri");
  });

  it("infers token departments from common room keys", () => {
    expect(inferDepartmentFromRoomKey("usg")).toBe("USG");
    expect(inferDepartmentFromRoomKey("usg-room")).toBe("USG");
    expect(inferDepartmentFromRoomKey("mri")).toBe("MRI");
    expect(inferDepartmentFromRoomKey("ct")).toBe("CT");
    expect(inferDepartmentFromRoomKey("xray")).toBe("X-Ray");
    expect(inferDepartmentFromRoomKey("x-ray")).toBe("X-Ray");
    expect(inferDepartmentFromRoomKey("cardiology")).toBe("Cardiology");
    expect(inferDepartmentFromRoomKey("echo")).toBe("USG");
  });

  it("returns null for reception or unknown rooms", () => {
    expect(inferDepartmentFromRoomKey("reception")).toBeNull();
    expect(inferDepartmentFromRoomKey("lobby")).toBeNull();
  });

  it("prefers explicit departments over inference", () => {
    expect(resolveQueueDisplayDepartments("usg", "MRI,CT")).toEqual(["MRI", "CT"]);
  });

  it("infers USG for blank usg config so MRI tokens are excluded", () => {
    expect(resolveQueueDisplayDepartments("usg", "")).toEqual(["USG"]);
    expect(resolveQueueDisplayDepartments("usg", "   ")).toEqual(["USG"]);
  });

  it("keeps all departments only for unknown multi-dept rooms like reception", () => {
    expect(resolveQueueDisplayDepartments("reception", "")).toEqual([]);
  });
});
