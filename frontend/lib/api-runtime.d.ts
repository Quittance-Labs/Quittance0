export interface ApiConfig {
  baseUrl: string;
  configured: boolean;
  error: string | null;
}

export class ApiUnavailableError extends Error {
  code: 'API_UNREACHABLE';
  retryable: true;
}

export class ApiRequestError extends Error {
  code: string;
  status?: number;
  retryable: boolean;
}

export const LOCAL_API_URL: string;
export const OFFLINE_MESSAGE: string;
export function resolveApiConfig(configuredUrl?: string, nodeEnv?: string): ApiConfig;
export function toApiError(error: unknown): ApiUnavailableError | ApiRequestError;
export function isApiUnavailableError(error: unknown): boolean;
export function apiErrorMessage(error: unknown, fallback?: string): string;
