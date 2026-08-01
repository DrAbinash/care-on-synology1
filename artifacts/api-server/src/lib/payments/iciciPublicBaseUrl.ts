/**
 * ICICI Orange Pay requires return/callback URLs on the bank-whitelisted
 * production domain (https://caredeoghar.com). LAN/NAS/ERP subdomains must not
 * leak into initiateSale payloads — same normalization as webpage online booking.
 */
export function getIciciPublicBaseUrl(): string {
  let base = (process.env.PUBLIC_BASE_URL || process.env.BASE_URL || "https://caredeoghar.com").trim();

  base = base.replace(/\/+$/, "");

  const needsCanonical =
    base.includes("localhost") ||
    base.includes("127.0.0.1") ||
    base.includes("192.168.") ||
    base.includes("172.1") ||
    base.includes("172.2") ||
    base.includes("172.3") ||
    base.includes("10.") ||
    base.includes("100.") ||
    base.includes("synology") ||
    base.includes("tailscale") ||
    base.includes(":8888") ||
    base.includes("/erp") ||
    base.includes("quickconnect.to") ||
    base.includes("erp.caredeoghar.com") ||
    base.includes("web.caredeoghar.com") ||
    base.includes("www.caredeoghar.com") ||
    !base.startsWith("https://caredeoghar.com");

  if (needsCanonical) {
    base = "https://caredeoghar.com";
  }

  if (base.startsWith("http://")) {
    base = base.replace("http://", "https://");
  } else if (!base.startsWith("https://")) {
    base = `https://${base}`;
  }

  return base;
}
