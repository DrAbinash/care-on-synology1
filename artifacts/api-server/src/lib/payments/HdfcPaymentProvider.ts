/**
 * HdfcPaymentProvider.ts
 *
 * Real HDFC Bank SmartGateway integration (powered by CCAvenue).
 *
 * HDFC SmartGateway uses the CCAvenue payment processing engine.
 * All sensitive params are AES-128-CBC encrypted before transmission.
 *
 * Required merchant credentials (from HDFC merchant portal):
 *   HDFC_MERCHANT_ID   — your CCAvenue/HDFC merchant ID
 *   HDFC_ACCESS_CODE   — your CCAvenue access code
 *   HDFC_WORKING_KEY   — 32-char working key for AES encryption
 *   HDFC_BASE_URL      — optional override (default: https://smartgateway.hdfcbank.com)
 *
 * Flow:
 *   1. initiatePayment → AES-encrypt params → send to HDFC gateway → redirect URL
 *   2. User pays on HDFC page → HDFC POSTs encrypted response to returnURL
 *   3. verifyPayment → decrypt response → check order_status === "Success"
 *   4. checkStatus → status API call for background reconciliation
 *   5. refundPayment → CCAvenue refund API
 */

import crypto from "node:crypto";
import {
  PaymentProvider,
  InitiatePaymentParams,
  InitiatePaymentResult,
  VerifyPaymentParams,
  VerifyPaymentResult,
  CheckStatusParams,
  CheckStatusResult,
  RefundPaymentParams,
  RefundPaymentResult,
} from "./PaymentProvider";
import { logger } from "../logger";

const HDFC_PROD_BASE = "https://smartgateway.hdfcbank.com";
const HDFC_UAT_BASE = "https://test.ccavenue.com";

// ── AES-128-CBC helpers ────────────────────────────────────────────────────────
// HDFC SmartGateway uses AES-128-CBC with MD5 of working_key as the key.
// Key = MD5(working_key), IV = first 16 bytes of MD5(working_key)

function getKeyAndIv(workingKey: string): { key: Buffer; iv: Buffer } {
  const md5 = crypto.createHash("md5").update(workingKey).digest();
  return { key: md5, iv: md5 };
}

