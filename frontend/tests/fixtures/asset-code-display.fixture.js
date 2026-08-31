export const assetCodeDisplayFixture = [
  { name: 'uppercases lowercase code', input: 'usdc', expected: 'USDC' },
  { name: 'trims whitespace', input: '  XLM  ', expected: 'XLM' },
  { name: 'maps native to XLM', input: 'native', expected: 'XLM' },
  { name: 'returns XLM for empty', input: '', expected: 'XLM' },
  { name: 'returns XLM for null', input: null, expected: 'XLM' },
  { name: 'returns XLM for undefined', input: undefined, expected: 'XLM' },
  { name: 'returns XLM for invalid characters', input: 'US-DC', expected: 'XLM' },
  { name: 'returns XLM for too long', input: 'VERYLONGCODEM', expected: 'XLM' },
  { name: 'accepts 12 char code', input: 'ABCDEFGHIJKL', expected: 'ABCDEFGHIJKL' },
];
