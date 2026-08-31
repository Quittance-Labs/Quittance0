export const VALID_PUBLIC_KEY =
  'GABM4I5HA6FFSXYOEL52EECGIA2FH4QPP5HM3CDUHSPE3QRE2SSKBQI6';

export const walletInitialsFixture = [
  {
    name: 'returns first two chars after G',
    publicKey: VALID_PUBLIC_KEY,
    expected: 'AB',
  },
  {
    name: 'uppercases result',
    publicKey: VALID_PUBLIC_KEY.toLowerCase(),
    expected: 'AB',
  },
];

export const walletInitialsErrorFixture = [
  { name: 'returns fallback for empty', publicKey: '' },
  { name: 'returns fallback for null', publicKey: null },
  { name: 'returns fallback for undefined', publicKey: undefined },
  { name: 'returns fallback for short key', publicKey: 'G' + 'A'.repeat(54) },
  { name: 'returns fallback for non-base32', publicKey: 'G' + '!'.repeat(55) },
];
