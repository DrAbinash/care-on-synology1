import { PaymentProvider, InitiatePaymentParams, InitiatePaymentResult, VerifyPaymentParams, VerifyPaymentResult, CheckStatusParams, CheckStatusResult, RefundPaymentParams, RefundPaymentResult } from "./PaymentProvider";
import { logger } from "../logger";

export class HdfcPaymentProvider implements PaymentProvider {
  id = "hdfc";
  displayName = "HDFC Bank SmartGateway";

  private config: {
    merchantId: string;
    secretKey: string;
    baseUrl?: string;
  };

  constructor(config: {
    merchantId: string;
    secretKey: string;
    baseUrl?: string;
  }) {
    this.config = config;
    logger.info({ merchantId: config.merchantId }, "HDFC Bank SmartGateway provider initialized");
  }

  async initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    logger.info({ bookingRef: params.bookingRef, amount: params.amount }, "Initiating HDFC PG payment (Mock/Placeholder Mode)");
    
    // For now, return a mock redirect URL that will redirect to a simulated payment page
    // or return a success link that redirects to the callback URL immediately for testing.
    const redirectUrl = `${params.returnUrl}?merchantTxnNo=${params.bookingRef}&status=SUCCESS&amount=${params.amount}`;
    
    return {
      success: true,
      gatewayTxnId: params.bookingRef,
      redirectUrl,
      rawResponse: { message: "HDFC placeholder initiation successful", ref: params.bookingRef },
    };
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    logger.info({ bookingRef: params.bookingRef }, "Verifying HDFC PG payment");
    return {
      success: true,
      status: "paid",
      gatewayTxnId: params.bookingRef,
      providerRefId: "HDFC-MOCK-REF-" + Math.random().toString(36).slice(2, 7).toUpperCase(),
      rawResponse: params.payload,
    };
  }

  async checkStatus(params: CheckStatusParams): Promise<CheckStatusResult> {
    logger.info({ bookingRef: params.bookingRef }, "Checking HDFC PG transaction status");
    return {
      success: true,
      status: "paid",
      rawResponse: { status: "SUCCESS" },
    };
  }

  async refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult> {
    logger.info({ bookingRef: params.bookingRef, amount: params.amount }, "Refunding HDFC PG transaction");
    return {
      success: true,
      refundTxnId: "HDFC-REFUND-MOCK-" + Math.random().toString(36).slice(2, 7).toUpperCase(),
      rawResponse: { status: "REFUNDED" },
    };
  }
}
