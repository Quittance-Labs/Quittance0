export const monitorIntervalFixture = [
  { name: 'first attempt', attempt: 0, expected: 3000 },
  { name: 'second attempt', attempt: 1, expected: 6000 },
  { name: 'third attempt', attempt: 2, expected: 12000 },
  { name: 'fourth attempt', attempt: 3, expected: 24000 },
  { name: 'caps at maximum', attempt: 4, expected: 30000 },
  { name: 'stays at maximum for large attempt', attempt: 10, expected: 30000 },
  { name: 'negative attempt', attempt: -1, expected: 3000 },
  { name: 'null attempt', attempt: null, expected: 3000 },
  { name: 'undefined attempt', attempt: undefined, expected: 3000 },
];
