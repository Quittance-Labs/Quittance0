import type { PayPageInvoice } from '@/components/pay-page.types';

export interface VerifyClassification {
  isOutage: boolean;
  isApiUnavailable: boolean;
  message: string;
  code?: string;
}

export type VerifyPaymentResult =
  | { ok: true; kind: 'success'; invoice: PayPageInvoice | null; txHash: string }
  | { ok: false; kind: 'validation'; error: string }
  | { ok: false; kind: 'outage'; message: string; retryable: true }
  | {
      ok: false;
      kind: 'rejection';
      message: string;
      code?: string;
      isApiUnavailable?: boolean;
      retryable: boolean;
    };

export interface ExecuteVerificationParams {
  invoiceId: string;
  txHash: string;
  payerName?: string;
  payerEmail?: string;
  verifyFn: (
    invoiceId: string,
    txHash: string,
    payer?: { payerName?: string; payerEmail?: string }
  ) => Promise<{ data?: PayPageInvoice | null }>;
  dispatch?: (event: unknown) => void;
}

export function validateTxHash(
  txHash?: string | null
): { ok: true; value: string } | { ok: false; error: string };

export function classifyVerifyError(error: unknown): VerifyClassification;

export function executePaymentVerification(
  params: ExecuteVerificationParams
): Promise<VerifyPaymentResult>;
