import crypto from "node:crypto";
import { PaymentProvider, InitiatePaymentParams, InitiatePaymentResult, VerifyPaymentParams, VerifyPaymentResult, CheckStatusParams, CheckStatusResult, RefundPaymentParams, RefundPaymentResult } from "./PaymentProvider";
import { logger } from "../logger";

const ICICI_UAT_BASE = "https://pgpayuat.icicibank.com";
const ICICI_PROD_BASE = "https://pgpay.icicibank.com";

export class IciciPaymentProvider implements PaymentProvider {
  id = "icici";
  displayName = "ICICI Orange Pay";

  private config: {
    merchantId: string;
    aggregatorId: string;
    secretKey: string;
    baseUrl: string;
    urlPrefix: string;
  };

  constructor(config: {
    merchantId: string;
    aggregatorId: string;
    secretKey: string;
    baseUrl?: string;
    urlPrefix?: string;
  }) {
    this.config = {
      merchantId: config.merchantId,
      aggregatorId: config.aggregatorId,
      secretKey: config.secretKey,
      baseUrl: config.baseUrl || (process.env.NODE_ENV === "production" ? ICICI_PROD_BASE : ICICI_UAT_BASE),
      urlPrefix: config.urlPrefix !== undefined ? config.urlPrefix : "/tsp",
    };
  }

  private getNormalizedPrefix(): string {
    const prefix = this.config.urlPrefix;
    if (!prefix) return "";
    const start = prefix.startsWith("/") ? "" : "/";
    const end = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return `${start}${end}`;
  }

  private generateIciciSecureHash(params: Record<string, string>): string {
    const keys = Object.keys(params).sort();
    const hashText = keys.map((k) => params[k]).join("");
    return crypto.createHmac("sha256", this.config.secretKey).update(hashText).digest("hex");
  }

