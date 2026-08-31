export const walletStorageKeyFixture = [
  { name: 'public network', input: 'public', expected: 'quittance:wallet:public' },
  { name: 'testnet network', input: 'testnet', expected: 'quittance:wallet:testnet' },
  { name: 'uppercase testnet', input: 'TESTNET', expected: 'quittance:wallet:testnet' },
  { name: 'mixed case public', input: 'Public', expected: 'quittance:wallet:public' },
  { name: 'unknown network', input: 'custom', expected: 'quittance:wallet:custom' },
  { name: 'null fallback', input: null, expected: 'quittance:wallet:unknown' },
  { name: 'undefined fallback', input: undefined, expected: 'quittance:wallet:unknown' },
];
