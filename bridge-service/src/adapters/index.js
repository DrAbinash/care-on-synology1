// Adapter loader — picks the right vendor SDK driver.
// Each adapter must export: { status(), capture(), match(a, b), threshold }
//
// Contract is validated at load time so a half-implemented vendor adapter fails
// fast with a clear message instead of throwing an opaque error mid-punch.
const REQUIRED_METHODS = ["status", "capture", "match"];

export function validateAdapter(adapter, vendor) {
  if (!adapter || typeof adapter !== "object") {
    throw new Error(`Adapter "${vendor}" did not export a default adapter object`);
  }
  for (const m of REQUIRED_METHODS) {
    if (typeof adapter[m] !== "function") {
      throw new Error(`Adapter "${vendor}" is missing required method ${m}()`);
    }
  }
  if (typeof adapter.threshold !== "number" || Number.isNaN(adapter.threshold)) {
    throw new Error(`Adapter "${vendor}" is missing a numeric match threshold`);
  }
  return adapter;
}

export async function loadAdapter(vendor) {
  const name = (vendor || "mock").toLowerCase();
  let mod;
  switch (name) {
    case "zkteco":
      mod = await import("./zkteco.js");
      break;
    case "mantra":
      mod = await import("./mantra.js");
      break;
    case "morpho":
      mod = await import("./morpho.js");
      break;
    case "mock":
    default:
      mod = await import("./mock.js");
      break;
  }
  return validateAdapter(mod.default, name);
}
