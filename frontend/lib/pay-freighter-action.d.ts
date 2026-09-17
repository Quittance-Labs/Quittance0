import type { WalletGateResult } from './freighter-availability';
import type { InvoiceUnavailableGate } from './payment-page-state';

export interface FreighterPaymentActionOptions {
  destination: string;
  amount: string;
  memo: string;
  assetCode?: string;
  assetIssuer?: string;
  invoiceId?: string;
  invoiceStatus?: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  payerName?: string;
  payerEmail?: string;
  walletGate?: WalletGateResult | InvoiceUnavailableGate;
  checkConnectionFn?: () => Promise<boolean>;
  requestAccessFn?: () => Promise<boolean>;
  getNetworkFn?: () => Promise<{ networkPassphrase?: string | null; network?: string | null } | null>;
  isWrongNetworkFn?: (network?: string) => boolean;
  sendPaymentFn: (
    destination: string,
    amount: string,
    memo: string,
    assetCode?: string,
    assetIssuer?: string
  ) => Promise<string>;
  verifyFn?: (
    invoiceId: string,
    txHash: string,
    payer?: { payerName?: string; payerEmail?: string }
  ) => Promise<{ data?: any }>;
  dispatch?: (event: any) => void;
  onStart?: () => void;
  onSent?: (txHash: string) => void;
  onSuccess?: (txHash: string) => void;
  onError?: (title: string, description?: string) => void;
  onWarning?: (message: string) => void;
}

export type FreighterPaymentResult =
  | { ok: true; kind: 'success'; txHash: string; verified: boolean; warning?: string | null }
  | { ok: false; kind: 'gate_blocked'; message: string }
  | { ok: false; kind: 'invoice_unavailable'; message: string }
  | { ok: false; kind: 'invalid_payer'; message: string }
  | { ok: false; kind: 'not_installed'; message: string }
  | { ok: false; kind: 'access_denied'; message: string }
  | { ok: false; kind: 'wrong_network'; message: string }
  | {
      ok: false;
      kind: 'payment_failed';
      message: string;
      description: string;
      missingTrustline: boolean;
    };

export function isMissingTrustlineError(error: unknown, assetCode?: string): boolean;

export function validateFreighterPreflight(params: {
  walletGate?: WalletGateResult | InvoiceUnavailableGate;
  invoiceStatus?: string;
  payerName?: string;
  payerEmail?: string;
}):
  | { ok: true; payer: { payerName?: string; payerEmail?: string } }
  | { ok: false; kind: string; message: string };

export function executeFreighterPayment(
  options: FreighterPaymentActionOptions
): Promise<FreighterPaymentResult>;
