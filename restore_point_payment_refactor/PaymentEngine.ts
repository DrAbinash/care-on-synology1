import { db, clinicSettingsTable, paymentLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { PaymentProvider, InitiatePaymentParams, InitiatePaymentResult, VerifyPaymentParams, VerifyPaymentResult, CheckStatusParams, CheckStatusResult, RefundPaymentParams, RefundPaymentResult } from "./PaymentProvider";
import { IciciPaymentProvider } from "./IciciPaymentProvider";
import { PhonePePaymentProvider } from "./PhonePePaymentProvider";
import { BharatPePaymentProvider } from "./BharatPePaymentProvider";
import { PayUPaymentProvider } from "./PayUPaymentProvider";
import { RazorpayPaymentProvider } from "./RazorpayPaymentProvider";
import { CashfreePaymentProvider } from "./CashfreePaymentProvider";
import { logger } from "../logger";

export class PaymentEngine {
  static async getProvider(gatewayId?: string): Promise<PaymentProvider> {
    const [settings] = await db.select().from(clinicSettingsTable).where(eq(clinicSettingsTable.id, 1)).limit(1);
    const activeGateway = gatewayId || settings?.activePaymentGateway || "icici";

    switch (activeGateway) {
      case "icici":
        return new IciciPaymentProvider({
          merchantId: process.env.ICICI_MERCHANT_ID || settings?.iciciMerchantId || "",
          aggregatorId: process.env.ICICI_AGGREGATOR_ID || settings?.iciciAggregatorId || "",
          secretKey: process.env.ICICI_SECRET_KEY || settings?.iciciSecretKey || "",
          baseUrl: process.env.ICICI_BASE_URL || undefined,
          urlPrefix: process.env.ICICI_URL_PREFIX || undefined,
        });

      case "phonepe":
        return new PhonePePaymentProvider({
          merchantId: process.env.PHONEPE_MERCHANT_ID || settings?.phonepeMerchantId || "",
          saltKey: process.env.PHONEPE_API_SECRET || "",
          saltIndex: process.env.PHONEPE_SALT_INDEX || "1",
        });

      case "bharatpe":
        return new BharatPePaymentProvider({
          merchantId: process.env.BHARATPE_MERCHANT_ID || settings?.bharatpeMerchantId || "",
          apiKey: process.env.BHARATPE_API_KEY || "",
          apiSecret: process.env.BHARATPE_API_SECRET || "",
        });

      case "payu":
        return new PayUPaymentProvider({
          merchantKey: settings?.payuMerchantKey || "",
          merchantSalt: process.env.PAYU_MERCHANT_SALT || "",
        });

      case "razorpay":
        return new RazorpayPaymentProvider({
          keyId: settings?.razorpayKeyId || "",
          keySecret: process.env.RAZORPAY_KEY_SECRET || "",
        });

      case "cashfree":
        return new CashfreePaymentProvider({
          appId: settings?.cashfreeAppId || "",
          secretKey: process.env.CASHFREE_CLIENT_SECRET || "",
        });

      default:
        throw new Error(`Unsupported payment gateway: ${activeGateway}`);
    }
  }

  static async initiatePayment(gatewayId: string, params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    const provider = await this.getProvider(gatewayId);
    
    // Log Initiation Request to DB
    const [logRecord] = await db.insert(paymentLogsTable).values({
      bookingRef: params.bookingRef,
      patientName: params.name,
      gateway: provider.id,
      amount: String(params.amount),
      status: "initiated",
      requestPayload: JSON.stringify(params),
    }).returning({ id: paymentLogsTable.id });

    const result = await provider.initiatePayment(params);

    // Update Log Record with Gateway response/error
    await db.update(paymentLogsTable).set({
      status: result.success ? "initiated" : "failed",
      responsePayload: JSON.stringify(result.rawResponse),
      errorMessage: result.errorMessage || null,
    }).where(eq(paymentLogsTable.id, logRecord.id));

    return result;
  }

  static async verifyPayment(gatewayId: string, params: VerifyPaymentParams, patientName: string, amount: number): Promise<VerifyPaymentResult> {
    const provider = await this.getProvider(gatewayId);

    // Log Verification Request to DB
    const [logRecord] = await db.insert(paymentLogsTable).values({
      bookingRef: params.bookingRef,
      patientName,
      gateway: provider.id,
      amount: String(amount),
      status: "verifying",
      requestPayload: JSON.stringify(params),
    }).returning({ id: paymentLogsTable.id });

    const result = await provider.verifyPayment(params);

    // Update Log Record with Gateway response/error
    await db.update(paymentLogsTable).set({
      status: result.success && result.status === "paid" ? "success" : "failed",
      responsePayload: JSON.stringify(result.rawResponse),
      errorMessage: result.errorMessage || null,
    }).where(eq(paymentLogsTable.id, logRecord.id));

    return result;
  }
}
