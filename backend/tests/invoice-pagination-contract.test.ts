import assert from 'node:assert/strict';
import { it } from 'node:test';
import { parseListInvoicesResponse } from '../../shared/invoice-contract';

const invoice = {
  id: 'invoice-pagination-contract',
  sellerPublicKey: 'seller',
  amount: 1,
  assetCode: 'XLM',
  memo: 'INVOICE',
  status: 'PENDING',
  createdAt: '2026-10-04T00:00:00.000Z',
  expiresAt: '2026-10-05T00:00:00.000Z',
};

it('preserves valid list pagination and normalizes only omitted metadata', () => {
  const pagination = { limit: 10, offset: 20, total: 31 };
  const explicit = parseListInvoicesResponse({ success: true, data: [invoice], pagination });
  assert.equal(explicit.success, true);
  if (explicit.success) {
    assert.deepEqual(explicit.data.pagination, pagination);
    assert.deepEqual(explicit.data.data, [invoice]);
  }
  const legacy = parseListInvoicesResponse({ success: true, data: [invoice] });
  assert.equal(legacy.success, true);
  if (legacy.success) assert.deepEqual(legacy.data.pagination, { limit: 1, offset: 0, total: 1 });
  const empty = parseListInvoicesResponse({
    success: true, data: [], pagination: { limit: 0, offset: 0, total: 0 },
  });
  assert.equal(empty.success, true);
});

it('rejects malformed supplied list pagination instead of inventing totals', () => {
  const valid = { limit: 10, offset: 0, total: 31 };
  const malformed = [
    null,
    [],
    { ...valid, limit: -1 },
    { ...valid, offset: 0.5 },
    { ...valid, total: Infinity },
    { ...valid, total: NaN },
    { ...valid, total: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, total: '31' },
    { limit: 10, total: 31 },
  ];
  for (const pagination of malformed) {
    assert.equal(
      parseListInvoicesResponse({ success: true, data: [invoice], pagination }).success,
      false,
      `accepted malformed pagination: ${JSON.stringify(pagination)}`,
    );
  }
});
