export const apiErrorMessageFixture = [
  {
    input: { response: { data: { error: 'Invoice has expired' } } },
    expected: 'Invoice has expired',
  },
  {
    input: { response: { data: { message: 'Invalid payment amount' } } },
    expected: 'Invalid payment amount',
  },
  {
    input: { response: { status: 404 } },
    expected: 'Not found.',
  },
  {
    input: { response: { status: 500 } },
    expected: 'Internal server error.',
  },
  {
    input: { message: 'Network request failed' },
    expected: 'Network request failed',
  },
  {
    input: { message: 'Error: crash\n    at Object.<anonymous> (/app/index.js:1:1)' },
    expected: 'Something went wrong.',
  },
  {
    input: {},
    expected: 'Something went wrong.',
  },
  {
    input: null,
    expected: 'Something went wrong.',
  },
  {
    input: undefined,
    expected: 'Something went wrong.',
  },
];
