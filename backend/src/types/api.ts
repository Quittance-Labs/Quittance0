import { Response } from 'express';
import type { VerificationCode, VerificationStage } from '../services/payment-verification';

// Shared response envelope used by both the MVP and the Postgres server.
// Both servers send the same success/failure shape so clients stay
// storage-agnostic: a frontend pointed at server-mvp.ts behaves exactly the
// same against server.ts (only persistence duration changes).
// sendSuccess / sendFailure wrap this envelope; they are shared helpers, so
// HTTP status codes and envelope keys are also pinned across backends.
export interface ApiPagination {
  limit: number;
  offset: number;
  total: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
  code?: string;
  warning?: string;
  pagination?: ApiPagination;
}

export interface ApiFailure {
  success: false;
  error: string;
  code?: VerificationCode;
}

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
export interface ValidationFailureBody {
  success: false;
  code: 'VALIDATION_ERROR';
  error: string;
  fieldErrors: Record<string, string>;
}

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
  error: string,
  extra?: { stage?: VerificationStage; details?: Record<string, unknown> }
): void {
  res.status(status).json({
    success: false,
    code,
    error,
    ...(extra?.stage ? { stage: extra.stage } : {}),
    ...(extra?.details ? { details: extra.details } : {}),
  });
}

/**
 * The envelope a verification rejection is returned in.
 *
 * `success` is the literal `false` rather than `boolean` so this discriminates
 * from a success envelope at the type level instead of only at runtime.
 */
export interface VerificationFailureBody {
  success: false;
  code: VerificationCode;
  error: string;
  stage?: VerificationStage;
  details?: Record<string, unknown>;
}

/** Build a verification failure envelope with a stable code and its message. */
export function verificationFailureBody(
  code: VerificationCode,
  error: string,
  extra?: { stage?: VerificationStage; details?: Record<string, unknown> }
): VerificationFailureBody {
  return {
    success: false,
    code,
    error,
    ...(extra?.stage ? { stage: extra.stage } : {}),
    ...(extra?.details ? { details: extra.details } : {}),
  };
}

export default {
  apiSuccess,
  apiFailure,
  sendSuccess,
  sendFailure,
  verificationFailureBody,
};
