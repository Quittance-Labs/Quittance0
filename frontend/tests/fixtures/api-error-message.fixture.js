export const apiErrorMessageFixture = [
  {
    name: 'maps HTTP 404 status',
    error: { status: 404 },
    expected: 'The requested invoice or resource could not be found.',
  },
  {
    name: 'maps HTTP 500 nested status',
    error: { response: { status: 500 } },
    expected: 'The server encountered an error. Please try again shortly.',
  },
  {
    name: 'maps domain code',
    error: { code: 'INVOICE_EXPIRED' },
    expected: 'This invoice has expired and can no longer be paid.',
  },
  {
    name: 'maps string code',
    error: 'INVOICE_PAID',
    expected: 'This invoice has already been paid.',
  },
  {
    name: 'maps message text',
    error: { message: 'INVALID_MEMO' },
    expected: 'The payment memo is invalid or missing.',
  },
  {
    name: 'case-insensitive code matching',
    error: { code: 'invoice_expired' },
    expected: 'This invoice has expired and can no longer be paid.',
  },
  {
    name: 'returns default for unknown error',
    error: { code: 'UNKNOWN_CODE' },
    expected: 'Something went wrong. Please try again.',
  },
  {
    name: 'returns default for null',
    error: null,
    expected: 'Something went wrong. Please try again.',
  },
  {
    name: 'returns default for undefined',
    error: undefined,
    expected: 'Something went wrong. Please try again.',
  },
];
