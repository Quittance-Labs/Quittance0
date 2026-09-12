/**
 * Unit coverage for payment attribution (issue #379).
 *
 * Two of these properties cannot be reached over HTTP on this code path, which
 * is why they are asserted here rather than through the verify route:
 *
 * - a transaction hash offered to a second invoice: the memo check turns it
 *   away first (pinned in invoice-payment-loop.test.ts), so it never arrives at
 *   attribution. The claim index covers the case the memo check cannot see --
 *   two invoices issued the same memo.
 * - a memo collision, which creation now refuses outright.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoCollisionError,
  PaymentClaimError,
  PaymentClaimIndex,
} from '../src/domain/payment-attribution';
import { MemoryStorage } from '../src/storage/memory-storage';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service';
import { createInvoiceSchema } from '../src/utils/validation';

const SELLER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const TX_A = 'a'.repeat(64);
const TX_B = 'b'.repeat(64);

function invoiceInput() {
  return createInvoiceSchema.parse({
    amount: 25,
    assetCode: 'XLM',
    sellerPublicKey: SELLER,
    expiresInDays: 7,
  });
}

/** Seed the store directly: these tests are about attribution, not creation. */
function seed(storage: MemoryStorage, memo: string) {
  return storage.createInvoice({
    id: 'invoice-' + memo,
    sellerPublicKey: SELLER,
    amount: 25,
    assetCode: 'XLM',
    memo,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
}

describe('PaymentClaimIndex', () => {
  it('applies the first claim on a hash', () => {
    const index = new PaymentClaimIndex();
    assert.deepEqual(index.claim(TX_A, 'invoice-1'), { kind: 'apply' });
    assert.equal(index.peek(TX_A)?.invoiceId, 'invoice-1');
  });

  it('reports a replay for the same invoice instead of applying twice', () => {
    const index = new PaymentClaimIndex();
    index.claim(TX_A, 'invoice-1');

    assert.equal(index.claim(TX_A, 'invoice-1').kind, 'replay');
    assert.equal(index.size(), 1);
  });

  it('reports a conflict when a second invoice presents the same hash', () => {
    const index = new PaymentClaimIndex();
    index.claim(TX_A, 'invoice-1');

    const decision = index.claim(TX_A, 'invoice-2');
    assert.equal(decision.kind, 'conflict');
    if (decision.kind !== 'conflict') return;
    assert.equal(decision.code, 'TX_HASH_ALREADY_USED');
    assert.equal(decision.claim.invoiceId, 'invoice-1');
  });

  it('does not let a refused claim take the hash', () => {
    const index = new PaymentClaimIndex();
    index.claim(TX_A, 'invoice-1');
    index.claim(TX_A, 'invoice-2');

    assert.equal(index.peek(TX_A)?.invoiceId, 'invoice-1');
    assert.equal(index.claim(TX_A, 'invoice-1').kind, 'replay');
  });

  it('tracks distinct hashes independently', () => {
    const index = new PaymentClaimIndex();
    index.claim(TX_A, 'invoice-1');
    index.claim(TX_B, 'invoice-2');

    assert.equal(index.size(), 2);
    assert.equal(index.peek(TX_B)?.invoiceId, 'invoice-2');
  });
});

describe('one transaction settles one invoice', () => {
  it('refuses to pay a second invoice with a hash that settled the first', () => {
    const storage = new MemoryStorage();
    const first = seed(storage, 'INV-FIRST');
    const second = seed(storage, 'INV-SECOND');

    storage.markAsPaid(first.id, TX_A, SELLER);
    assert.equal(storage.getInvoiceById(first.id)?.status, 'PAID');

    assert.throws(
      () => storage.markAsPaid(second.id, TX_A, SELLER),
      (error: any) => {
        assert.ok(error instanceof PaymentClaimError, 'expected a PaymentClaimError');
        assert.equal(error.code, 'TX_HASH_ALREADY_USED');
        assert.equal(error.settledInvoiceId, first.id);
        return true;
      }
    );

    assert.equal(
      storage.getInvoiceById(second.id)?.status,
      'PENDING',
      'a refused claim must not pay the invoice'
    );
    assert.equal(storage.getPaymentClaim(TX_A)?.invoiceId, first.id);
  });

  it('leaves the hash unclaimed when an earlier guard rejects the invoice', () => {
    const storage = new MemoryStorage();
    const cancelled = seed(storage, 'INV-CANCELLED');
    storage.updateInvoice(cancelled.id, { status: 'CANCELLED' });

    assert.equal(storage.markAsPaid(cancelled.id, TX_A, SELLER), undefined);
    assert.equal(
      storage.getPaymentClaim(TX_A),
      undefined,
      'an invoice that was never attributed must not capture the hash'
    );
  });

  it('forgets claims when the store is cleared', () => {
    const storage = new MemoryStorage();
    const invoice = seed(storage, 'INV-CLEARED');
    storage.markAsPaid(invoice.id, TX_A, SELLER);

    storage.clear();
    assert.equal(storage.getPaymentClaim(TX_A), undefined);
  });
});

describe('memo uniqueness', () => {
  it('refuses a second invoice carrying a memo already in use', () => {
    const storage = new MemoryStorage();
    seed(storage, 'INV-DUPLICATE');

    assert.throws(() => seed(storage, 'INV-DUPLICATE'), MemoCollisionError);
  });

  it('redraws the memo when the first draw collides', async () => {
    const storage = new MemoryStorage();
    seed(storage, 'INV-TAKEN');

    const draws = ['INV-TAKEN', 'INV-FREE'];
    const service = new InvoiceMemoryService(storage, () => draws.shift() as string);

    const invoice = await service.createInvoice(invoiceInput());
    assert.equal(invoice.memo, 'INV-FREE');
  });

  it('draws the memo once when nothing collides', async () => {
    let calls = 0;
    const service = new InvoiceMemoryService(new MemoryStorage(), () => {
      calls += 1;
      return 'INV-ONLY';
    });

    await service.createInvoice(invoiceInput());
    assert.equal(calls, 1);
  });

  it('fails loudly when every draw collides', async () => {
    const storage = new MemoryStorage();
    seed(storage, 'INV-TAKEN');
    const service = new InvoiceMemoryService(storage, () => 'INV-TAKEN');

    await assert.rejects(() => service.createInvoice(invoiceInput()), MemoCollisionError);
  });
});

