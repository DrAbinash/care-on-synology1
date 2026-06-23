import crypto from "node:crypto";
import { PaymentProvider, InitiatePaymentParams, InitiatePaymentResult, VerifyPaymentParams, VerifyPaymentResult, CheckStatusParams, CheckStatusResult, RefundPaymentParams, RefundPaymentResult } from "./PaymentProvider";
import { logger } from "../logger";

const ICICI_UAT_BASE = "https://pgpayuat.icicibank.com";
const ICICI_PROD_BASE = "https://pgpay.icicibank.com";

export function normalizeIciciBaseUrl(input?: string): string {
  return (input || "https://pgpay.icicibank.com")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/pg\/api\/v2$/i, "")
    .replace(/\/pg\/api$/i, "");
}

export class IciciPaymentProvider implements PaymentProvider {
  id = "icici";
  displayName = "ICICI Orange Pay";

  private config: {
    merchantId: string;
    aggregatorId: string;
    secretKey: string;
    baseUrl: string;
  };

  constructor(config: {
    merchantId: string;
    aggregatorId: string;
    secretKey: string;
    baseUrl?: string;
    urlPrefix?: string;
  }) {
    const rawBaseUrl = config.baseUrl || (process.env.NODE_ENV === "production" ? ICICI_PROD_BASE : ICICI_UAT_BASE);
    const normalized = normalizeIciciBaseUrl(rawBaseUrl);

    // Safe log in constructor
    logger.info({
      rawBaseUrl,
      normalizedBaseUrl: normalized,
      urlPrefixIgnored: true,
      finalInitiateUrl: `${normalized}/pg/api/v2/initiateSale`,
      finalCommandUrl: `${normalized}/pg/api/command`,
    }, "ICICI Provider constructor initialized with normalized URLs");

    this.config = {
      merchantId: config.merchantId,
      aggregatorId: config.aggregatorId,
      secretKey: config.secretKey,
      baseUrl: normalized,
    };
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
    console.log("ICICI PROVIDER START: " + params.bookingRef);
    const txnDate = this.formatTxnDate();
    const amountStr = params.amount.toFixed(2);
    const mobile = params.phone.replace(/\D/g, "").slice(-10);
    const sanitizedName = params.name.replace(/[^a-zA-Z0-9 ]/g, "").trim() || "VALUED PATIENT";

    const hashParams: Record<string, string> = {
      addlParam1: params.bookingRef,
      addlParam2: "care-diagnostics",
      aggregatorID: this.config.aggregatorId,
      amount: amountStr,
      currencyCode: "356",
      customerEmailID: params.email?.trim() || "care.deoghar@gmail.com",
      customerMobileNo: mobile,
      customerName: sanitizedName,
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
      customerName: sanitizedName,
      addlParam1: params.bookingRef,
      addlParam2: "care-diagnostics",
      secureHash,
    };

    const iciciUrl = `${this.config.baseUrl}/pg/api/v2/initiateSale`;

    try {
      logger.info({
        iciciUrl,
        merchantId: this.config.merchantId,
        aggregatorID: this.config.aggregatorId,
        merchantTxnNo: params.bookingRef,
        amount: amountStr,
        currencyCode: "356",
        payType: "0",
        customerMobileNo: mobile,
        customerName: sanitizedName,
      }, "Sending initiateSale request to ICICI PG");

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

      logger.info({
        iciciUrl,
        responseStatus: res.status,
        responseStatusText: res.statusText,
        responseCode: iciciData.responseCode,
        tranCtxPresent: !!iciciData.tranCtx,
        redirectURI: iciciData.redirectURI,
        bodySnippet: resText.slice(0, 1000),
      }, "Received initiateSale response from ICICI PG");

      if (!res.ok || !iciciData.tranCtx || iciciData.responseCode !== "R1000") {
        return {
          success: false,
          rawResponse: iciciData && Object.keys(iciciData).length > 0 ? iciciData : { rawText: resText },
          errorMessage: iciciData.respDescription || iciciData.responseCode || `HTTP ${res.status}`,
        };
      }

      const joinChar = iciciData.redirectURI.includes("?") ? "&" : "?";
      const redirectTo = `${iciciData.redirectURI}${joinChar}tranCtx=${encodeURIComponent(iciciData.tranCtx)}`;

      logger.info({
        redirectURI: iciciData.redirectURI,
        tranCtxPresent: !!iciciData.tranCtx,
        redirectToUrl: redirectTo,
      }, "Final ICICI browser redirect URL assembled");

      return {
        success: true,
        gatewayTxnId: params.bookingRef,
        redirectUrl: redirectTo,
        rawResponse: iciciData,
      };
    } catch (err: any) {
      logger.error({ err, bookingRef: params.bookingRef, iciciUrl }, "ICICI initiateSale HTTP exception");
      return {
        success: false,
        rawResponse: null,
        errorMessage: err.message || "Failed to connect to ICICI PG",
      };
    }
  }

