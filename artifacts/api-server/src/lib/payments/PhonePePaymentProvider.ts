import crypto from "node:crypto";
import { PaymentProvider, InitiatePaymentParams, InitiatePaymentResult, VerifyPaymentParams, VerifyPaymentResult, CheckStatusParams, CheckStatusResult, RefundPaymentParams, RefundPaymentResult } from "./PaymentProvider";

const PHONEPE_PROD_BASE = "https://api.phonepe.com/apis/hermes";
const PHONEPE_STAGING_BASE = "https://api-preprod.phonepe.com/apis/hermes";

export class PhonePePaymentProvider implements PaymentProvider {
  id = "phonepe";
  displayName = "PhonePe";

  private config: {
    merchantId: string;
    saltKey: string;
    saltIndex: string;
    baseUrl: string;
  };

  constructor(config: {
    merchantId: string;
    saltKey: string;
    saltIndex?: string;
    baseUrl?: string;
  }) {
    this.config = {
      merchantId: config.merchantId,
      saltKey: config.saltKey,
      saltIndex: config.saltIndex || "1",
      baseUrl: config.baseUrl || (process.env.NODE_ENV === "production" ? PHONEPE_PROD_BASE : PHONEPE_STAGING_BASE),
    };
  }

  private phonepeXVerify(base64Payload: string, endpoint: string): string {
    const hash = crypto.createHash("sha256").update(base64Payload + endpoint + this.config.saltKey).digest("hex");
    return `${hash}###${this.config.saltIndex}`;
  }

  async initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    const amountPaise = Math.round(params.amount * 100);
    const redirectUrl = `${params.returnUrl.split("/api/")[0]}/?booking=phonepe_done&ref=${encodeURIComponent(params.bookingRef)}`;
    
    const payload = {
      merchantId: this.config.merchantId,
      merchantTransactionId: params.bookingRef,
      merchantUserId: `MUID-${params.phone.replace(/\D/g, "").slice(-10)}`,
      amount: amountPaise,
      callbackUrl: params.returnUrl,
      redirectMode: "REDIRECT",
      redirectUrl,
      mobileNumber: params.phone.replace(/\D/g, "").slice(-10),
      paymentInstrument: { type: "PAY_PAGE" },
    };

    const payloadStr = JSON.stringify(payload);
    const payloadBase64 = Buffer.from(payloadStr).toString("base64");
    const endpoint = "/pg/v1/pay";
    const xVerify = this.phonepeXVerify(payloadBase64, endpoint);

    try {
      const res = await fetch(`${this.config.baseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-VERIFY": xVerify },
        body: JSON.stringify({ request: payloadBase64 }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          success: false,
          rawResponse: errText,
          errorMessage: "PhonePe initiation failed",
        };
      }

      const data = (await res.json()) as any;
      if (!data.success || !data.data?.instrumentResponse?.redirectInfo?.url) {
        return {
          success: false,
          rawResponse: data,
          errorMessage: data.message || "Failed to initiate PhonePe payment",
        };
      }

      return {
        success: true,
        gatewayTxnId: params.bookingRef,
        redirectUrl: data.data.instrumentResponse.redirectInfo.url,
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
    const endpoint = `/pg/v1/status/${encodeURIComponent(this.config.merchantId)}/${encodeURIComponent(params.bookingRef)}`;
    const xVerify = this.phonepeXVerify("", endpoint);

    try {
      const res = await fetch(`${this.config.baseUrl}${endpoint}`, {
        method: "GET",
        headers: { Accept: "application/json", "X-VERIFY": xVerify, "X-MERCHANT-ID": this.config.merchantId },
      });
      const data = (await res.json()) as any;
      const state = data.data?.state || "";
      if (state === "COMPLETED" || data.data?.responseCode === "SUCCESS") {
        return {
          success: true,
          status: "paid",
          rawResponse: data,
        };
      }
      return {
        success: false,
        status: state === "PENDING" ? "pending" : "failed",
        rawResponse: data,
        errorMessage: data.message || `State: ${state}`,
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
    const endpoint = "/pg/v1/refund";
    const amountPaise = Math.round(params.amount * 100);

    const payload = {
      merchantId: this.config.merchantId,
      merchantTransactionId: params.bookingRef,
      originalTransactionId: params.gatewayTxnId,
      amount: amountPaise,
      callbackUrl: "", // optional
    };

    const payloadStr = JSON.stringify(payload);
    const payloadBase64 = Buffer.from(payloadStr).toString("base64");
    const xVerify = this.phonepeXVerify(payloadBase64, endpoint);

    try {
      const res = await fetch(`${this.config.baseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-VERIFY": xVerify, "X-MERCHANT-ID": this.config.merchantId },
        body: JSON.stringify({ request: payloadBase64 }),
      });
      const data = await res.json() as any;
      if (data.success) {
        return {
          success: true,
          refundTxnId: data.data?.transactionId || params.bookingRef,
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
