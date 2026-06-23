import crypto from "node:crypto";
import { PaymentProvider, InitiatePaymentParams, InitiatePaymentResult, VerifyPaymentParams, VerifyPaymentResult, CheckStatusParams, CheckStatusResult, RefundPaymentParams, RefundPaymentResult } from "./PaymentProvider";

const PAYU_PROD_URL = "https://secure.payu.in/_payment";
const PAYU_TEST_URL = "https://test.payu.in/_payment";

export class PayUPaymentProvider implements PaymentProvider {
  id = "payu";
  displayName = "PayU India";

  private config: {
    merchantKey: string;
    merchantSalt: string;
    baseUrl: string;
  };

  constructor(config: {
    merchantKey: string;
    merchantSalt: string;
    baseUrl?: string;
  }) {
    const isTest = config.merchantKey.startsWith("gtKFFx") || process.env.NODE_ENV !== "production";
    this.config = {
      merchantKey: config.merchantKey,
      merchantSalt: config.merchantSalt,
      baseUrl: config.baseUrl || (isTest ? PAYU_TEST_URL : PAYU_PROD_URL),
    };
  }

  private payuRequestHash(params: {
    key: string; txnid: string; amount: string; productinfo: string;
    firstname: string; email: string; salt: string;
  }): string {
    const { key, txnid, amount, productinfo, firstname, email, salt } = params;
    const str = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|||||||||${salt}`;
    return crypto.createHash("sha512").update(str).digest("hex");
  }

  private payuResponseHash(params: {
    key: string; txnid: string; amount: string; productinfo: string;
    firstname: string; email: string; status: string; salt: string;
  }): string {
    const { key, txnid, amount, productinfo, firstname, email, status, salt } = params;
    const str = `${salt}|${status}||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
    return crypto.createHash("sha512").update(str).digest("hex");
  }

  async initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    const amountStr = params.amount.toFixed(2);
    const productinfo = "Care Diagnostics Test Booking";
    const firstname = params.name.trim().split(" ")[0] ?? params.name.trim();
    const emailStr = params.email?.trim() || "";
    const base = params.returnUrl.split("/api/")[0];
    const surl = `${base}/api/public/booking/payu-success`;
    const furl = `${base}/api/public/booking/payu-failure`;

    const hash = this.payuRequestHash({
      key: this.config.merchantKey,
      txnid: params.bookingRef,
      amount: amountStr,
      productinfo,
      firstname,
      email: emailStr,
      salt: this.config.merchantSalt,
    });

    const fields = {
      key: this.config.merchantKey,
      txnid: params.bookingRef,
      amount: amountStr,
      productinfo,
      firstname,
      lastname: params.name.trim().split(" ").slice(1).join(" "),
      email: emailStr,
      phone: params.phone.trim().replace(/[^0-9]/g, "").slice(0, 10),
      surl,
      furl,
      hash,
    };

    return {
      success: true,
      gatewayTxnId: params.bookingRef,
      redirectUrl: this.config.baseUrl, // PayU is typically form-post, so front-end uses fields + action-url
      rawResponse: { fields, actionUrl: this.config.baseUrl },
    };
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const { txnid, status, hash: returnedHash, amount, productinfo, firstname, email } = params.payload;
    const bookingRef = txnid || params.bookingRef;

    if (this.config.merchantSalt && this.config.merchantKey && bookingRef) {
      const expected = this.payuResponseHash({
        key: this.config.merchantKey,
        txnid: bookingRef,
        amount: amount ?? "",
        productinfo: productinfo ?? "",
        firstname: firstname ?? "",
        email: email ?? "",
        status: status ?? "",
        salt: this.config.merchantSalt,
      });

      if (expected !== returnedHash) {
        return {
          success: false,
          status: "failed",
          errorMessage: "Hash verification failed",
          rawResponse: params.payload,
        };
      }
    }

    if (status !== "success") {
      return {
        success: false,
        status: "failed",
        errorMessage: `Status: ${status}`,
        rawResponse: params.payload,
      };
    }

    return {
      success: true,
      status: "paid",
      gatewayTxnId: bookingRef,
      rawResponse: params.payload,
    };
  }

  async checkStatus(params: CheckStatusParams): Promise<CheckStatusResult> {
    // PayU check status requires calling the PayU Web Services API.
    // For this refactor, we match the existing verify/callback fallback approach.
    return {
      success: true,
      status: "pending",
      rawResponse: null,
      errorMessage: "PayU checkStatus not implemented, relying on callbacks",
    };
  }

  async refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult> {
    // PayU refund placeholder
    return {
      success: false,
      rawResponse: null,
      errorMessage: "PayU refunds must be processed through merchant dashboard",
    };
  }
}
