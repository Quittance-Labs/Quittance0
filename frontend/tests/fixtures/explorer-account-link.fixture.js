export const VALID_PUBLIC_KEY =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHK';

export const VALID_TESTNET_PUBLIC_KEY =
  'GBZF4ANGCFSVLN4WCZSCAS4OA3QXYIBNKQQPL3OVOZASX3MJPTX6NXT7';

export const INVALID_PUBLIC_KEY = 'not-a-valid-key';

export const explorerAccountLinkFixture = [
  {
    name: 'public network default',
    publicKey: VALID_PUBLIC_KEY,
    network: 'public',
    expected: `https://stellar.expert/explorer/public/account/${VALID_PUBLIC_KEY}`,
  },
  {
    name: 'testnet network',
    publicKey: VALID_TESTNET_PUBLIC_KEY,
    network: 'testnet',
    expected: `https://stellar.expert/explorer/testnet/account/${VALID_TESTNET_PUBLIC_KEY}`,
  },
  {
    name: 'trims whitespace from key',
    publicKey: `  ${VALID_PUBLIC_KEY}  `,
    network: 'public',
    expected: `https://stellar.expert/explorer/public/account/${VALID_PUBLIC_KEY}`,
  },
  {
    name: 'defaults to public network',
    publicKey: VALID_PUBLIC_KEY,
    network: undefined,
    expected: `https://stellar.expert/explorer/public/account/${VALID_PUBLIC_KEY}`,
  },
  {
    name: 'falls back to public for unknown network',
    publicKey: VALID_PUBLIC_KEY,
    network: 'unknown',
    expected: `https://stellar.expert/explorer/public/account/${VALID_PUBLIC_KEY}`,
  },
];

export const explorerAccountLinkErrorFixture = [
  {
    name: 'returns null for empty key',
    publicKey: '',
    network: 'public',
  },
  {
    name: 'returns null for null key',
    publicKey: null,
    network: 'public',
  },
  {
    name: 'returns null for undefined key',
    publicKey: undefined,
    network: 'public',
  },
  {
    name: 'returns null for invalid format',
    publicKey: INVALID_PUBLIC_KEY,
    network: 'public',
  },
  {
    name: 'returns null for short key',
    publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH',
    network: 'public',
  },
  {
    name: 'returns null for lowercase key',
    publicKey: VALID_PUBLIC_KEY.toLowerCase(),
    network: 'public',
  },
];
