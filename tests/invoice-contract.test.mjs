/**
 * Shared invoice contract divergence guards (issue #446).
 * Runs via the root `npm run test:shared` script used by CI.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('shared invoice contract package', () => {
  it('ships invoice-contract.ts next to invoice.ts', () => {
    assert.equal(existsSync(path.join(root, 'shared/invoice-contract.ts')), true);
    assert.equal(existsSync(path.join(root, 'shared/invoice.ts')), true);
  });

  it('documents create/list/get/cancel/verify/stats in the OpenAPI constant', () => {
    const source = readFileSync(path.join(root, 'shared/invoice-contract.ts'), 'utf8');
    for (const token of [
      "'/invoices'",
      "'/invoices/{id}'",
      "'/invoices/{id}/cancel'",
      "'/invoices/{id}/verify'",
      "'/invoices/stats'",
      'REQUIRED_INVOICE_DTO_FIELDS',
      'parseCreateInvoiceRequest',
      'parseListInvoicesResponse',
      'parseVerifyPaymentResponse',
    ]) {
      assert.ok(source.includes(token), `missing ${token}`);
    }
  });
});
