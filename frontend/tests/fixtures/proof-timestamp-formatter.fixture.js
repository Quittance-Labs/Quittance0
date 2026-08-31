export const proofTimestampFormatterFixture = [
  {
    name: 'formats ISO string',
    input: '2026-08-31T12:00:00.000Z',
    expected: 'Aug',
  },
  {
    name: 'formats Date object',
    input: new Date('2026-08-31T12:00:00.000Z'),
    expected: 'Aug',
  },
  {
    name: 'formats timestamp number',
    input: new Date('2026-08-31T12:00:00.000Z').getTime(),
    expected: 'Aug',
  },
  {
    name: 'returns null for empty string',
    input: '',
    expected: null,
  },
  {
    name: 'returns null for null',
    input: null,
    expected: null,
  },
  {
    name: 'returns null for invalid date',
    input: 'not-a-date',
    expected: null,
  },
];