  private formatTxnDate(d = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  async initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    const txnDate = this.formatTxnDate();
    const amountStr = params.amount.toFixed(2);
    const mobile = params.phone.replace(/\D/g, "").slice(-10);

    const hashParams: Record<string, string> = {
      addlParam1: params.bookingRef,
      addlParam2: "care-diagnostics",
      aggregatorID: this.config.aggregatorId,
      amount: amountStr,
      currencyCode: "356",
      customerEmailID: params.email?.trim() || "care.deoghar@gmail.com",
      customerMobileNo: mobile,
      customerName: params.name,
      merchantId: this.config.merchantId,
      merchantTxnNo: params.bookingRef,
      payType: "0",
      returnURL: params.returnUrl,
      transactionType: "SALE",
      txnDate,
    };
    const secureHash = this.generateIciciSecureHash(hashParams);

    const payload = {
      merchantId: this.config.merchantId,
      aggregatorID: this.config.aggregatorId,
      merchantTxnNo: params.bookingRef,
      amount: amountStr,
      currencyCode: "356",
      payType: "0",
      customerEmailID: params.email?.trim() || "care.deoghar@gmail.com",
      transactionType: "SALE",
      returnURL: params.returnUrl,
      txnDate,
      customerMobileNo: mobile,
      customerName: params.name,
      addlParam1: params.bookingRef,
      addlParam2: "care-diagnostics",
      secureHash,
    };

    const prefix = this.getNormalizedPrefix();
    const iciciUrl = `${this.config.baseUrl}${prefix}/pg/api/v2/initiateSale`;

    try {
      const res = await fetch(iciciUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const resText = await res.text();
      let iciciData: any = {};
      try {
        if (resText.trim().startsWith("{")) {
          iciciData = JSON.parse(resText);
        }
      } catch {}

      if (!res.ok || !iciciData.tranCtx || iciciData.responseCode !== "R1000") {
        return {
          success: false,
          rawResponse: iciciData,
          errorMessage: iciciData.respDescription || iciciData.responseCode || `HTTP ${res.status}`,
        };
      }

      const redirectTo = `${iciciData.redirectURI}?tranCtx=${encodeURIComponent(iciciData.tranCtx)}`;
      return {
        success: true,
        gatewayTxnId: params.bookingRef,
        redirectUrl: redirectTo,
        rawResponse: iciciData,
      };
    } catch (err: any) {
      return {
        success: false,
        rawResponse: null,
        errorMessage: err.message || "Failed to connect to ICICI PG",
      };
    }
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const { merchantTxnNo, responseCode, status, txnID, respDescription } = params.payload;
    const bookingRef = merchantTxnNo || params.bookingRef;

    const statusCheck = await this.checkStatus({ bookingRef });
    if (statusCheck.success && statusCheck.status === "paid") {
      return {
        success: true,
        status: "paid",
        gatewayTxnId: bookingRef,
        providerRefId: txnID,
        rawResponse: statusCheck.rawResponse,
      };
    }

    const successCodes = ["0000", "000", "success", "SUCCESS", "SUC", "TXN_SUCCESS"];
    const isSuccessByCode = successCodes.includes(responseCode) || successCodes.includes(status);
    if (isSuccessByCode) {
      return {
        success: true,
        status: "paid",
        gatewayTxnId: bookingRef,
        providerRefId: txnID,
        rawResponse: params.payload,
      };
    }

    return {
      success: false,
      status: "failed",
      errorMessage: respDescription || "Payment failed",
      rawResponse: params.payload,
    };
  }

  async checkStatus(params: CheckStatusParams): Promise<CheckStatusResult> {
    const statusHashParams: Record<string, string> = {
      aggregatorID: this.config.aggregatorId,
      merchantId: this.config.merchantId,
      merchantTxnNo: params.bookingRef,
      originalTxnNo: params.bookingRef,
      transactionType: "STATUS",
    };
    const statusHash = this.generateIciciSecureHash(statusHashParams);
    const prefix = this.getNormalizedPrefix();

    try {
      const statusRes = await fetch(`${this.config.baseUrl}${prefix}/pg/api/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          merchantId: this.config.merchantId,
          aggregatorID: this.config.aggregatorId,
          merchantTxnNo: params.bookingRef,
          originalTxnNo: params.bookingRef,
          transactionType: "STATUS",
          secureHash: statusHash,
        }),
      });
      const statusData = (await statusRes.json()) as any;
      if (statusData.txnStatus === "SUC" || statusData.txnResponseCode === "0000" || statusData.responseCode === "000") {
        return {
          success: true,
          status: "paid",
          rawResponse: statusData,
        };
      }
      return {
        success: false,
        status: "failed",
        rawResponse: statusData,
        errorMessage: statusData.respDescription || "Transaction not found or failed",
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
    // Basic refund placeholder matching ICICI standard structure
    const refundHashParams: Record<string, string> = {
      aggregatorID: this.config.aggregatorId,
      merchantId: this.config.merchantId,
      merchantTxnNo: params.bookingRef,
      originalTxnNo: params.gatewayTxnId,
      amount: params.amount.toFixed(2),
      transactionType: "REFUND",
    };
    const refundHash = this.generateIciciSecureHash(refundHashParams);
    const prefix = this.getNormalizedPrefix();

    try {
      const res = await fetch(`${this.config.baseUrl}${prefix}/pg/api/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          merchantId: this.config.merchantId,
          aggregatorID: this.config.aggregatorId,
          merchantTxnNo: params.bookingRef,
          originalTxnNo: params.gatewayTxnId,
          amount: params.amount.toFixed(2),
          transactionType: "REFUND",
          secureHash: refundHash,
        }),
      });
      const data = (await res.json()) as any;
      if (data.responseCode === "R1000" || data.status === "SUC") {
        return {
          success: true,
          refundTxnId: data.txnID || params.bookingRef,
          rawResponse: data,
        };
      }
      return {
        success: false,
        rawResponse: data,
        errorMessage: data.respDescription || "Refund failed",
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
