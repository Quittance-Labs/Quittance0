export const paymentMonitorIntervalFixture = [
  { name: 'pending', status: 'PENDING', expected: 5000 },
  { name: 'paid', status: 'PAID', expected: 30000 },
  { name: 'expired', status: 'EXPIRED', expected: 60000 },
  { name: 'cancelled', status: 'CANCELLED', expected: 60000 },
  { name: 'lowercase', status: 'pending', expected: 5000 },
  { name: 'unknown status', status: 'UNKNOWN', expected: 5000 },
  { name: 'null', status: null, expected: 5000 },
];
