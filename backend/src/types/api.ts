import { Response } from 'express';
import type { VerificationCode } from '../services/payment-verification';

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
  pagination?: ApiPagination;
}

export interface ApiFailure {
  success: false;
  error: string;
  code?: VerificationCode;
}

export type VerificationFailureBody = {
  success: false;
  code: VerificationCode;
  error: string;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function apiSuccess<T>(
  data: T,
  extra?: { message?: string; pagination?: ApiPagination }
): ApiSuccess<T> {
  const body: ApiSuccess<T> = { success: true, data };

  if (extra?.message) {
    body.message = extra.message;
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
  extra?: { message?: string; pagination?: ApiPagination }
): void {
  res.status(status).json(apiSuccess(data, extra));
}

export function sendFailure(res: Response, status: number, error: string): void {
  res.status(status).json(apiFailure(error));
}

export function sendVerificationFailure(
  res: Response,
  status: number,
  code: VerificationCode,
  error: string
): void {
  res.status(status).json({ success: false, code, error });
}

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
