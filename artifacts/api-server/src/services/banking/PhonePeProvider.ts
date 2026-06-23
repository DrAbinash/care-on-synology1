// =============================================================================
// PhonePeProvider
//
// Adapter for PhonePe Merchant / PG API (UPI-first payments & payouts).
// Credentials: PHONEPE_API_KEY, PHONEPE_API_SECRET (SALT key),
//              PHONEPE_CLIENT_ID (SALT index), PHONEPE_WEBHOOK_SECRET,
//              PHONEPE_MERCHANT_ID, PHONEPE_BASE_URL
// Supports: settlement balance, transaction status, payouts (VPA / bank),
//           webhook signature verification via X-VERIFY header.
// =============================================================================

import type {
  BankProvider, BankBalance, BankTransaction, PaymentInitiation,
  PaymentResult, PaymentStatusResult, WebhookVerificationResult,
  WebhookPayload, ProviderCredentials,
} from "./BankProvider";

export class PhonePeProvider implements BankProvider {
  readonly name = "phonepe";

  private creds: ProviderCredentials = {};
  private baseUrl = "https://api.phonepe.com/apis/hermes";

  initialize(credentials: ProviderCredentials, config?: Record<string, unknown>): void {
    this.creds = credentials;
    if (config?.baseUrl && typeof config.baseUrl === "string") {
      this.baseUrl = config.baseUrl;
    }
  }

  private saltKey(): string { return this.creds.apiSecret ?? ""; }
  private saltIndex(): string { return this.creds.clientId ?? "1"; }
  private merchantId(): string { return this.creds.merchantId ?? ""; }

  /** PhonePe X-VERIFY = SHA256(base64Payload + "/pg/v1/pay" + saltKey) + ###saltIndex */
  private async xVerify(payloadBase64: string, endpoint: string): Promise<string> {
    const crypto = await import("node:crypto");
    const hash = crypto.createHash("sha256").update(payloadBase64 + endpoint + this.saltKey()).digest("hex");
    return `${hash}###${this.saltIndex()}`;
  }

