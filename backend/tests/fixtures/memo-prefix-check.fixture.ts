export interface MemoPrefixFixture {
  memo: unknown;
  expected: boolean;
  description: string;
}

export const VALID_MEMO_PREFIX_FIXTURES: MemoPrefixFixture[] = [
  { memo: 'INV-123-ABC', expected: true, description: 'standard generated format' },
  { memo: 'INV-TIMESTAMP-RANDOM', expected: true, description: 'placeholder format' },
  { memo: 'INV-0', expected: true, description: 'minimal valid prefix with suffix' },
  { memo: 'INV-', expected: true, description: 'bare prefix' },
  { memo: 'INV-A1B2C3D4-E5F6G7H8', expected: true, description: 'hex-like alphanumeric memo' },
];

export const INVALID_MEMO_PREFIX_FIXTURES: MemoPrefixFixture[] = [
  { memo: 'ORDER-12345', expected: false, description: 'alternate prefix ORDER-' },
  { memo: 'PAY-INV-123', expected: false, description: 'nested prefix not at start' },
  { memo: 'inv-123-abc', expected: false, description: 'lowercase prefix' },
  { memo: 'INVOICE-123', expected: false, description: 'unabbreviated prefix' },
  { memo: '', expected: false, description: 'empty string' },
  { memo: '   ', expected: false, description: 'whitespace only' },
  { memo: ' INV-123', expected: false, description: 'leading whitespace' },
  { memo: null, expected: false, description: 'null input' },
  { memo: undefined, expected: false, description: 'undefined input' },
  { memo: 123456, expected: false, description: 'numeric input' },
  { memo: {}, expected: false, description: 'object input' },
  { memo: ['INV-123'], expected: false, description: 'array input' },
];
