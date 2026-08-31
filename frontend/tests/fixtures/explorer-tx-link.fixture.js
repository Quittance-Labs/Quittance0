export const VALID_TX_HASH =
  'a'.repeat(64);

export const VALID_TESTNET_TX_HASH =
  'b'.repeat(64);

export const INVALID_HASH = 'not-a-valid-hash';

export const explorerTxLinkFixture = [
  {
    name: 'public network default',
    txHash: VALID_TX_HASH,
    network: 'public',
    expected: `https://stellar.expert/explorer/public/tx/${VALID_TX_HASH}`,
  },
  {
    name: 'testnet network',
    txHash: VALID_TESTNET_TX_HASH,
    network: 'testnet',
    expected: `https://stellar.expert/explorer/testnet/tx/${VALID_TESTNET_TX_HASH}`,
  },
  {
    name: 'trims whitespace from hash',
    txHash: `  ${VALID_TX_HASH}  `,
    network: 'public',
    expected: `https://stellar.expert/explorer/public/tx/${VALID_TX_HASH}`,
  },
];

export const explorerTxLinkErrorFixture = [
  {
    name: 'returns null for empty hash',
    txHash: '',
    network: 'public',
  },
  {
    name: 'returns null for null hash',
    txHash: null,
    network: 'public',
  },
  {
    name: 'returns null for invalid hash format',
    txHash: INVALID_HASH,
    network: 'public',
  },
  {
    name: 'returns null for short hash',
    txHash: 'a'.repeat(63),
    network: 'public',
  },
];
