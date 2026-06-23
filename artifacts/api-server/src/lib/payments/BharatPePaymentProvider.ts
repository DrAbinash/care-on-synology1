import crypto from "node:crypto";
import { PaymentProvider, InitiatePaymentParams, InitiatePaymentResult, VerifyPaymentParams, VerifyPaymentResult, CheckStatusParams, CheckStatusResult, RefundPaymentParams, RefundPaymentResult } from "./PaymentProvider";

const BHARATPE_PROD_BASE = "https://api.bharatpe.in/api/v1";
const BHARATPE_STAGING_BASE = "https://uat-api.bharatpe.in/api/v1";

export class BharatPePaymentProvider implements PaymentProvider {
  id = "bharatpe";
  displayName = "BharatPe";

  private config: {
    merchantId: string;
    apiKey: string;
    apiSecret: string;
    baseUrl: string;
  };

  constructor(config: {
    merchantId: string;
    apiKey: string;
    apiSecret: string;
    baseUrl?: string;
  }) {
    this.config = {
      merchantId: config.merchantId,
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      baseUrl: config.baseUrl || (process.env.NODE_ENV === "production" ? BHARATPE_PROD_BASE : BHARATPE_STAGING_BASE),
    };
  }

  private generateAuthToken(): string {
    const timestamp = String(Date.now());
    const authPayload = `${this.config.merchantId}:${timestamp}`;
    const authHash = crypto.createHmac("sha256", this.config.apiSecret).update(authPayload).digest("hex");
    return `${this.config.apiKey}:${authHash}:${timestamp}`;
  }

  async initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    const amountPaise = Math.round(params.amount * 100);
    const redirectUrl = `${params.returnUrl.split("/api/")[0]}/?booking=bharatpe_done&ref=${encodeURIComponent(params.bookingRef)}`;
    const authToken = this.generateAuthToken();

    try {
      const res = await fetch(`${this.config.baseUrl}/merchant/checkout/init`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-API-KEY": this.config.apiKey,
          "X-MERCHANT-ID": this.config.merchantId,
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          merchantId: this.config.merchantId,
          merchantTransactionId: params.bookingRef,
          amount: amountPaise,
          currency: "INR",
          customerName: params.name,
          customerMobile: params.phone.replace(/\D/g, "").slice(-10),
          customerEmail: params.email?.trim() || "",
          description: `Care Diagnostics booking ${params.bookingRef}`,
          callbackUrl: params.returnUrl,
          redirectUrl,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          success: false,
          rawResponse: errText,
          errorMessage: "BharatPe initiation failed",
        };
      }

      const data = (await res.json()) as any;
      if (!data.success || !data.data?.redirectUrl) {
        return {
          success: false,
          rawResponse: data,
          errorMessage: data.message || "Failed to initiate BharatPe payment",
        };
      }

      return {
        success: true,
        gatewayTxnId: params.bookingRef,
        redirectUrl: data.data.redirectUrl,
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        success: false,
        rawResponse: null,
        errorMessage: err.message,
      };
    }
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const statusResult = await this.checkStatus({ bookingRef: params.bookingRef });
    if (statusResult.success && statusResult.status === "paid") {
      return {
        success: true,
        status: "paid",
        gatewayTxnId: params.bookingRef,
        rawResponse: statusResult.rawResponse,
      };
    }
    return {
      success: false,
      status: statusResult.status,
      errorMessage: statusResult.errorMessage,
      rawResponse: statusResult.rawResponse,
    };
  }

  async checkStatus(params: CheckStatusParams): Promise<CheckStatusResult> {
    const authToken = this.generateAuthToken();

    try {
      const res = await fetch(`${this.config.baseUrl}/merchant/transaction/${encodeURIComponent(params.bookingRef)}/status`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-API-KEY": this.config.apiKey,
          "X-MERCHANT-ID": this.config.merchantId,
          Authorization: `Bearer ${authToken}`,
        },
      });
      const data = (await res.json()) as any;
      if (data.data?.status === "SUCCESS") {
        return {
          success: true,
          status: "paid",
          rawResponse: data,
        };
      }
      return {
        success: false,
        status: "failed",
        rawResponse: data,
        errorMessage: data.message || "Transaction failed",
      };
    } catch (err: any) {
      return {
        success: false,
        status: "pending",
        rawResponse: null,
        errorMessage: err.message,
      };
    }
  }

  async refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult> {
    const authToken = this.generateAuthToken();
    const amountPaise = Math.round(params.amount * 100);

    try {
      const res = await fetch(`${this.config.baseUrl}/merchant/transaction/refund`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-API-KEY": this.config.apiKey,
          "X-MERCHANT-ID": this.config.merchantId,
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          merchantId: this.config.merchantId,
          merchantTransactionId: params.bookingRef,
          originalTransactionId: params.gatewayTxnId,
          amount: amountPaise,
        }),
      });
      const data = await res.json() as any;
      if (data.success) {
        return {
          success: true,
          refundTxnId: data.data?.refundTransactionId || params.bookingRef,
          rawResponse: data,
        };
      }
      return {
        success: false,
        rawResponse: data,
        errorMessage: data.message || "Refund failed",
      };
    } catch (err: any) {
      return {
        success: false,
        rawResponse: null,
        errorMessage: err.message,
      };
    }
  }
}
