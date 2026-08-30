import { invoiceSharePath } from '../lib/invoice-share-path';
import { invoiceSharePathFixture } from './fixtures/invoice-share-path.fixture';

describe('invoiceSharePath', () => {
  it.each(invoiceSharePathFixture)('builds $output for $input', ({ input, output }) => {
    expect(invoiceSharePath(input)).toBe(output);
  });

  it('encodes reserved URL characters', () => {
    expect(invoiceSharePath('a/b?c')).toBe('/pay/a%2Fb%3Fc');
  });
});
