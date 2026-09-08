export const payMemoHintFixture = [
  {
    name: 'required with memo',
    memo: 'INV-123',
    expected: 'Copy this memo exactly: “INV-123”',
  },
  {
    name: 'required without memo',
    memo: '',
    expected: 'A memo is required so the seller can match your payment.',
  },
  {
    name: 'null memo',
    memo: null,
    expected: 'A memo is required so the seller can match your payment.',
  },
  {
    name: 'undefined memo',
    memo: undefined,
    expected: 'A memo is required so the seller can match your payment.',
  },
  {
    name: 'trims whitespace',
    memo: '  INV-123  ',
    expected: 'Copy this memo exactly: “INV-123”',
  },
  {
    name: 'truncates long memo',
    memo: 'a'.repeat(30),
    expected: `Copy this memo exactly: “${'a'.repeat(24)}…”`,
  },
];
