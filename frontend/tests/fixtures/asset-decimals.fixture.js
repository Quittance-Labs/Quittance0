export const assetDecimalsFixture = [
  { name: 'XLM', assetCode: 'XLM', expected: 7 },
  { name: 'USDC', assetCode: 'USDC', expected: 7 },
  { name: 'USDT', assetCode: 'USDT', expected: 7 },
  { name: 'lowercase', assetCode: 'usdc', expected: 7 },
  { name: 'unknown asset', assetCode: 'EURT', expected: 7 },
  { name: 'null', assetCode: null, expected: 7 },
  { name: 'undefined', assetCode: undefined, expected: 7 },
  { name: 'empty', assetCode: '', expected: 7 },
];
