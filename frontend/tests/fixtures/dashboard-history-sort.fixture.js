export const dashboardHistorySortFixture = [
  {
    name: 'createdAt desc',
    invoice: { createdAt: '2026-08-31T12:00:00.000Z', amount: 100, status: 'PENDING' },
    field: 'createdAt',
    direction: 'desc',
    expected: -new Date('2026-08-31T12:00:00.000Z').getTime(),
  },
  {
    name: 'createdAt asc',
    invoice: { createdAt: '2026-08-31T12:00:00.000Z', amount: 100, status: 'PENDING' },
    field: 'createdAt',
    direction: 'asc',
    expected: new Date('2026-08-31T12:00:00.000Z').getTime(),
  },
  {
    name: 'amount desc',
    invoice: { createdAt: '2026-08-31T12:00:00.000Z', amount: 100, status: 'PENDING' },
    field: 'amount',
    direction: 'desc',
    expected: -100,
  },
  {
    name: 'status',
    invoice: { createdAt: '2026-08-31T12:00:00.000Z', amount: 100, status: 'PAID' },
    field: 'status',
    direction: 'desc',
    expected: 'paid',
  },
  {
    name: 'null invoice desc',
    invoice: null,
    field: 'createdAt',
    direction: 'desc',
    expected: Number.NEGATIVE_INFINITY,
  },
];
