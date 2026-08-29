import { describe, expect, test } from "vitest";
import {
  DEFAULT_VIEWER_NETWORK_MODE,
  VIEWER_NETWORK_MODE_KEY,
  readViewerNetworkMode,
  writeViewerNetworkMode,
  embedNetworkModeOptions,
} from "./viewerNetworkPreference";

function memStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
}

describe("viewerNetworkPreference", () => {
  test("defaults to LAN when nothing stored", () => {
    expect(DEFAULT_VIEWER_NETWORK_MODE).toBe("LAN");
    expect(readViewerNetworkMode(memStorage())).toBe("LAN");
  });

  test("honours stored LAN / Tailscale / Auto", () => {
    expect(readViewerNetworkMode(memStorage({ [VIEWER_NETWORK_MODE_KEY]: "TAILSCALE" }))).toBe("TAILSCALE");
    expect(readViewerNetworkMode(memStorage({ [VIEWER_NETWORK_MODE_KEY]: "AUTO" }))).toBe("AUTO");
    expect(readViewerNetworkMode(memStorage({ [VIEWER_NETWORK_MODE_KEY]: "LAN" }))).toBe("LAN");
  });

  test("ignores garbage and falls back to LAN", () => {
    expect(readViewerNetworkMode(memStorage({ [VIEWER_NETWORK_MODE_KEY]: "WIFI" }))).toBe("LAN");
  });

  test("write persists and clears route cache", () => {
    const s = memStorage({ viewer_route_cache_v1: JSON.stringify({ mode: "TAILSCALE", baseUrl: "http://x", at: 1 }) });
    writeViewerNetworkMode("LAN", s);
    expect(s.getItem(VIEWER_NETWORK_MODE_KEY)).toBe("LAN");
    expect(s.getItem("viewer_route_cache_v1")).toBeNull();
  });

  test("embed options expose LAN first", () => {
    expect(embedNetworkModeOptions().map((o) => o.id)).toEqual(["LAN", "TAILSCALE", "AUTO"]);
  });
});
