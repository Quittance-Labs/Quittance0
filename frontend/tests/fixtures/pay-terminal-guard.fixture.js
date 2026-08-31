export const payTerminalGuardFixture = [
  { name: 'paid', status: 'PAID', expected: true },
  { name: 'expired', status: 'EXPIRED', expected: true },
  { name: 'cancelled', status: 'CANCELLED', expected: true },
  { name: 'pending', status: 'PENDING', expected: false },
  { name: 'lowercase', status: 'paid', expected: true },
  { name: 'mixed case', status: 'Paid', expected: true },
  { name: 'whitespace', status: '  PAID  ', expected: true },
  { name: 'null', status: null, expected: false },
  { name: 'undefined', status: undefined, expected: false },
  { name: 'unknown', status: 'UNKNOWN', expected: false },
];
