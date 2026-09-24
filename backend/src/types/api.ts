import { Response } from 'express';
import type { VerificationCode } from '../services/payment-verification';
import type {
  ApiFailure as SharedApiFailure,
  ApiPagination as SharedApiPagination,
  ApiSuccess as SharedApiSuccess,
  ValidationFailureBody as SharedValidationFailureBody,
  VerificationFailureBody as SharedVerificationFailureBody,
} from '../../../shared/invoice-contract';

// Envelope types live in shared/invoice-contract.ts so Express handlers and the
// Next.js client agree on success/failure shapes (issue #446). HTTP helpers
// below stay backend-only because they need Express Response.
export type ApiPagination = SharedApiPagination;
export type ApiSuccess<T> = SharedApiSuccess<T>;
export type ApiFailure = SharedApiFailure;

export interface CancelInvoiceInput {
  sellerPublicKey?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function apiSuccess<T>(
  data: T,
  extra?: { message?: string; code?: string; warning?: string; pagination?: ApiPagination }
): ApiSuccess<T> {
  const body: ApiSuccess<T> = { success: true, data };

  if (extra?.message) {
    body.message = extra.message;
  }
  if (extra?.code) {
    body.code = extra.code;
  }
  if (extra?.warning) {
    body.warning = extra.warning;
  }
  if (extra?.pagination) {
    body.pagination = extra.pagination;
  }

  return body;
}

export function apiFailure(error: string): ApiFailure {
  return { success: false, error };
}

export function sendSuccess<T>(
  res: Response,
  status: number,
  data: T,
  extra?: { message?: string; code?: string; warning?: string; pagination?: ApiPagination }
): void {
  res.status(status).json(apiSuccess(data, extra));
}

export function sendFailure(res: Response, status: number, error: string): void {
  res.status(status).json(apiFailure(error));
}

/**
 * The envelope a refused payload is returned in.
 *
 * The error string stays the single sentence every client already reads;
 * fieldErrors is the same information keyed by payload field, so a form can
 * mark the inputs instead of showing one toast that names nothing.
 */
export type ValidationFailureBody = SharedValidationFailureBody;

export function sendValidationFailure(
  res: Response,
  error: string,
  fieldErrors: Record<string, string>
): void {
  res.status(400).json({
    success: false,
    code: 'VALIDATION_ERROR',
    error,
    fieldErrors,
  });
}

export function sendVerificationFailure(
  res: Response,
  status: number,
  code: VerificationCode,
  error: string
): void {
  res.status(status).json({ success: false, code, error });
}

/**
 * The envelope a verification rejection is returned in.
 *
 * `success` is the literal `false` rather than `boolean` so this discriminates
 * from a success envelope at the type level instead of only at runtime.
 */
export type VerificationFailureBody = SharedVerificationFailureBody;

/** Build a verification failure envelope with a stable code and its message. */
export function verificationFailureBody(
  code: VerificationCode,
  error: string
): VerificationFailureBody {
  return { success: false, code, error };
}

export default {
  apiSuccess,
  apiFailure,
  sendSuccess,
  sendFailure,
  verificationFailureBody,
};
