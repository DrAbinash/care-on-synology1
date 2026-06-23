// Scanner adapter loader — picks the right driver.
// Each adapter must export: { status(), scan(), name }
export async function loadAdapter(vendor) {
  switch ((vendor || "mock").toLowerCase()) {
    case "wia":
      return (await import("./wia.js")).default;
    case "sane":
      return (await import("./sane.js")).default;
    case "folder-watch":
    case "folder":
      return (await import("./folder-watch.js")).default;
    case "mock":
    default:
      return (await import("./mock.js")).default;
  }
}
