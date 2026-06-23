// =============================================================================
// GenericBankProvider
//
// Adapter for any bank that exposes a standard REST API.
// Uses generic field mappings defined in providerConfig to adapt
// arbitrary bank JSON shapes to the common interface.
//
// Config shape in providerConfig:
// {
//   baseUrl: "https://api.bank.com/v1",
//   authHeader: "x-api-key",
//   balancePath: "/accounts/{accountId}/balance",
//   transactionsPath: "/accounts/{accountId}/transactions",
//   paymentPath: "/payments",
//   paymentStatusPath: "/payments/{requestId}",
//   // Field mappings (dot-path inside JSON)
//   balanceField: "data.balance",
//   currencyField: "data.currency",
//   txnListField: "data.transactions",
//   txnIdField: "txnId",
//   txnDateField: "txnDate",
//   txnDescField: "description",
//   txnAmountField: "amount",
//   txnTypeField: "crDr", // values: "CR"=credit, anything else=debit
//   txnBalanceField: "closingBalance",
//   txnUtrField: "utrNo",
//   txnRefField: "refNo",
// }
// =============================================================================

import type {
  BankProvider, BankBalance, BankTransaction, PaymentInitiation,
  PaymentResult, PaymentStatusResult, WebhookVerificationResult,
  WebhookPayload, ProviderCredentials,
} from "./BankProvider";

function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split(".");
  let current: unknown = obj;
  for (const p of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[p];
  }
  return current;
}

export class GenericBankProvider implements BankProvider {
  readonly name = "generic";

  private creds: ProviderCredentials = {};
  private cfg: Record<string, string> = {};

  initialize(credentials: ProviderCredentials, config?: Record<string, unknown>): void {
    this.creds = credentials;
    this.cfg = {};
    if (config) {
      for (const [k, v] of Object.entries(config)) {
        if (typeof v === "string") this.cfg[k] = v;
      }
    }
  }

  private resolve(pathTemplate: string, vars: Record<string, string>): string {
    let p = pathTemplate;
    for (const [k, v] of Object.entries(vars)) {
      p = p.replace(new RegExp(`\\{${k}\\}`, "g"), encodeURIComponent(v));
    }
    return p;
  }

  private async api<T>(path: string, opts?: RequestInit): Promise<T> {
    const url = `${this.cfg.baseUrl ?? ""}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.cfg.authHeader && this.creds.apiKey) {
      headers[this.cfg.authHeader] = this.creds.apiKey;
    }
    if (this.creds.apiKey && !this.cfg.authHeader) {
      headers.Authorization = `Bearer ${this.creds.apiKey}`;
    }
    const res = await fetch(url, { ...opts, headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GenericBank API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async getBalance(accountId: string): Promise<BankBalance> {
    const path = this.resolve(this.cfg.balancePath ?? "/accounts/{accountId}/balance", { accountId });
    const data = await this.api<unknown>(path);
    const bal = getPath(data, this.cfg.balanceField ?? "balance");
    const curr = getPath(data, this.cfg.currencyField ?? "currency");
    return {
      available: typeof bal === "number" ? bal : parseFloat(String(bal)) || 0,
      ledger: typeof bal === "number" ? bal : parseFloat(String(bal)) || 0,
      currency: String(curr || "INR"),
    };
  }

  async getTransactions(accountId: string, options?: { fromDate?: Date; toDate?: Date; limit?: number }): Promise<BankTransaction[]> {
    let path = this.resolve(this.cfg.transactionsPath ?? "/accounts/{accountId}/transactions", { accountId });
    const params = new URLSearchParams();
    if (options?.fromDate) params.set("fromDate", options.fromDate.toISOString().slice(0, 10));
    if (options?.toDate) params.set("toDate", options.toDate.toISOString().slice(0, 10));
    if (options?.limit) params.set("limit", String(options.limit));
    if (params.toString()) path += `?${params.toString()}`;
    const data = await this.api<unknown>(path);
    const list = getPath(data, this.cfg.txnListField ?? "transactions") as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(list)) return [];
    return list.map((t) => ({
      externalTransactionId: String(getPath(t, this.cfg.txnIdField ?? "txnId") ?? ""),
      transactionDate: new Date(String(getPath(t, this.cfg.txnDateField ?? "txnDate") ?? Date.now())),
      description: String(getPath(t, this.cfg.txnDescField ?? "description") ?? ""),
      amount: parseFloat(String(getPath(t, this.cfg.txnAmountField ?? "amount"))) || 0,
      type: String(getPath(t, this.cfg.txnTypeField ?? "crDr")) === "CR" ? "credit" : "debit",
      balanceAfter: parseFloat(String(getPath(t, this.cfg.txnBalanceField ?? "closingBalance"))) || undefined,
      utr: String(getPath(t, this.cfg.txnUtrField ?? "utrNo") ?? ""),
      referenceNumber: String(getPath(t, this.cfg.txnRefField ?? "refNo") ?? ""),
      rawPayload: t,
    }));
  }

  async getTransactionStatus(externalTransactionId: string): Promise<{ status: string; details?: unknown }> {
    const path = `/transactions/${externalTransactionId}`;
    const data = await this.api<{ status: string; details: unknown }>(path);
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
    return { eventType: parsed.eventType || parsed.type || "generic.unknown", data: parsed };
  }

  async initiatePayment(accountId: string, payment: PaymentInitiation): Promise<PaymentResult> {
    const path = this.cfg.paymentPath ?? "/payments";
    const data = await this.api<{
      requestId: string; transactionId?: string; status: string; failureReason?: string;
    }>(path, {
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
    const path = this.resolve(this.cfg.paymentStatusPath ?? "/payments/{requestId}", { requestId: externalRequestId });
    const data = await this.api<{
      status: string; transactionId?: string; amount?: string; failureReason?: string;
    }>(path);
    return {
      status: (data.status as PaymentStatusResult["status"]) ?? "unknown",
      externalTransactionId: data.transactionId,
      amount: data.amount ? parseFloat(data.amount) : undefined,
      failureReason: data.failureReason,
    };
  }
}
