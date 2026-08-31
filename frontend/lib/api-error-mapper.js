// API error message mapper.
//
// Translates backend error codes and HTTP statuses into plain-language messages
// shown to users, keeping copy consistent across forms and async panels.

const DEFAULT_MESSAGE = 'Something went wrong. Please try again.';

const ERROR_MESSAGES = Object.freeze({
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

/**
 * Map an API error to a user-facing message.
 *
 * @param {Error | { message?: string; code?: string; status?: number } | string | undefined | null} error - Error object, response shape, or code string.
 * @returns {string} Human-readable message.
 */
function mapApiErrorMessage(error) {
  if (!error) {
    return DEFAULT_MESSAGE;
  }

  if (typeof error === 'string') {
    return ERROR_MESSAGES[error.trim().toUpperCase()] ?? DEFAULT_MESSAGE;
  }

  const code = error.code;
  if (code && typeof code === 'string') {
    const message = ERROR_MESSAGES[code.trim().toUpperCase()];
    if (message) return message;
  }

  const status = error.status ?? error.response?.status;
  if (typeof status === 'number' && ERROR_MESSAGES[status]) {
    return ERROR_MESSAGES[status];
  }

  const message = error.message;
  if (message && typeof message === 'string') {
    const upper = message.trim().toUpperCase();
    if (ERROR_MESSAGES[upper]) {
      return ERROR_MESSAGES[upper];
    }
  }

  return DEFAULT_MESSAGE;
}

module.exports = { mapApiErrorMessage };
