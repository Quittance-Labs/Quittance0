export const apiErrorMapperFixture = [
  {
    name: 'maps status 404',
    error: { status: 404 },
    expected: 'The requested invoice or resource could not be found.',
  },
  {
    name: 'maps status 500',
    error: { status: 500 },
    expected: 'The server encountered an error. Please try again shortly.',
  },
  {
    name: 'maps code string',
    error: 'INVOICE_EXPIRED',
    expected: 'This invoice has expired and can no longer be paid.',
  },
  {
    name: 'maps code property',
    error: { code: 'INVALID_MEMO' },
    expected: 'The payment memo is invalid or missing.',
  },
  {
    name: 'maps response status',
    error: { response: { status: 429 } },
    expected: 'Too many requests. Please wait a moment and try again.',
  },
  {
    name: 'returns default for unknown',
    error: { message: 'unknown error' },
    expected: 'Something went wrong. Please try again.',
  },
  {
    name: 'returns default for null',
    error: null,
    expected: 'Something went wrong. Please try again.',
  },
];
