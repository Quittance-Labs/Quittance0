export const statusLabelFixture = [
  { input: 'PENDING', expected: 'Waiting for Payment' },
  { input: 'PAID', expected: 'Paid' },
  { input: 'EXPIRED', expected: 'Expired' },
  { input: 'CANCELLED', expected: 'Cancelled' },
  { input: 'pending', expected: 'Waiting for Payment' },
  { input: 'paid', expected: 'Paid' },
  { input: ' PENDING ', expected: 'Waiting for Payment' },
  { input: '', expected: 'Unknown' },
  { input: null, expected: 'Unknown' },
  { input: undefined, expected: 'Unknown' },
  { input: 'UNKNOWN', expected: 'Unknown' },
];
