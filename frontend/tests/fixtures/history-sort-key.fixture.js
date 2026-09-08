const baseTime = new Date('2026-08-31T12:00:00.000Z').getTime();

export const historySortKeyFixture = [
  {
    name: 'uses createdAt',
    invoice: { createdAt: '2026-08-31T12:00:00.000Z' },
    expected: baseTime,
  },
  {
    name: 'uses Date object',
    invoice: { createdAt: new Date('2026-08-31T12:00:00.000Z') },
    expected: baseTime,
  },
  {
    name: 'falls back to expiresAt when createdAt missing',
    invoice: { expiresAt: '2026-08-31T12:00:00.000Z' },
    expected: baseTime,
  },
  {
    name: 'falls back to paidAt when createdAt and expiresAt missing',
    invoice: { paidAt: '2026-08-31T12:00:00.000Z' },
    expected: baseTime,
  },
  {
    name: 'returns 0 for invalid date',
    invoice: { createdAt: 'not-a-date' },
    expected: 0,
  },
  {
    name: 'returns 0 for null invoice',
    invoice: null,
    expected: 0,
  },
  {
    name: 'returns 0 for empty invoice',
    invoice: {},
    expected: 0,
  },
];
