// =============================================================================
// AxisBankProvider
//
// Adapter for Axis Bank API.
// Credentials: AXIS_API_KEY, AXIS_API_SECRET, AXIS_CLIENT_ID, AXIS_WEBHOOK_SECRET
// =============================================================================

import type {
  BankProvider, BankBalance, BankTransaction, PaymentInitiation,
  PaymentResult, PaymentStatusResult, WebhookVerificationResult,
  WebhookPayload, ProviderCredentials,
} from "./BankProvider";

export class AxisBankProvider implements BankProvider {
  readonly name = "axis";

  private creds: ProviderCredentials = {};
  private baseUrl = "https://developer.axisbank.com/api/v1";

  initialize(credentials: ProviderCredentials, config?: Record<string, unknown>): void {
    this.creds = credentials;
    if (config?.baseUrl && typeof config.baseUrl === "string") {
      this.baseUrl = config.baseUrl;
    }
  }

  private async api<T>(path: string, opts?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${this.creds.apiKey ?? ""}`,
      "x-client-id": this.creds.clientId ?? "",
    };
    const res = await fetch(url, { ...opts, headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Axis API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async getBalance(accountId: string): Promise<BankBalance> {
    const data = await this.api<{ balance: string; currency: string }>(`/accounts/${accountId}/balance`);
    return { available: parseFloat(data.balance) || 0, ledger: parseFloat(data.balance) || 0, currency: data.currency || "INR" };
  }

  async getTransactions(accountId: string, options?: { fromDate?: Date; toDate?: Date; limit?: number }): Promise<BankTransaction[]> {
    const params = new URLSearchParams();
    if (options?.fromDate) params.set("fromDate", options.fromDate.toISOString().slice(0, 10));
    if (options?.toDate) params.set("toDate", options.toDate.toISOString().slice(0, 10));
    if (options?.limit) params.set("limit", String(options.limit));
    const data = await this.api<{
      transactions: Array<{
        txnId: string; txnDate: string; description: string; amount: string;
        debitCreditFlag: string; runningBalance: string; utr?: string; refNo?: string;
      }>;
    }>(`/accounts/${accountId}/transactions?${params.toString()}`);
    return (data.transactions ?? []).map((t) => ({
      externalTransactionId: t.txnId,
      transactionDate: new Date(t.txnDate),
      description: t.description,
      amount: parseFloat(t.amount) || 0,
      type: t.debitCreditFlag === "C" ? "credit" : "debit",
      balanceAfter: parseFloat(t.runningBalance) || undefined,
      utr: t.utr,
      referenceNumber: t.refNo,
      rawPayload: t,
    }));
  }

  async getTransactionStatus(externalTransactionId: string): Promise<{ status: string; details?: unknown }> {
    const data = await this.api<{ status: string; details: unknown }>(`/transactions/${externalTransactionId}`);
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
    return { eventType: parsed.eventType || parsed.type || "axis.unknown", data: parsed };
  }

  async initiatePayment(accountId: string, payment: PaymentInitiation): Promise<PaymentResult> {
    const data = await this.api<{
      requestId: string; transactionId?: string; status: string; failureReason?: string;
    }>("/payments", {
      method: "POST",
      body: JSON.stringify({
        sourceAccount: accountId,
        amount: payment.amount,
        currency: payment.currency || "INR",
        remarks: payment.purpose,
        beneficiaryName: payment.beneficiaryName,
        beneficiaryAccount: payment.beneficiaryAccount,
        beneficiaryIfsc: payment.beneficiaryIfsc,
      }),
    });
    return {
      success: data.status === "pending" || data.status === "completed",
      externalRequestId: data.requestId,
      externalTransactionId: data.transactionId,
      status: (data.status as PaymentResult["status"]) ?? "pending",
      failureReason: data.failureReason,
    };
  }

  async getPaymentStatus(externalRequestId: string): Promise<PaymentStatusResult> {
    const data = await this.api<{
      status: string; transactionId?: string; amount?: string; failureReason?: string;
    }>(`/payments/${externalRequestId}`);
    return {
      status: (data.status as PaymentStatusResult["status"]) ?? "unknown",
      externalTransactionId: data.transactionId,
      amount: data.amount ? parseFloat(data.amount) : undefined,
      failureReason: data.failureReason,
    };
  }
}
