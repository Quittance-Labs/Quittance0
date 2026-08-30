import { networkDisplayName } from '../lib/network-display-name';
import { networkDisplayNameFixture } from './fixtures/network-display-name.fixture';

describe('networkDisplayName', () => {
  it.each(networkDisplayNameFixture)('maps $input to $output', ({ input, output }) => {
    expect(networkDisplayName(input)).toBe(output);
  });

  it('handles surrounding whitespace and casing', () => {
    expect(networkDisplayName('  TESTNET  ')).toBe('Testnet');
  });
});
