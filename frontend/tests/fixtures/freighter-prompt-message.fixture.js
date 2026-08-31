export const freighterPromptMessageFixture = [
  {
    name: 'default action',
    action: undefined,
    expected: 'You need the Freighter browser extension before you can continue. Install it from https://www.freighter.app/',
  },
  {
    name: 'custom action',
    action: 'pay',
    expected: 'You need the Freighter browser extension before you can pay. Install it from https://www.freighter.app/',
  },
];
