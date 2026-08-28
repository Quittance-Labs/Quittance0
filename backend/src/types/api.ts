import { Response } from 'express';

// Shared response envelope used by both the MVP and the Postgres server.
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
}

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

export default {
  apiSuccess,
  apiFailure,
  sendSuccess,
  sendFailure,
};
