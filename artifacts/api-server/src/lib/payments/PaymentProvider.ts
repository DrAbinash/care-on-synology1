export interface InitiatePaymentParams {
  bookingRef: string;
  name: string;
  phone: string;
  email?: string;
  amount: number;
  returnUrl: string;
  reqHeaders?: Record<string, string>;
}

export interface InitiatePaymentResult {
  success: boolean;
  gatewayTxnId?: string;
  redirectUrl?: string;
  qrData?: string; // For UPI QR base64/intent
  rawResponse: any;
  errorMessage?: string;
}

export interface VerifyPaymentParams {
  bookingRef: string;
  payload: any;
}

export interface VerifyPaymentResult {
  success: boolean;
  status: "paid" | "failed" | "pending";
  gatewayTxnId?: string;
  providerRefId?: string;
  rawResponse: any;
  errorMessage?: string;
}

export interface CheckStatusParams {
  bookingRef: string;
  gatewayTxnId?: string;
}

export interface CheckStatusResult {
  success: boolean;
  status: "paid" | "failed" | "pending";
  rawResponse: any;
  errorMessage?: string;
}

export interface RefundPaymentParams {
  bookingRef: string;
  gatewayTxnId: string;
  amount: number;
  reason?: string;
}

export interface RefundPaymentResult {
  success: boolean;
  refundTxnId?: string;
  rawResponse: any;
  errorMessage?: string;
}

export interface PaymentProvider {
  id: string;
  displayName: string;
  initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult>;
  verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult>;
  checkStatus(params: CheckStatusParams): Promise<CheckStatusResult>;
  refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult>;
}
