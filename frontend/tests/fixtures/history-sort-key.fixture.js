export const historySortKeyFixture = [
  {
    input: { id: 'inv-1', createdAt: '2026-08-30T12:00:00.000Z' },
    expected: '001788091200000_inv-1',
  },
  {
    input: { id: 'inv-2', created_at: '2026-08-31T12:00:00.000Z' },
    expected: '001788177600000_inv-2',
  },
  {
    input: { id: 'inv-3', createdAt: new Date('2026-09-01T00:00:00.000Z') },
    expected: '001788220800000_inv-3',
  },
  {
    input: { id: 'inv-4', createdAt: 1788220800000 },
    expected: '001788220800000_inv-4',
  },
  {
    input: { id: 'inv-empty', createdAt: '' },
    expected: '000000000000000_inv-empty',
  },
  {
    input: { id: 'inv-invalid', createdAt: 'invalid-date' },
    expected: '000000000000000_inv-invalid',
  },
  {
    input: { id: 'inv-no-date' },
    expected: '000000000000000_inv-no-date',
  },
  {
    input: { createdAt: '2026-08-30T12:00:00.000Z' },
    expected: '001788091200000_',
  },
  {
    input: null,
    expected: '',
  },
  {
    input: undefined,
    expected: '',
  },
];
