export type VerificationCode =
  | 'MISSING_TX_HASH'
  | 'INVALID_TX_HASH'
  | 'INVALID_PAYER_NAME'
  | 'INVALID_PAYER_EMAIL'
  | 'PAYER_INFO_TOO_LONG'
  | 'VERIFY_RATE_LIMIT_EXCEEDED'
  | 'INVOICE_ALREADY_PAID'
  | 'INVOICE_EXPIRED'
  | 'INVOICE_NOT_PENDING'
  | 'TRANSACTION_NOT_FOUND'
  | 'TRANSACTION_CLOSE_TIME_UNAVAILABLE'
  | 'NO_PAYMENT_OPERATION'
  | 'MEMO_MISMATCH'
  | 'DESTINATION_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'AMOUNT_TOO_LOW'
  | 'AMOUNT_TOO_HIGH'
  | 'ASSET_MISMATCH'
  | 'NETWORK_MISMATCH'
  | 'TX_HASH_ALREADY_USED'
  | 'INVALID_MEMO_TYPE';

export interface VerificationFailure {
  ok: false;
  code: VerificationCode;
  error: string;
}

export interface VerificationSuccess<T> {
  ok: true;
  value: T;
}

export type VerificationResult<T> = VerificationSuccess<T> | VerificationFailure;

export interface PayerInfo {
  payerName?: string;
  payerEmail?: string;
}

export const VERIFICATION_MESSAGES: Record<VerificationCode, string>;

export function messageForCode(code: unknown): string | undefined;

export function failure(code: VerificationCode): VerificationFailure;

export function isValidTxHash(txHash: unknown): boolean;

export function checkTxHash(txHash: unknown): VerificationResult<string>;

export function checkPayerInfo(input: PayerInfo): VerificationResult<PayerInfo>;

export function resolveVerificationError(error: unknown, fallback?: string): string;