export function encryptHdfc(plainText: string, workingKey: string): string {
  const { key, iv } = getKeyAndIv(workingKey);
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

export function decryptHdfc(encryptedHex: string, workingKey: string): string {
  const { key, iv } = getKeyAndIv(workingKey);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/** Parse pipe-separated key=value string returned by CCAvenue/HDFC APIs */
function parsePipeParams(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of raw.split("&")) {
    const eq = pair.indexOf("=");
    if (eq > -1) {
      result[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    }
  }
  return result;
}

export class HdfcPaymentProvider implements PaymentProvider {
  id = "hdfc";
  displayName = "HDFC Bank SmartGateway";

  private config: {
    merchantId: string;
    accessCode: string;
    workingKey: string;
    baseUrl: string;
  };

  constructor(config: {
    merchantId: string;
    secretKey: string;   // treated as workingKey (PaymentProvider interface compat)
    accessCode?: string; // from HDFC_ACCESS_CODE env
    baseUrl?: string;
  }) {
    const baseUrl = (config.baseUrl || (process.env.NODE_ENV === "production" ? HDFC_PROD_BASE : HDFC_UAT_BASE))
      .trim().replace(/\/$/, "");

    this.config = {
      merchantId: config.merchantId,
      accessCode: config.accessCode || process.env.HDFC_ACCESS_CODE || "",
      workingKey: config.secretKey,  // secretKey maps to working_key
      baseUrl,
    };

    logger.info({
      merchantId: this.config.merchantId,
      accessCodePresent: !!this.config.accessCode,
      workingKeyPresent: !!this.config.workingKey,
      baseUrl: this.config.baseUrl,
    }, "HDFC SmartGateway provider initialized");
  }

  /** Build the CCAvenue form params string, encrypt it, return redirect URL */
  async initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    if (!this.config.workingKey || !this.config.accessCode) {
      logger.warn({ bookingRef: params.bookingRef }, "HDFC: credentials not configured — skipping");
      return {
        success: false,
        rawResponse: null,
        errorMessage: "HDFC credentials not configured. Set HDFC_MERCHANT_ID, HDFC_ACCESS_CODE, HDFC_SECRET_KEY.",
      };
    }

    const amountStr = params.amount.toFixed(2);
    const mobile = params.phone.replace(/\D/g, "").slice(-10);
    const email = params.email?.trim() || "care.deoghar@gmail.com";

    // CCAvenue standard params
    const plainParams = [
      `merchant_id=${this.config.merchantId}`,
      `order_id=${params.bookingRef}`,
      `currency=INR`,
      `amount=${amountStr}`,
      `redirect_url=${params.returnUrl}`,
      `cancel_url=${params.returnUrl}`,
      `language=EN`,
      `billing_name=${params.name.replace(/[^a-zA-Z0-9 ]/g, "").trim() || "PATIENT"}`,
      `billing_tel=${mobile}`,
      `billing_email=${email}`,
      `billing_country=India`,
      `merchant_param1=${params.bookingRef}`,
      `merchant_param2=care-diagnostics`,
      `integration_type=iframe_normal`,
    ].join("&");

    const encRequest = encryptHdfc(plainParams, this.config.workingKey);

    // The redirect URL is a GET to the HDFC gateway page with encrypted params
    const gatewayUrl = `${this.config.baseUrl}/transaction/transaction.do`;
    const redirectUrl =
      `${gatewayUrl}?command=initiateTransaction` +
      `&encRequest=${encodeURIComponent(encRequest)}` +
      `&access_code=${encodeURIComponent(this.config.accessCode)}`;

    logger.info({ bookingRef: params.bookingRef, gatewayUrl, amountStr }, "HDFC: initiatePayment redirect built");

    return {
      success: true,
      gatewayTxnId: params.bookingRef,
      redirectUrl,
      rawResponse: { encRequest: encRequest.slice(0, 40) + "…", access_code: this.config.accessCode },
    };
  }

  /** Decrypt the CCAvenue response posted back to returnURL */
  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const { encResp } = params.payload as Record<string, string>;

    if (!encResp) {
      logger.warn({ bookingRef: params.bookingRef }, "HDFC verifyPayment: no encResp in payload");
      return { success: false, status: "failed", errorMessage: "Missing encResp in callback", rawResponse: params.payload };
    }

    let decrypted: string;
    try {
      decrypted = decryptHdfc(encResp, this.config.workingKey);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, status: "failed", errorMessage: "Decrypt failed: " + msg, rawResponse: params.payload };
    }

    const data = parsePipeParams(decrypted);
    logger.info({ bookingRef: params.bookingRef, order_status: data.order_status, tracking_id: data.tracking_id }, "HDFC: decrypted callback");

    const isSuccess = data.order_status === "Success";
    if (isSuccess) {
      return {
        success: true,
        status: "paid",
        gatewayTxnId: data.order_id || params.bookingRef,
        providerRefId: data.tracking_id || data.bank_ref_no || "",
        rawResponse: data,
      };
    }

    return {
      success: false,
      status: "failed",
      errorMessage: data.status_message || data.order_status || "Payment not successful",
      rawResponse: data,
    };
  }

  /** Call CCAvenue order status API */
  async checkStatus(params: CheckStatusParams): Promise<CheckStatusResult> {
    if (!this.config.workingKey || !this.config.accessCode) {
      return { success: false, status: "pending", rawResponse: null, errorMessage: "HDFC credentials not configured" };
    }

    const queryParams = [
      `merchant_id=${this.config.merchantId}`,
      `order_no=${params.bookingRef}`,
    ].join("&");
    const encRequest = encryptHdfc(queryParams, this.config.workingKey);

    const statusUrl = `${this.config.baseUrl}/transaction/transaction.do?command=orderStatusTracker` +
      `&access_code=${encodeURIComponent(this.config.accessCode)}` +
      `&enc_request=${encodeURIComponent(encRequest)}` +
      `&request_type=JSON` +
      `&response_type=JSON`;

    try {
      const res = await fetch(statusUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const text = await res.text();

      let data: Record<string, string> = {};
      try {
        // Response may be JSON with enc_response, or plain JSON
        const json = JSON.parse(text);
        if (json.enc_response) {
          const dec = decryptHdfc(json.enc_response, this.config.workingKey);
          data = parsePipeParams(dec);
        } else {
          data = json;
        }
      } catch {
        data = parsePipeParams(text);
      }

      logger.info({ bookingRef: params.bookingRef, order_status: data.order_status }, "HDFC: checkStatus response");

      const isSuccess = data.order_status === "Success" || data.order_status === "Shipped";
      return {
        success: isSuccess,
        status: isSuccess ? "paid" : data.order_status === "Initiated" ? "pending" : "failed",
        rawResponse: data,
        errorMessage: isSuccess ? undefined : data.status_message || data.order_status,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, bookingRef: params.bookingRef }, "HDFC: checkStatus HTTP error");
      return { success: false, status: "pending", rawResponse: null, errorMessage: msg };
    }
  }

  /** CCAvenue refund via command=refundOrder */
  async refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult> {
    if (!this.config.workingKey || !this.config.accessCode) {
      return { success: false, rawResponse: null, errorMessage: "HDFC credentials not configured" };
    }

    const refundParams = [
      `merchant_id=${this.config.merchantId}`,
      `order_no=${params.bookingRef}`,
      `refund_amount=${params.amount.toFixed(2)}`,
      `reference_no=${params.gatewayTxnId}`,
    ].join("&");
    const encRequest = encryptHdfc(refundParams, this.config.workingKey);

    const refundUrl = `${this.config.baseUrl}/transaction/transaction.do`;

    try {
      const res = await fetch(refundUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `command=refundOrder&access_code=${encodeURIComponent(this.config.accessCode)}&enc_request=${encodeURIComponent(encRequest)}&request_type=JSON&response_type=JSON`,
      });
      const text = await res.text();

      let data: Record<string, string> = {};
      try {
        const json = JSON.parse(text);
        if (json.enc_response) {
          const dec = decryptHdfc(json.enc_response, this.config.workingKey);
          data = parsePipeParams(dec);
        } else {
          data = json;
        }
      } catch {
        data = parsePipeParams(text);
      }

      logger.info({ bookingRef: params.bookingRef, refund_status: data.refund_status }, "HDFC: refund response");

      const isSuccess = data.refund_status === "Success" || data.refund_status === "1";
      if (isSuccess) {
        return {
          success: true,
          refundTxnId: data.refund_ref_no || params.gatewayTxnId,
          rawResponse: data,
        };
      }
      return {
        success: false,
        rawResponse: data,
        errorMessage: data.status_message || data.refund_status || "Refund failed",
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, rawResponse: null, errorMessage: msg };
    }
  }
}
