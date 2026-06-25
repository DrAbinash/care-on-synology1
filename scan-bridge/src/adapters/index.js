import wia from "./wia.js";
import sane from "./sane.js";
import folderWatch from "./folder-watch.js";
import mock from "./mock.js";

// Scanner adapter loader — picks the right driver.
// Each adapter must export: { status(), scan(), name }
export async function loadAdapter(vendor) {
  switch ((vendor || "mock").toLowerCase()) {
    case "wia":
      return wia;
    case "sane":
      return sane;
    case "folder-watch":
    case "folder":
      return folderWatch;
    case "mock":
    default:
      return mock;
  }
}
