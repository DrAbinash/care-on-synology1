/**
 * ICICI Orange Pay initiation — copied from webpage online booking
 * (POST /api/public/booking/icici-initiate). Bill Desk and other staff flows
 * call this helper so returnURL / domain normalization match booking exactly.
 *
 * Do NOT change public-booking.ts — keep webpage booking logic untouched.
 */
import { PaymentEngine } from "./PaymentEngine";
import { getIciciPublicBaseUrl } from "./iciciPublicBaseUrl";
import { normalizeIciciBaseUrl } from "./IciciPaymentProvider";
import { logger } from "../logger";
import type { InitiatePaymentParams, InitiatePaymentResult } from "./PaymentProvider";

/** Same callback path registered with ICICI for webpage online booking. */
export const ICICI_ORANGE_PAY_CALLBACK_PATH = "/api/public/booking/icici-callback";

export function buildIciciOrangePayReturnUrl(): string {
  const base = getIciciPublicBaseUrl();
  return `${base}${ICICI_ORANGE_PAY_CALLBACK_PATH}`;
}

export type InitiateIciciOrangePayOpts = {
  bookingRef: string;
  name: string;
  phone: string;
  email?: string;
  amount: number;
  activeGateway?: string;
  reqHeaders?: InitiatePaymentParams["reqHeaders"];
};

export async function initiateIciciOrangePayment(
  opts: InitiateIciciOrangePayOpts,
): Promise<InitiatePaymentResult & { returnUrl: string }> {
  const base = getIciciPublicBaseUrl();
  const returnUrl = buildIciciOrangePayReturnUrl();

  const iciciMerchantId = process.env.ICICI_MERCHANT_ID || "";
  const rawBase =
    process.env.ICICI_BASE_URL ||
    (process.env.NODE_ENV === "production" ? "https://pgpay.icicibank.com" : "https://pgpayuat.icicibank.com");
  const iciciBase = normalizeIciciBaseUrl(rawBase);
  const finalIciciInitiateUrl = `${iciciBase}/pg/api/v2/initiateSale`;

  logger.info(
    {
      publicBaseUrlUsed: base,
      finalReturnUrl: returnUrl,
      finalCallbackUrl: returnUrl,
      finalIciciInitiateUrl,
      merchantId: iciciMerchantId,
      bookingRef: opts.bookingRef,
    },
    "ICICI payment initiation safe check logs",
  );

  const activeGateway = opts.activeGateway || "icici";

  const result = await PaymentEngine.initiatePayment(activeGateway, {
    bookingRef: opts.bookingRef,
    name: opts.name.trim().toUpperCase(),
    phone: opts.phone.trim(),
    email: (opts.email || "").trim(),
    amount: opts.amount,
    returnUrl,
    reqHeaders: opts.reqHeaders,
  });

  return { ...result, returnUrl };
}
