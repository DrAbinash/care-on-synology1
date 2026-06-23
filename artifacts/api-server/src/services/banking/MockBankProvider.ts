import type {
  BankProvider, BankBalance, BankTransaction, PaymentInitiation,
  PaymentResult, PaymentStatusResult, WebhookVerificationResult,
  WebhookPayload, ProviderCredentials,
} from "./BankProvider";

export class MockBankProvider implements BankProvider {
  readonly name = "mock";

  private creds: ProviderCredentials = {};
  private cfg: Record<string, unknown> = {};
  private paymentStore = new Map<string, PaymentResult>();

  initialize(credentials: ProviderCredentials, config?: Record<string, unknown>): void {
    this.creds = credentials;
    this.cfg = config ?? {};
  }

  private mockBalance(): number {
    return 987654.32;
  }

  private mockTransactions(count = 5): BankTransaction[] {
    const txns: BankTransaction[] = [];
    const now = new Date();
    for (let i = 0; i < count; i++) {
      const isCredit = i % 2 === 0;
      const amount = 1000 + i * 250;
      txns.push({
        externalTransactionId: `MOCK-TXN-${String(i + 1).padStart(4, "0")}`,
        transactionDate: new Date(now.getTime() - i * 86400000),
        description: isCredit ? "Patient Payment \u2014 Cash Deposit" : "Vendor Payment \u2014 Lab Supplies",
        amount,
        type: isCredit ? "credit" : "debit",
        balanceAfter: this.mockBalance() - (isCredit ? -amount : amount),
        utr: `UTR${Date.now() - i * 1000}`,
        referenceNumber: `REF-${Date.now() - i * 2000}`,
        rawPayload: { mock: true, index: i },
      });
    }
    return txns;
  }

  async getBalance(_accountId: string): Promise<BankBalance> {
    return { available: this.mockBalance(), ledger: this.mockBalance(), currency: "INR" };
  }

  async getTransactions(_accountId: string, options?: { fromDate?: Date; toDate?: Date; limit?: number }): Promise<BankTransaction[]> {
    const limit = options?.limit ?? 5;
    return this.mockTransactions(Math.min(limit, 20));
  }

  async getTransactionStatus(externalTransactionId: string): Promise<{ status: string; details?: unknown }> {
    return {
      status: externalTransactionId.startsWith("MOCK") ? "completed" : "not_found",
      details: { provider: "mock", note: "This is simulated data for testing" },
    };
  }

  async verifyWebhook(rawBody: string, signature: string, secret?: string): Promise<WebhookVerificationResult> {
    const key = secret || this.creds.webhookSecret || "mock-secret";
    const crypto = await import("node:crypto");
    const expected = crypto.createHmac("sha256", key).update(rawBody).digest("hex");
    return { valid: signature === expected || signature === "mock-valid" };
  }

  async parseWebhookPayload(rawBody: string): Promise<WebhookPayload> {
    const parsed = JSON.parse(rawBody);
    return { eventType: parsed.eventType || "mock.transaction.completed", data: parsed };
  }

  async initiatePayment(_accountId: string, payment: PaymentInitiation): Promise<PaymentResult> {
    const reqId = `MOCK-REQ-${Date.now()}`;
    const txnId = `MOCK-TXN-PAY-${Date.now()}`;
    const result: PaymentResult = {
      success: true,
      externalRequestId: reqId,
      externalTransactionId: txnId,
      status: "completed",
    };
    this.paymentStore.set(reqId, result);
    return result;
  }

  async getPaymentStatus(externalRequestId: string): Promise<PaymentStatusResult> {
    const stored = this.paymentStore.get(externalRequestId);
    if (stored) {
      return {
        status: stored.status,
        externalTransactionId: stored.externalTransactionId,
        failureReason: stored.failureReason,
      };
    }
    return {
      status: "pending",
      externalTransactionId: undefined,
      failureReason: undefined,
    };
  }
}
