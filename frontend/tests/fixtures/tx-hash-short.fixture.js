export const VALID_TX_HASH = 'a'.repeat(64);

export const txHashShortFixture = [
  {
    name: 'default head and tail',
    txHash: VALID_TX_HASH,
    expected: 'aaaaaa...aaaa',
  },
  {
    name: 'custom head and tail',
    txHash: VALID_TX_HASH,
    head: 4,
    tail: 4,
    expected: 'aaaa...aaaa',
  },
  {
    name: 'uppercase hash normalised',
    txHash: VALID_TX_HASH.toUpperCase(),
    expected: 'aaaaaa...aaaa',
  },
];

export const txHashShortErrorFixture = [
  {
    name: 'returns null for empty hash',
    txHash: '',
  },
  {
    name: 'returns null for null hash',
    txHash: null,
  },
  {
    name: 'returns null for invalid format',
    txHash: 'not-a-hash',
  },
  {
    name: 'returns null for short hash',
    txHash: 'a'.repeat(63),
  },
  {
    name: 'returns null when head too small',
    txHash: VALID_TX_HASH,
    head: 0,
    tail: 4,
  },
  {
    name: 'returns null when head + tail too long',
    txHash: VALID_TX_HASH,
    head: 60,
    tail: 5,
  },
];
