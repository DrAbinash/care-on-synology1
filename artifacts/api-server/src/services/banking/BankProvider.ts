// =============================================================================
// BankProvider Interface
//
// Common contract for all bank integrations. Every adapter must implement
// these methods so the BankingService can treat them identically.
// =============================================================================

export interface BankTransaction {
  externalTransactionId: string;
  transactionDate: Date;
  description: string;
  amount: number;
  type: "credit" | "debit";
  balanceAfter?: number;
  utr?: string;
  referenceNumber?: string;
  rawPayload?: unknown;
}

export interface BankBalance {
  available: number;
  ledger: number;
  currency: string;
}

export interface PaymentInitiation {
  amount: number;
  currency: string;
  purpose?: string;
  beneficiaryName?: string;
  beneficiaryAccount?: string;
  beneficiaryIfsc?: string;
}

export interface PaymentResult {
  success: boolean;
  externalRequestId?: string;
  externalTransactionId?: string;
  status: "pending" | "processing" | "completed" | "failed";
  failureReason?: string;
}

export interface PaymentStatusResult {
  status: "pending" | "processing" | "completed" | "failed";
  externalTransactionId?: string;
  amount?: number;
  failureReason?: string;
}

export interface WebhookVerificationResult {
  valid: boolean;
  eventType?: string;
}

export interface WebhookPayload {
  eventType: string;
  data: unknown;
}

export interface ProviderCredentials {
  apiKey?: string;
  apiSecret?: string;
  clientId?: string;
  merchantId?: string;
  webhookSecret?: string;
  baseUrl?: string;
  appId?: string;
  [key: string]: string | undefined;
}

export interface BankProvider {
  readonly name: string;

  /** Load credentials from env vars or secure config */
  initialize(credentials: ProviderCredentials, config?: Record<string, unknown>): void;

  /** Check account balance */
  getBalance(accountId: string): Promise<BankBalance>;

  /** Fetch recent transactions from the bank */
  getTransactions(accountId: string, options?: { fromDate?: Date; toDate?: Date; limit?: number }): Promise<BankTransaction[]>;

  /** Get status of a specific transaction */
  getTransactionStatus(externalTransactionId: string): Promise<{ status: string; details?: unknown }>;

  /** Verify webhook signature */
  verifyWebhook(rawBody: string, signature: string, secret?: string): Promise<WebhookVerificationResult>;

  /** Parse webhook payload into normalized format */
  parseWebhookPayload(rawBody: string): Promise<WebhookPayload>;

  /** Initiate a payment (NEFT/RTGS/IMPS/UPI) */
  initiatePayment(accountId: string, payment: PaymentInitiation): Promise<PaymentResult>;

  /** Check status of a payment request */
  getPaymentStatus(externalRequestId: string): Promise<PaymentStatusResult>;
}
