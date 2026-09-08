export const VALID_TX_HASH = 'a'.repeat(64);

export const shortTxHashFixture = [
  {
    name: 'default head and tail',
    hash: VALID_TX_HASH,
    expected: 'aaaaaa...aaaa',
  },
  {
    name: 'custom head and tail',
    hash: VALID_TX_HASH,
    head: 4,
    tail: 4,
    expected: 'aaaa...aaaa',
  },
  {
    name: 'uppercase hash normalised',
    hash: VALID_TX_HASH.toUpperCase(),
    expected: 'aaaaaa...aaaa',
  },
  {
    name: 'custom head only',
    hash: VALID_TX_HASH,
    head: 8,
    expected: 'aaaaaaaa...aaaa',
  },
];

export const shortTxHashErrorFixture = [
  {
    name: 'returns null for empty hash',
    hash: '',
  },
  {
    name: 'returns null for null hash',
    hash: null,
  },
  {
    name: 'returns null for undefined hash',
    hash: undefined,
  },
  {
    name: 'returns null for invalid format',
    hash: 'not-a-hash',
  },
  {
    name: 'returns null for short hash',
    hash: 'a'.repeat(63),
  },
  {
    name: 'returns null when head is zero',
    hash: VALID_TX_HASH,
    head: 0,
    tail: 4,
  },
  {
    name: 'returns null when head plus tail overflows',
    hash: VALID_TX_HASH,
    head: 60,
    tail: 10,
  },
];
