import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression suite for the OHIF launch gate in viewerService.ts.
 *
 * The defect this pins: launchViewer() required services.orthancHttp to be GREEN,
 * but that leg is a BROWSER-side probe of an internal HTTP endpoint
 * (http://<orthanc-host>:8042/system). From CARE's public HTTPS origin the browser
 * refuses to make that request at all (Mixed Content), so the leg reads RED on every
 * launch while the OHIF viewer CARE is about to open is perfectly reachable — and the
 * radiologist was shown the diagnostic overlay instead of their images.
 *
 * The fetch shim below encodes that browser rule instead of hand-picking statuses, so
 * a launch cannot "pass" just because a mock was kind.
 */

const STUDY_UID = "1.2.840.113619.2.55.3.2565012555.1234567890";
const LAN_ORTHANC = "http://172.16.1.139:8042";
const OHIF_REACHABLE = "https://ohif.caredeoghar.com";
const OHIF_UNREACHABLE = "https://ohif-dead.caredeoghar.com";

interface Harness {
  opened: string[][];
  overlays: string[];
  toasts: { title: string; description?: string; variant?: string }[];
  fetchUrls: string[];
  storage: Record<string, string>;
}

let harness: Harness;
let ohifBase = OHIF_REACHABLE;
const globalsSaved = new Map<string, unknown>();
const SHIMMED = ["window", "document", "localStorage", "fetch"];

/** Node 24 defines some of these as getter-only accessors, so plain assignment throws. */
function setGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function installBrowser({
  pageOrigin,
  profileOverride,
  failOrthanc = false,
  blockOhif = false,
}: {
  pageOrigin: string;
  profileOverride: "LAN" | "TAILSCALE" | "PUBLIC";
  failOrthanc?: boolean;
  blockOhif?: boolean;
}) {
  harness = { opened: [], overlays: [], toasts: [], fetchUrls: [], storage: { pacs_network_profile: profileOverride } };

  const localStorage = {
    getItem: (k: string) => harness.storage[k] ?? null,
    setItem: (k: string, v: string) => {
      harness.storage[k] = String(v);
    },
    removeItem: (k: string) => {
      delete harness.storage[k];
    },
    clear: () => {
      harness.storage = {};
    },
  };

  const window = {
    location: { origin: pageOrigin, href: `${pageOrigin}/erp/` },
    localStorage,
    open: (url: string, target?: string) => {
      harness.opened.push([url, String(target)]);
      return null;
    },
  };

  // The overlay only needs element ids back; null answers are safe (its callers use ?.).
  const document = {
    getElementById: () => null,
    createElement: () => ({
      id: "",
      className: "",
      innerHTML: "",
      style: {},
      remove: () => {},
      addEventListener: () => {},
    }),
    body: {
      appendChild: (el: { id?: string; innerHTML?: string }) => {
        if (el?.id === "pacs-diagnostic-overlay") harness.overlays.push(String(el.innerHTML));
      },
    },
  };

  const fetchImpl = async (input: unknown) => {
    const url = String(input);
    harness.fetchUrls.push(url);
    // The browser rule under test: a secure page cannot fetch an insecure subresource.
    if (pageOrigin.startsWith("https://") && url.startsWith("http://")) throw new TypeError("Failed to fetch");
    if (failOrthanc && url.startsWith(LAN_ORTHANC)) throw new TypeError("Failed to fetch");
    // The readiness probe rewrites known hosts internally, so the dead viewer is matched by name.
    if (blockOhif && url.includes("ohif-dead")) throw new TypeError("Failed to fetch");
    return { ok: true, status: 200 } as Response;
  };

  for (const name of SHIMMED) {
    if (!globalsSaved.has(name)) globalsSaved.set(name, (globalThis as any)[name]);
  }
  setGlobal("window", window);
  setGlobal("document", document);
  setGlobal("localStorage", localStorage);
  setGlobal("fetch", vi.fn(fetchImpl));
}

function settings(): Record<string, string> {
  return {
    ohif_base_url: ohifBase,
    ohif_study_url_template: "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}",
    viewer_open_mode: "NEW_TAB",
    network_lan_host: "172.16.1.139",
    network_tailscale_host: "100.65.255.115",
    network_public_domain: "caredeoghar.com",
    orthanc_http_port: "8042",
    ohif_http_port: "3010",
  };
}

const toast = () => (options: { title: string; description?: string; variant?: "default" | "destructive" }) => {
  harness.toasts.push(options);
};

async function launch(uid: string | null | undefined, viewerType: "OHIF" | "WEASIS" = "OHIF") {
  const mod = await import("./viewerService");
  await mod.launchViewer(uid, viewerType, settings(), toast());
}

afterEach(() => {
  for (const [name, value] of globalsSaved) {
    if (value === undefined) delete (globalThis as any)[name];
    else setGlobal(name, value);
  }
  globalsSaved.clear();
  vi.resetModules();
  ohifBase = OHIF_REACHABLE;
});

describe("launch gate on the public HTTPS origin", () => {
  beforeEach(() => {
    ohifBase = OHIF_REACHABLE;
    installBrowser({ pageOrigin: "https://caredeoghar.com", profileOverride: "PUBLIC" });
  });

  it("T1 opens OHIF when the viewer is reachable, although the Orthanc HTTP probe is browser-blocked", async () => {
    await launch(STUDY_UID);

    expect(harness.opened).toEqual([
      [`https://ohif.caredeoghar.com/viewer?StudyInstanceUIDs=${encodeURIComponent(STUDY_UID)}`, "_blank"],
    ]);
    expect(harness.overlays).toEqual([]);
    expect(harness.toasts).toEqual([]);
    expect(harness.storage["pacs_last_good_endpoint"]).toContain(`StudyInstanceUIDs=${encodeURIComponent(STUDY_UID)}`);
    expect(harness.storage["pacs_last_failed_time"]).toBeUndefined();
  });

  it("T2 keeps probing Orthanc and keeps reporting its state — the veto is gone, the diagnostic is not", async () => {
    const mod = await import("./viewerService");
    const services = await mod.checkViewerServices(STUDY_UID, "caredeoghar.com", settings());

    expect(services.orthancHttp.status).toBe("red");
    expect(services.orthancHttp.name).toBe("Orthanc HTTP REST");
    expect(services.orthancHttp.endpoint).toBe("http://caredeoghar.com:8042/system");
    expect(services.dicomWeb.status).toBe("red");
    expect(services.wado.status).toBe("red");
    expect(services.ohif.status).toBe("green");
    // No readiness leg was dropped from the panel.
    expect(Object.keys(services).sort()).toEqual([
      "conquest",
      "dicomWeb",
      "erp",
      "internalApi",
      "ohif",
      "orthancHttp",
      "wado",
      "weasis",
    ]);
  });

  it("T3 still blocks and still diagnoses when OHIF itself is unreachable", async () => {
    ohifBase = OHIF_UNREACHABLE;
    installBrowser({ pageOrigin: "https://caredeoghar.com", profileOverride: "PUBLIC", blockOhif: true });

    await launch(STUDY_UID);

    expect(harness.opened).toEqual([]);
    expect(harness.overlays).toHaveLength(1);
    expect(harness.overlays[0]).toContain("Orthanc HTTP REST");
    expect(harness.overlays[0]).toContain("DICOMweb Metadata Retrieve");
    expect(harness.overlays[0]).toContain("OHIF Base Endpoint");
    expect(harness.storage["pacs_last_failed_status"]).toBe("Unreachable");
  });

  it("T4 refuses an empty, blank, null or missing study UID before touching the network", async () => {
    for (const missing of ["", "   ", null, undefined]) {
      harness.fetchUrls.length = 0;
      harness.opened.length = 0;
      harness.overlays.length = 0;
      harness.toasts.length = 0;

      await launch(missing);

      expect(harness.toasts.map((t) => t.title)).toEqual(["Study UID missing. Cannot open viewer."]);
      expect(harness.toasts[0].variant).toBe("destructive");
      expect(harness.opened).toEqual([]);
      expect(harness.overlays).toEqual([]);
      expect(harness.fetchUrls).toEqual([]);
    }
  });

  it("T5 launches exactly the UID it was given — no other study can ride along", async () => {
    const other = "1.3.6.1.4.1.5962.999.1.1";
    await launch(other);

    expect(harness.opened[0][0]).toBe(
      `https://ohif.caredeoghar.com/viewer?StudyInstanceUIDs=${encodeURIComponent(other)}`
    );
    expect(harness.opened[0][0]).not.toContain(STUDY_UID);
  });

  it("T6 records the successful launch against the viewer it opened", async () => {
    await launch(STUDY_UID);

    expect(harness.storage["pacs_last_good_viewer"]).toBe("OHIF");
    expect(harness.storage["pacs_last_good_profile"]).toBe("PUBLIC");
  });
});

describe("launch gate on the clinic LAN", () => {
  it("T7 unchanged: Orthanc and OHIF both reachable, launch proceeds to the LAN viewer", async () => {
    ohifBase = "http://172.16.1.139:3010";
    installBrowser({ pageOrigin: "http://172.16.1.139:8888", profileOverride: "LAN" });
    ohifBase = "http://172.16.1.139:3010";

    await launch(STUDY_UID);

    expect(harness.opened).toEqual([
      [`http://172.16.1.139:3010/viewer?StudyInstanceUIDs=${encodeURIComponent(STUDY_UID)}`, "_blank"],
    ]);
    expect(harness.overlays).toEqual([]);
    expect(harness.fetchUrls).toContain(`${LAN_ORTHANC}/system`);
  });

  it("T8 an Orthanc that is genuinely down no longer vetoes a reachable viewer", async () => {
    installBrowser({
      pageOrigin: "http://172.16.1.139:8888",
      profileOverride: "LAN",
      failOrthanc: true,
    });
    ohifBase = "http://172.16.1.139:3010";

    await launch(STUDY_UID);

    expect(harness.opened).toHaveLength(1);
    expect(harness.overlays).toEqual([]);
    // The failed leg is still measured, so the readiness panel still shows it.
    expect(harness.fetchUrls).toContain(`${LAN_ORTHANC}/system`);
  });
});
