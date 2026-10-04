import type { PaymentState } from '@/lib/payment-page-state';
import type { InvoiceDto } from '../../shared/invoice';
import type { PaymentInfoResult } from '../../shared/invoice-contract';

/**
 * Pay-page invoice shape. One shared DTO with the API client (issue #446).
 * Seller-only fields are optional and absent on anonymous pay responses.
 */
export type PayPageInvoice = InvoiceDto;

/** Payment instructions returned beside the invoice on the pay page. */
export type PayPagePaymentInfo = PaymentInfoResult;

export type PaymentSessionStatus =
  | 'loading'
  | 'ready'
  | 'paying'
  | 'verifying'
  | 'paid'
  | 'rejected'
  | 'unavailable';

export interface PayPageView {
  expired: boolean;
  cancelled: boolean;
  paid: boolean;
  showPaymentControls: boolean;
  showProof: boolean;
  showMonitor: boolean;
}

export interface PaymentSessionState {
  status: PaymentSessionStatus;
  invoice: PayPageInvoice | null;
  paymentInfo?: PayPagePaymentInfo | null;
  txHash: string | null;
  error: string | null;
  isOutage?: boolean;
}

export interface PayPageSession {
  invoice: PayPageInvoice | null;
  payment: PaymentState;
  status: PaymentSessionStatus;
  loading: boolean;
  loadError: string | null;
  paymentInfo: PayPagePaymentInfo | null;
  wallet: string | null;
  txHash: string;
  setTxHash: (value: string) => void;
  payerName: string;
  setPayerName: (value: string) => void;
  payerEmail: string;
  setPayerEmail: (value: string) => void;
  verifying: boolean;
  monitoring: boolean;
  resumeAvailable: boolean;
  view: PayPageView;
  dispatch: (event: unknown) => void;
  verify: (hashOverride?: string) => Promise<void>;
  reload: () => Promise<void>;
  copy: (text: string, label: string) => Promise<void>;
}