  private verifyIciciCallbackHash(params: Record<string, string>): boolean {
    if (!params.secureHash) return false;
    const hashParams = { ...params };
    delete hashParams.secureHash;
    const keys = Object.keys(hashParams).sort();
    const hashText = keys.map((k) => hashParams[k]).join("");
    const expectedHash = crypto.createHmac("sha256", this.config.secretKey).update(hashText).digest("hex");
    return expectedHash === params.secureHash;
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const { merchantTxnNo, responseCode, status, txnID, respDescription, secureHash } = params.payload;
    const bookingRef = merchantTxnNo || params.bookingRef;

    if (secureHash) {
      const isHashValid = this.verifyIciciCallbackHash(params.payload);
      if (!isHashValid) {
        logger.warn(`ICICI callback hash validation failed for txn: ${bookingRef}. Proceeding with direct status check.`);
      }
    }

    const statusCheck = await this.checkStatus({ bookingRef });
    if (statusCheck.success && statusCheck.status === "paid") {
      return {
        success: true,
        status: "paid",
        gatewayTxnId: bookingRef,
        providerRefId: (statusCheck.rawResponse as any)?.txnID || txnID || "",
        rawResponse: statusCheck.rawResponse,
      };
    }

    return {
      success: false,
      status: "failed",
      errorMessage: statusCheck.errorMessage || "Status verification failed on server-side check",
      rawResponse: statusCheck.rawResponse || params.payload,
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

    const iciciCommandUrl = `${this.config.baseUrl}/pg/api/command`;

    try {
      logger.info({
        iciciCommandUrl,
        merchantId: this.config.merchantId,
        aggregatorID: this.config.aggregatorId,
        merchantTxnNo: params.bookingRef,
      }, "Sending STATUS check command to ICICI command URL");

      const statusRes = await fetch(iciciCommandUrl, {
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
      const statusResText = await statusRes.text();

      logger.info({
        iciciCommandUrl,
        responseStatus: statusRes.status,
        responseStatusText: statusRes.statusText,
        bodySnippet: statusResText.slice(0, 1000),
      }, "Received STATUS check response from ICICI command URL");

      let statusData: any = {};
      try {
        if (statusResText.trim().startsWith("{")) {
          statusData = JSON.parse(statusResText);
        }
      } catch {}

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
        rawResponse: statusData && Object.keys(statusData).length > 0 ? statusData : { rawText: statusResText },
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
    const refundHashParams: Record<string, string> = {
      aggregatorID: this.config.aggregatorId,
      merchantId: this.config.merchantId,
      merchantTxnNo: params.bookingRef,
      originalTxnNo: params.gatewayTxnId,
      amount: params.amount.toFixed(2),
      transactionType: "REFUND",
    };
    const refundHash = this.generateIciciSecureHash(refundHashParams);

    const iciciCommandUrl = `${this.config.baseUrl}/pg/api/command`;

    try {
      logger.info({
        iciciCommandUrl,
        merchantId: this.config.merchantId,
        aggregatorID: this.config.aggregatorId,
        merchantTxnNo: params.bookingRef,
        originalTxnNo: params.gatewayTxnId,
        amount: params.amount.toFixed(2),
      }, "Sending REFUND command to ICICI command URL");

      const res = await fetch(iciciCommandUrl, {
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
      const resText = await res.text();

      logger.info({
        iciciCommandUrl,
        responseStatus: res.status,
        responseStatusText: res.statusText,
        bodySnippet: resText.slice(0, 1000),
      }, "Received REFUND response from ICICI command URL");

      let data: any = {};
      try {
        if (resText.trim().startsWith("{")) {
          data = JSON.parse(resText);
        }
      } catch {}

      if (data.responseCode === "R1000" || data.status === "SUC") {
        return {
          success: true,
          refundTxnId: data.txnID || params.bookingRef,
          rawResponse: data,
        };
      }
      return {
        success: false,
        rawResponse: data && Object.keys(data).length > 0 ? data : { rawText: resText },
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
