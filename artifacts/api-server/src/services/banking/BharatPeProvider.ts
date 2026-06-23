// =============================================================================
// BharatPeProvider
//
// Adapter for BharatPe Merchant API.
// Credentials: BHARATPE_API_KEY, BHARATPE_API_SECRET, BHARATPE_MERCHANT_ID,
//              BHARATPE_WEBHOOK_SECRET
// Supports: balance (settlement), transactions, payouts, webhook verification.
// =============================================================================

import type {
  BankProvider, BankBalance, BankTransaction, PaymentInitiation,
  PaymentResult, PaymentStatusResult, WebhookVerificationResult,
  WebhookPayload, ProviderCredentials,
} from "./BankProvider";

export class BharatPeProvider implements BankProvider {
  readonly name = "bharatpe";

  private creds: ProviderCredentials = {};
  private baseUrl = "https://api.bharatpe.in/api/v1";

  initialize(credentials: ProviderCredentials, config?: Record<string, unknown>): void {
    this.creds = credentials;
    if (config?.baseUrl && typeof config.baseUrl === "string") {
      this.baseUrl = config.baseUrl;
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": this.creds.apiKey ?? "",
      "x-api-secret": this.creds.apiSecret ?? "",
      "x-merchant-id": this.creds.merchantId ?? "",
    };
  }

  private async api<T>(path: string, opts?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { ...opts, headers: { ...this.authHeaders(), ...((opts?.headers as Record<string, string>) ?? {}) } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`BharatPe API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async getBalance(_accountId: string): Promise<BankBalance> {
    const data = await this.api<{ availableBalance: string; totalSettled: string; currency: string }>("/merchant/balance");
    return {
      available: parseFloat(data.availableBalance) || 0,
      ledger: parseFloat(data.totalSettled) || 0,
      currency: data.currency || "INR",
    };
  }

  async getTransactions(_accountId: string, options?: { fromDate?: Date; toDate?: Date; limit?: number }): Promise<BankTransaction[]> {
    const params = new URLSearchParams();
    if (options?.fromDate) params.set("fromDate", options.fromDate.toISOString().slice(0, 10));
    if (options?.toDate) params.set("toDate", options.toDate.toISOString().slice(0, 10));
    if (options?.limit) params.set("limit", String(options.limit));
    const data = await this.api<{
      transactions: Array<{
        txnId: string; txnDate: string; description: string; amount: string;
        txnType: string; status: string; utr?: string; refNo?: string;
      }>;
    }>(`/merchant/transactions?${params.toString()}`);
    return (data.transactions ?? []).map((t) => ({
      externalTransactionId: t.txnId,
      transactionDate: new Date(t.txnDate),
      description: t.description,
      amount: parseFloat(t.amount) || 0,
      type: t.txnType === "CREDIT" || t.txnType === "credit" ? "credit" : "debit",
      balanceAfter: undefined,
      utr: t.utr,
      referenceNumber: t.refNo,
      rawPayload: t,
    }));
  }

  async getTransactionStatus(externalTransactionId: string): Promise<{ status: string; details?: unknown }> {
    const data = await this.api<{ status: string; details: unknown }>(`/merchant/transaction/${externalTransactionId}`);
    return { status: data.status, details: data.details };
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
    return { eventType: parsed.eventType || parsed.type || "bharatpe.unknown", data: parsed };
  }

  async initiatePayment(_accountId: string, payment: PaymentInitiation): Promise<PaymentResult> {
    const data = await this.api<{
      requestId: string; transactionId?: string; status: string; failureReason?: string;
    }>("/merchant/payout", {
      method: "POST",
      body: JSON.stringify({
        amount: payment.amount,
        currency: payment.currency || "INR",
        remarks: payment.purpose,
        beneficiaryName: payment.beneficiaryName,
        beneficiaryAccount: payment.beneficiaryAccount,
        beneficiaryIfsc: payment.beneficiaryIfsc,
      }),
    });
    return {
      success: data.status === "PENDING" || data.status === "SUCCESS" || data.status === "completed",
      externalRequestId: data.requestId,
      externalTransactionId: data.transactionId,
      status: normalizeStatus(data.status),
      failureReason: data.failureReason,
    };
  }

  async getPaymentStatus(externalRequestId: string): Promise<PaymentStatusResult> {
    const data = await this.api<{
      status: string; transactionId?: string; amount?: string; failureReason?: string;
    }>(`/merchant/payout/${externalRequestId}`);
    return {
      status: normalizeStatus(data.status),
      externalTransactionId: data.transactionId,
      amount: data.amount ? parseFloat(data.amount) : undefined,
      failureReason: data.failureReason,
    };
  }
}

function normalizeStatus(s: string): PaymentResult["status"] {
  const status = s.toLowerCase();
  if (status === "success" || status === "completed") return "completed";
  if (status === "failed" || status === "failure" || status === "rejected") return "failed";
  if (status === "processing") return "processing";
  return "pending";
}
