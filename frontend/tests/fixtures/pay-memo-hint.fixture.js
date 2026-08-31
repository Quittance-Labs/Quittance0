export const payMemoHintFixture = [
  {
    name: 'required with memo',
    memo: 'INV-123',
    required: true,
    expected: 'Copy this memo exactly: “INV-123”',
  },
  {
    name: 'required without memo',
    memo: '',
    required: true,
    expected: 'A memo is required so the seller can match your payment.',
  },
  {
    name: 'optional with memo',
    memo: 'optional-memo',
    required: false,
    expected: 'Optional memo: “optional-memo”',
  },
  {
    name: 'optional without memo',
    memo: null,
    required: false,
    expected: 'No memo is needed for this payment.',
  },
  {
    name: 'truncates long memo',
    memo: 'a'.repeat(30),
    required: true,
    expected: `Copy this memo exactly: “${'a'.repeat(24)}…”`,
  },
];