  private authHeaders(payloadBase64?: string, endpoint?: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-MERCHANT-ID": this.merchantId(),
    };
    if (payloadBase64 && endpoint) {
      // Async x-verify computation deferred to callers that need it
    }
    return headers;
  }

  private async api<T>(path: string, opts?: RequestInit & { skipVerify?: boolean }): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const body = opts?.body ? String(opts.body) : undefined;
    let verifyHeader = "";
    if (body && !opts?.skipVerify) {
      const payloadBase64 = Buffer.from(body).toString("base64");
      const endpoint = path.split("?")[0];
      verifyHeader = await this.xVerify(payloadBase64, endpoint);
    }
    const headers: Record<string, string> = {
      ...this.authHeaders(),
      ...(verifyHeader ? { "X-VERIFY": verifyHeader } : {}),
      ...((opts?.headers as Record<string, string>) ?? {}),
    };
    const res = await fetch(url, { ...opts, headers, body });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`PhonePe API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async getBalance(_accountId: string): Promise<BankBalance> {
    // PhonePe doesn't expose a direct balance endpoint; settlement reports act as proxy.
    const data = await this.api<{ totalSettled: string; currency: string }>("/v1/settlement/total", { method: "GET", skipVerify: true });
    return {
      available: parseFloat(data.totalSettled) || 0,
      ledger: parseFloat(data.totalSettled) || 0,
      currency: data.currency || "INR",
    };
  }

  async getTransactions(_accountId: string, options?: { fromDate?: Date; toDate?: Date; limit?: number }): Promise<BankTransaction[]> {
    const params = new URLSearchParams();
    if (options?.fromDate) params.set("from", options.fromDate.toISOString().slice(0, 10));
    if (options?.toDate) params.set("to", options.toDate.toISOString().slice(0, 10));
    if (options?.limit) params.set("limit", String(options.limit));
    const data = await this.api<{
      transactions: Array<{
        merchantTransactionId: string; createdAt: string; description: string;
        amount: number; paymentState: string; utr?: string; transactionId?: string;
      }>;
    }>(`/v1/transactions?${params.toString()}`, { method: "GET", skipVerify: true });
    return (data.transactions ?? []).map((t) => ({
      externalTransactionId: t.merchantTransactionId,
      transactionDate: new Date(t.createdAt),
      description: t.description || "PhonePe UPI",
      amount: typeof t.amount === "number" ? t.amount / 100 : 0, // PhonePe amounts in paise
      type: t.paymentState === "COMPLETED" ? "credit" : "debit",
      balanceAfter: undefined,
      utr: t.utr,
      referenceNumber: t.transactionId,
      rawPayload: t,
    }));
  }

  async getTransactionStatus(externalTransactionId: string): Promise<{ status: string; details?: unknown }> {
    const data = await this.api<{ success: boolean; code: string; data?: { state?: string } }>(
      `/v1/transaction/${this.merchantId()}/${externalTransactionId}`,
      { method: "GET", skipVerify: true },
    );
    return { status: data.data?.state ?? "unknown", details: data.data };
  }

  async verifyWebhook(rawBody: string, signature: string, secret?: string): Promise<WebhookVerificationResult> {
    const key = secret || this.creds.webhookSecret || "";
    if (!key) return { valid: false };
    const crypto = await import("node:crypto");
    const expected = crypto.createHmac("sha256", key).update(rawBody).digest("hex");
    return { valid: signature === expected };
  }

  async parseWebhookPayload(rawBody: string): Promise<WebhookPayload> {
    const parsed = JSON.parse(rawBody);
    return { eventType: parsed.eventType || parsed.type || "phonepe.unknown", data: parsed };
  }

  /** Initiate a payout to a VPA or bank account */
  async initiatePayment(_accountId: string, payment: PaymentInitiation): Promise<PaymentResult> {
    const merchantId = this.merchantId();
    const reqId = `PP-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const payload = {
      merchantId,
      merchantTransactionId: reqId,
      amount: Math.round(payment.amount * 100), // paise
      currency: payment.currency || "INR",
      purpose: payment.purpose || "Payout",
      ...(payment.beneficiaryAccount?.includes("@")
        ? {
            vpa: payment.beneficiaryAccount,
            vpaName: payment.beneficiaryName || "Beneficiary",
          }
        : {
            beneficiaryAccount: payment.beneficiaryAccount,
            beneficiaryIfsc: payment.beneficiaryIfsc,
            beneficiaryName: payment.beneficiaryName,
          }),
    };
    const bodyStr = JSON.stringify(payload);
    const payloadBase64 = Buffer.from(bodyStr).toString("base64");
    const endpoint = "/v1/payout";
    const xVerify = await this.xVerify(payloadBase64, endpoint);

    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-VERIFY": xVerify,
        "X-MERCHANT-ID": merchantId,
      },
      body: JSON.stringify({ request: payloadBase64 }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`PhonePe payout ${res.status}: ${text}`);
    }
    const data = (await res.json()) as {
      success: boolean; code: string; data?: { state?: string; transactionId?: string };
    };
    const state = data.data?.state ?? "PENDING";
    return {
      success: data.success || state === "COMPLETED" || state === "PENDING",
      externalRequestId: reqId,
      externalTransactionId: data.data?.transactionId,
      status: normalizeState(state),
      failureReason: data.success ? undefined : data.code,
    };
  }

  async getPaymentStatus(externalRequestId: string): Promise<PaymentStatusResult> {
    const data = await this.api<{ success: boolean; code: string; data?: { state?: string; amount?: number; transactionId?: string } }>(
      `/v1/transaction/${this.merchantId()}/${externalRequestId}`,
      { method: "GET", skipVerify: true },
    );
    return {
      status: normalizeState(data.data?.state ?? "unknown"),
      externalTransactionId: data.data?.transactionId,
      amount: data.data?.amount ? data.data.amount / 100 : undefined,
      failureReason: data.success ? undefined : data.code,
    };
  }
}

function normalizeState(s: string): PaymentResult["status"] {
  const state = s.toUpperCase();
  if (state === "COMPLETED" || state === "SUCCESS") return "completed";
  if (state === "FAILED" || state === "FAILURE" || state === "REJECTED") return "failed";
  if (state === "PROCESSING") return "processing";
  return "pending";
}
