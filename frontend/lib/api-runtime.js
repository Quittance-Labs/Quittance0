const LOCAL_API_URL = 'http://localhost:3001/api';
const UNCONFIGURED_API_URL = 'https://configuration.invalid/api';
const OFFLINE_MESSAGE = 'Quittance API is unreachable. Check your connection and try again.';

class ApiUnavailableError extends Error {
  constructor(message = OFFLINE_MESSAGE, cause) {
    super(message, { cause });
    this.name = 'ApiUnavailableError';
    this.code = 'API_UNREACHABLE';
    this.retryable = true;
  }
}

class ApiRequestError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ApiRequestError';
    this.code = options.code || 'API_REQUEST_FAILED';
    this.status = options.status;
    this.retryable = Boolean(options.retryable);
  }
}

function resolveApiConfig(configuredUrl, nodeEnv = 'development') {
  const raw = (configuredUrl || '').trim();
  if (!raw) {
    if (nodeEnv !== 'production') {
      return { baseUrl: LOCAL_API_URL, configured: true, error: null };
    }
    return {
      baseUrl: UNCONFIGURED_API_URL,
      configured: false,
      error: 'NEXT_PUBLIC_API_URL is not configured for this deployment.',
    };
  }

  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, '');
    if (!['http:', 'https:'].includes(url.protocol) || !path.endsWith('/api')) {
      throw new Error('URL must be HTTP(S) and end in /api');
    }
    if (nodeEnv === 'production' && url.protocol !== 'https:') {
      throw new Error('Production API URL must use HTTPS');
    }
    url.pathname = path;
    url.search = '';
    url.hash = '';
    return { baseUrl: url.toString().replace(/\/$/, ''), configured: true, error: null };
  } catch (error) {
    return {
      baseUrl: UNCONFIGURED_API_URL,
      configured: false,
      error: `Invalid NEXT_PUBLIC_API_URL: ${error.message}`,
    };
  }
}

function toApiError(error) {
  if (error instanceof ApiUnavailableError || error instanceof ApiRequestError) return error;

  const status = error?.response?.status;
  const responseData = error?.response?.data;
  const networkFailure =
    !error?.response ||
    ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(error?.code) ||
    Number(status) >= 500;

  if (networkFailure) return new ApiUnavailableError(OFFLINE_MESSAGE, error);

  return new ApiRequestError(
    responseData?.error || error?.message || 'Quittance API request failed.',
    {
      cause: error,
      code: responseData?.code,
      status,
      retryable: status === 408 || status === 429,
    }
  );
}

function isApiUnavailableError(error) {
  return error?.code === 'API_UNREACHABLE' || error instanceof ApiUnavailableError;
}

function apiErrorMessage(error, fallback = 'Request failed. Please try again.') {
  return toApiError(error)?.message || fallback;
}

module.exports = {
  LOCAL_API_URL,
  OFFLINE_MESSAGE,
  ApiUnavailableError,
  ApiRequestError,
  resolveApiConfig,
  toApiError,
  isApiUnavailableError,
  apiErrorMessage,
};
