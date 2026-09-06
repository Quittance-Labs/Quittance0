/**
 * Maps an API error into a user-safe English error message.
 * Extracts backend error messages, HTTP status codes (e.g. 404),
 * transport errors, or falls back to a safe default.
 * Prevents raw stack traces from leaking to the UI.
 */
export function mapApiError(error: any, fallback = 'Something went wrong.'): string {
  if (!error) {
    return fallback;
  }

  const serverMessage = error?.response?.data?.error ?? error?.response?.data?.message;
  if (typeof serverMessage === 'string' && serverMessage.trim()) {
    return serverMessage.trim();
  }

  if (error?.response?.status === 404) {
    return 'Not found.';
  }

  if (error?.response?.status === 500) {
    return 'Internal server error.';
  }

  const transportMessage = error?.message;
  if (typeof transportMessage === 'string' && transportMessage.trim()) {
    if (transportMessage.includes('\n') || transportMessage.includes('at ')) {
      return fallback;
    }
    return transportMessage.trim();
  }

  return fallback;
}
