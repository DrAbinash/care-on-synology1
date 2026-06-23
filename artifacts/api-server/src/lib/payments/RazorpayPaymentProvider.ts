import { PaymentProvider, InitiatePaymentParams, InitiatePaymentResult, VerifyPaymentParams, VerifyPaymentResult, CheckStatusParams, CheckStatusResult, RefundPaymentParams, RefundPaymentResult } from "./PaymentProvider";

export class RazorpayPaymentProvider implements PaymentProvider {
  id = "razorpay";
  displayName = "Razorpay";

  constructor(config: { keyId: string; keySecret?: string }) {}

  async initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    return {
      success: false,
      rawResponse: null,
      errorMessage: "Razorpay provider is a placeholder under refactor.",
    };
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    return {
      success: false,
      status: "failed",
      rawResponse: null,
      errorMessage: "Razorpay verification not implemented.",
    };
  }

  async checkStatus(params: CheckStatusParams): Promise<CheckStatusResult> {
    return {
      success: false,
      status: "pending",
      rawResponse: null,
    };
  }

  async refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult> {
    return {
      success: false,
      rawResponse: null,
    };
  }
}
