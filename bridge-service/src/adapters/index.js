// Adapter loader — picks the right vendor SDK driver.
// Each adapter must export: { status(), capture(), match(a, b), threshold }
export async function loadAdapter(vendor) {
  switch ((vendor || "mock").toLowerCase()) {
    case "zkteco":
      return (await import("./zkteco.js")).default;
    case "mantra":
      return (await import("./mantra.js")).default;
    case "morpho":
      return (await import("./morpho.js")).default;
    case "mock":
    default:
      return (await import("./mock.js")).default;
  }
}
