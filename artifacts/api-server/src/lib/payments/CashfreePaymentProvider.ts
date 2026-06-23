import { PaymentProvider, InitiatePaymentParams, InitiatePaymentResult, VerifyPaymentParams, VerifyPaymentResult, CheckStatusParams, CheckStatusResult, RefundPaymentParams, RefundPaymentResult } from "./PaymentProvider";

export class CashfreePaymentProvider implements PaymentProvider {
  id = "cashfree";
  displayName = "Cashfree";

  constructor(config: { appId: string; secretKey?: string }) {}

  async initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    return {
      success: false,
      rawResponse: null,
      errorMessage: "Cashfree provider is a placeholder under refactor.",
    };
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    return {
      success: false,
      status: "failed",
      rawResponse: null,
      errorMessage: "Cashfree verification not implemented.",
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
