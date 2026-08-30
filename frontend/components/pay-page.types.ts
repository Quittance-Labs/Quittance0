export interface PayPageInvoice {
  [key: string]: unknown;
  id: string;
  amount: number;
  assetCode: string;
  assetIssuer?: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  sellerPublicKey: string;
  sellerName?: string;
  sellerEmail?: string;
  memo: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  createdAt: string;
  expiresAt: string;
  paidAt?: string;
  paymentTxHash?: string;
  payerName?: string;
  payerEmail?: string;
  payerPublicKey?: string;
}

export interface PayPagePaymentInfo {
  stellarQrCode?: string;
  paymentUrl?: string;
  statusPollingIntervalMs?: number;
}
