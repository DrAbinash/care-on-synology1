// Shared active-gateway resolution — used by both the public online-booking
// flow (public-booking.ts) and the self-registration kiosk (kiosk.ts) so the
// two surfaces always agree on which gateway is "the" configured gateway for
// this clinic, following the same priority order and the same enabled +
// credentials-present checks.

export type ResolvedGateway = "razorpay" | "payu" | "phonepe" | "bharatpe" | "icici" | "hdfc" | null;

type GatewaySettings = {
  activePaymentGateway?: string | null;
  razorpayKeyId?: string | null;
  payuEnabled?: boolean | null;
  payuMerchantKey?: string | null;
  phonepeEnabled?: boolean | null;
  phonepeMerchantId?: string | null;
  bharatpeEnabled?: boolean | null;
  bharatpeMerchantId?: string | null;
  iciciEnabled?: boolean | null;
  iciciMerchantId?: string | null;
  iciciSecretKey?: string | null;
};

export function resolveActiveGateway(settings: GatewaySettings): ResolvedGateway {
  const razorpayKeyId = settings.razorpayKeyId || "";
  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET || "";
  const payuSalt = process.env.PAYU_MERCHANT_SALT || "";
  const payuKey = settings.payuMerchantKey || "";
  const phonepeSalt = process.env.PHONEPE_API_SECRET || "";
  const phonepeMerchantId = process.env.PHONEPE_MERCHANT_ID || settings.phonepeMerchantId || "";
  const bharatpeApiKey = process.env.BHARATPE_API_KEY || "";
  const bharatpeMerchantId = process.env.BHARATPE_MERCHANT_ID || settings.bharatpeMerchantId || "";
  const iciciMerchantId = process.env.ICICI_MERCHANT_ID || settings.iciciMerchantId || "";
  const iciciSecretKey = process.env.ICICI_SECRET_KEY || settings.iciciSecretKey || "";

  const configured = (settings.activePaymentGateway || "") as ResolvedGateway;

  // "hdfc" shares the ICICI-style card flow but isn't gated by iciciEnabled —
  // the existing kiosk config endpoint always treats it as available once
  // selected, so preserve that behavior here rather than introducing a new
  // "hdfcEnabled" flag that doesn't exist in the schema.
  if (configured === "hdfc") return "hdfc";
  if (configured === "icici" && settings.iciciEnabled && iciciMerchantId && iciciSecretKey) return "icici";
  if (configured === "bharatpe" && settings.bharatpeEnabled && bharatpeMerchantId && bharatpeApiKey) return "bharatpe";
  if (configured === "payu" && settings.payuEnabled && payuKey && payuSalt) return "payu";
  if (configured === "phonepe" && settings.phonepeEnabled && phonepeMerchantId && phonepeSalt) return "phonepe";
  if (configured === "razorpay" && razorpayKeyId && razorpaySecret) return "razorpay";

  // Configured gateway isn't usable (missing credentials/disabled) — fall
  // back to whichever gateway IS fully configured, same priority order the
  // online-booking config endpoint has always used.
  if (settings.iciciEnabled && iciciMerchantId && iciciSecretKey) return "icici";
  if (settings.bharatpeEnabled && bharatpeMerchantId && bharatpeApiKey) return "bharatpe";
  if (settings.payuEnabled && payuKey && payuSalt) return "payu";
  if (settings.phonepeEnabled && phonepeMerchantId && phonepeSalt) return "phonepe";
  if (razorpayKeyId && razorpaySecret) return "razorpay";
  return null;
}
