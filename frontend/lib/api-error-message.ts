// API error message mapper.
// Translates backend error codes and HTTP statuses into plain-language messages
// shown to users, keeping copy consistent across forms and async panels.

const DEFAULT_MESSAGE = 'Something went wrong. Please try again.';

const ERROR_MESSAGES: Record<string, string> = Object.freeze({
  // Generic HTTP statuses
  400: 'The request was invalid. Please check your input and try again.',
  401: 'Your session has expired. Please reconnect your wallet.',
  403: 'You do not have permission to perform this action.',
  404: 'The requested invoice or resource could not be found.',
  409: 'This action conflicts with the current state. Please refresh and try again.',
  422: 'We could not process your request. Please check the highlighted fields.',
  429: 'Too many requests. Please wait a moment and try again.',
  500: 'The server encountered an error. Please try again shortly.',
  502: 'The service is temporarily unavailable. Please try again shortly.',
  503: 'The service is temporarily unavailable. Please try again shortly.',
  // Domain codes
  INVOICE_EXPIRED: 'This invoice has expired and can no longer be paid.',
  INVOICE_PAID: 'This invoice has already been paid.',
  INSUFFICIENT_BALANCE: 'Your wallet balance is too low for this payment.',
  INVALID_MEMO: 'The payment memo is invalid or missing.',
  INVALID_AMOUNT: 'The payment amount is invalid.',
  ASSET_NOT_SUPPORTED: 'This asset is not supported for the requested invoice.',
  WALLET_NOT_CONNECTED: 'Please connect your Freighter wallet first.',
});

function lookupMessage(key: string): string | undefined {
  return ERROR_MESSAGES[key.trim().toUpperCase()];
}

/**
 * Map an API error to a user-facing message.
 *
 * @param error - Error object, response shape, or code string.
 * @returns Human-readable message.
 */
export function mapApiError(error: unknown): string {
  if (error === null || error === undefined) {
    return DEFAULT_MESSAGE;
  }

  if (typeof error === 'string') {
    return lookupMessage(error) ?? DEFAULT_MESSAGE;
  }

  const err = error as Record<string, unknown>;

  const code = err.code;
  if (typeof code === 'string') {
    const message = lookupMessage(code);
    if (message) return message;
  }

  const status = err.status ?? err.response?.status;
  if (typeof status === 'number' && ERROR_MESSAGES[String(status)]) {
    return ERROR_MESSAGES[String(status)];
  }

  const errMessage = err.message;
  if (typeof errMessage === 'string') {
    const message = lookupMessage(errMessage);
    if (message) return message;
  }

  return DEFAULT_MESSAGE;
}
