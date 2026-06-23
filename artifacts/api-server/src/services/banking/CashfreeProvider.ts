// =============================================================================
// CashfreeProvider
//
// Adapter for Cashfree Payments API (PG + Payouts).
// Credentials: CASHFREE_API_KEY, CASHFREE_API_SECRET, CASHFREE_CLIENT_ID,
//              CASHFREE_WEBHOOK_SECRET, CASHFREE_BASE_URL
// Supports: payments, settlements, payouts, webhook verification.
// =============================================================================

import type {
  BankProvider, BankBalance, BankTransaction, PaymentInitiation,
  PaymentResult, PaymentStatusResult, WebhookVerificationResult,
  WebhookPayload, ProviderCredentials,
} from "./BankProvider";

export class CashfreeProvider implements BankProvider {
  readonly name = "cashfree";

  private creds: ProviderCredentials = {};
  private baseUrl = "https://api.cashfree.com/pg";

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
      "x-api-version": "2023-08-01",
      "x-client-id": this.creds.clientId ?? "",
      "x-client-secret": this.creds.apiSecret ?? "",
    };
  }

  private async api<T>(path: string, opts?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { ...opts, headers: { ...this.authHeaders(), ...(opts?.headers ?? {}) } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Cashfree API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async getBalance(_accountId: string): Promise<BankBalance> {
    const data = await this.api<{ settlement: { total_balance: string } }>("/settlements/balance");
    const bal = parseFloat(data.settlement?.total_balance ?? "0");
    return { available: bal, ledger: bal, currency: "INR" };
  }

  async getTransactions(_accountId: string, options?: { fromDate?: Date; toDate?: Date; limit?: number }): Promise<BankTransaction[]> {
    const params = new URLSearchParams();
    if (options?.fromDate) params.set("start_date", options.fromDate.toISOString().slice(0, 10));
    if (options?.toDate) params.set("end_date", options.toDate.toISOString().slice(0, 10));
    if (options?.limit) params.set("limit", String(options.limit));
    const data = await this.api<{
      settlements: Array<{
        settlement_utr: string; settlement_date: string; order_id: string;
        settlement_amount: string; settlement_status: string; payment_amount: string;
        payment_method: string; customer_details?: { customer_phone?: string };
      }>;
    }>(`/settlements?${params.toString()}`);
    return (data.settlements ?? []).map((s) => ({
      externalTransactionId: s.settlement_utr || s.order_id,
      transactionDate: new Date(s.settlement_date),
      description: `Cashfree ${s.payment_method} settlement`,
      amount: parseFloat(s.settlement_amount) || 0,
      type: "credit",
      balanceAfter: undefined,
      utr: s.settlement_utr,
      referenceNumber: s.order_id,
      rawPayload: s,
    }));
  }

  async getTransactionStatus(externalTransactionId: string): Promise<{ status: string; details?: unknown }> {
    const data = await this.api<{ order_status: string; order_details: unknown }>(`/orders/${externalTransactionId}`);
    return { status: data.order_status, details: data.order_details };
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
    return { eventType: parsed.type || parsed.event || "cashfree.unknown", data: parsed };
  }

  async initiatePayment(_accountId: string, payment: PaymentInitiation): Promise<PaymentResult> {
    const data = await this.api<{
      order_id: string; order_token?: string; order_status: string; order_expiry_time?: string;
    }>("/orders", {
      method: "POST",
      body: JSON.stringify({
        order_id: `REF-${Date.now()}`,
        order_amount: payment.amount,
        order_currency: payment.currency || "INR",
        order_note: payment.purpose || "",
        customer_details: {
          customer_name: payment.beneficiaryName || "",
          customer_phone: "",
          customer_email: "",
        },
      }),
    });
    return {
      success: data.order_status === "PAID" || data.order_status === "ACTIVE",
      externalRequestId: data.order_id,
      status: data.order_status === "PAID" ? "completed" : "pending",
    };
  }

  async getPaymentStatus(externalRequestId: string): Promise<PaymentStatusResult> {
    const data = await this.api<{
      order_status: string; order_amount: string; payment_details?: { payment_amount?: string; payment_status?: string; payment_message?: string };
    }>(`/orders/${externalRequestId}`);
    const p = data.payment_details;
    return {
      status: (data.order_status as PaymentStatusResult["status"]) ?? "unknown",
      amount: p?.payment_amount ? parseFloat(p.payment_amount) : undefined,
      failureReason: p?.payment_message,
    };
  }
}
