export const freighterPromptCopyFixture = [
  {
    name: 'default variant',
    variant: undefined,
    expected:
      'You need the Freighter browser extension before you can continue. Install it from',
  },
  {
    name: 'pay variant',
    variant: 'pay',
    expected:
      'You need the Freighter browser extension before you can pay. Install it from',
  },
  {
    name: 'create variant',
    variant: 'create',
    expected:
      'You need the Freighter browser extension before you can create an invoice. Install it from',
  },
  {
    name: 'unknown variant falls back to default',
    variant: 'unknown',
    expected:
      'You need the Freighter browser extension before you can continue. Install it from',
  },
  {
    name: 'case-insensitive variant',
    variant: 'PAY',
    expected:
      'You need the Freighter browser extension before you can pay. Install it from',
  },
];
