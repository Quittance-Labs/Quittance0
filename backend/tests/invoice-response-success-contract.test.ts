import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as contract from '../../shared/invoice-contract';

const invoice = {
  id: 'invoice-response-contract',
  sellerPublicKey: 'G' + 'A'.repeat(55),
  amount: 1,
  assetCode: 'XLM',
  memo: 'invoice-response-contract',
  status: 'PENDING',
  createdAt: '2026-10-04T00:00:00.000Z',
  expiresAt: '2026-10-05T00:00:00.000Z',
};
const payment = { invoice, paymentAvailable: true, paymentUrl: '/pay/example' };
const stats = {
  total_invoices: 1,
  paid_invoices: 0,
  pending_invoices: 1,
  actionable_invoices: 1,
  expired_invoices: 0,
  revenue_by_asset: {},
};
const cases = [
  [contract.parseCreateInvoiceResponse, payment],
  [contract.parseGetInvoiceResponse, invoice],
  [contract.parseListInvoicesResponse, [invoice]],
  [contract.parsePaymentInfoResponse, payment],
  [contract.parseCancelInvoiceResponse, { ...invoice, status: 'CANCELLED' }],
  [contract.parseVerifyPaymentResponse, { ...invoice, status: 'PAID' }],
  [contract.parseGetStatsResponse, stats],
] as const;

test('success response parsers reject a supplied non-true discriminant', () => {
  const accepted: string[] = [];
  for (const [parse, data] of cases) {
    for (const success of [false, 'false', 'true', 0, 1, null, undefined, [], {}]) {
      if (parse({ success, data }).success) {
        accepted.push(`${parse.name}: ${String(success)} (${typeof success})`);
      }
    }
  }
  assert.deepEqual(accepted, []);
});

test('literal true and supported legacy payloads retain the same normalized data', () => {
  for (const [parse, data] of cases) {
    const envelope = parse({ success: true, data });
    assert.equal(envelope.success, true, parse.name);
    const legacy = Array.isArray(data) ? { data } : data;
    assert.deepEqual(parse(legacy), envelope, parse.name);
    for (const input of [null, false, 'false', 0]) {
      assert.equal(parse(input).success, false, parse.name);
    }
    if (parse === contract.parseListInvoicesResponse) {
      assert.deepEqual(parse([invoice]), envelope);
      assert.deepEqual(parse([]), parse({ success: true, data: [] }));
      assert.equal(parse([{ ...invoice, amount: 0 }]).success, false);
    } else {
      assert.equal(parse([]).success, false, parse.name);
    }
  }
});
