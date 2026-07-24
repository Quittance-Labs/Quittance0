import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import invoiceMemoryService from './invoice-memory.service';
import memoryStorage from '../storage/memory-storage';

/**
 * Regression tests for the type-contract invariant in
 * `invoiceMemoryService.markAsPaid` (commit `8b38f7c`).
 *
 * Contract: when an invoice is marked PAID, three fields MUST be set
 * atomically — `paidAt`, `paymentTxHash`, `payerPublicKey`. If any of
 * the three is missing on a PAID invoice (e.g., a future partial SQL
 * UPDATE, partial in-memory mutation, or a malformed webhook payload),
 * the service throws "Invariant violation".
 *
 * Locks the predicate so a future softening of the assertion is
 * caught at CI, not at runtime.
 *
 * Today the in-memory `memoryStorage.markAsPaid` correctly sets all
 * three in a single `updateInvoice({…})` call, so the invariant
 * never fires in normal flow. The tests below use `vi.spyOn` to
 * inject a malformed PAID-shape return value into the storage
 * boundary and confirm the service-layer invariant fires — mirroring
 * what would happen if a future code path produced such a shape.
 */
describe('invoiceMemoryService.markAsPaid — type-contract invariant (commit 8b38f7c)', () => {
  beforeEach(() => {
    // Reset the in-memory storage singleton between tests so each test
    // starts from a clean slate.
    memoryStorage.clear();
  });

  afterEach(() => {
    // Restore any `vi.spyOn` installations so the singleton's `markAsPaid`
    // reverts to its real implementation between tests. Without this,
    // a spy installed in test N persists into test N+1 (even though
    // `mockReturnValueOnce` is consumed once) and could mask cross-test
    // pollution if a future test author forgets to re-spy explicitly.
    vi.restoreAllMocks();
  });

  /**
   * Happy path — today's storage layer ALWAYS sets all 3 fields in
   * one `updateInvoice({…})` call, so the throw should not fire.
   * This case ensures future drift doesn't accidentally widen the
   * invariant to reject legitimate state.
   */
  it('passes when storage returns a properly-shaped PAID invoice', async () => {
    const created = memoryStorage.createInvoice({
      sellerPublicKey: 'GSELLER123EXAMPLE',
      amount: 100,
      assetCode: 'XLM',
      memo: 'INV-HAPPY-1',
    });

    const result = await invoiceMemoryService.markAsPaid(
      created.id,
      'txhash_happy',
      'GPAYER_HAPPY'
    );

    expect(result.status).toBe('PAID');
    expect(result.paidAt).toBeDefined();
    expect(result.paymentTxHash).toBe('txhash_happy');
    expect(result.payerPublicKey).toBe('GPAYER_HAPPY');
  });

  /**
   * Tripwire case 1 — `payerPublicKey` missing on a PAID invoice.
   * Mirrors what a future partial SQL UPDATE that flips status
   * without the caller identity would produce. Must throw.
   */
  it('throws Invariant violation when storage returns PAID with missing payerPublicKey', async () => {
    const created = memoryStorage.createInvoice({
      sellerPublicKey: 'GSELLER123EXAMPLE',
      amount: 100,
      assetCode: 'XLM',
      memo: 'INV-TRIP-1',
    });

    // Inject a malformed PAID shape into the storage boundary. TS doesn't
    // narrow `as any` here — the assertion is the runtime guard.
    vi.spyOn(memoryStorage, 'markAsPaid').mockReturnValueOnce({
      id: created.id,
      sellerPublicKey: 'GSELLER123EXAMPLE',
      amount: 100,
      assetCode: 'XLM',
      memo: 'INV-TRIP-1',
      status: 'PAID',
      paidAt: new Date(),
      paymentTxHash: 'txhash_trip1',
      // payerPublicKey: omitted intentionally to trigger the invariant
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    } as any);

    await expect(
      invoiceMemoryService.markAsPaid(created.id, 'txhash_trip1', 'GPAYER_TRIP1')
    ).rejects.toThrow(/Invariant violation/);
  });

  /**
   * Tripwire case 2 — `paidAt` missing on a PAID invoice.
   */
  it('throws Invariant violation when storage returns PAID with missing paidAt', async () => {
    const created = memoryStorage.createInvoice({
      sellerPublicKey: 'GSELLER123EXAMPLE',
      amount: 100,
      assetCode: 'XLM',
      memo: 'INV-TRIP-2',
    });

    vi.spyOn(memoryStorage, 'markAsPaid').mockReturnValueOnce({
      id: created.id,
      sellerPublicKey: 'GSELLER123EXAMPLE',
      amount: 100,
      assetCode: 'XLM',
      memo: 'INV-TRIP-2',
      status: 'PAID',
      // paidAt: omitted intentionally
      paymentTxHash: 'txhash_trip2',
      payerPublicKey: 'GPAYER_TRIP2',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    } as any);

    await expect(
      invoiceMemoryService.markAsPaid(created.id, 'txhash_trip2', 'GPAYER_TRIP2')
    ).rejects.toThrow(/Invariant violation/);
  });

  /**
   * Tripwire case 3 — `paymentTxHash` missing on a PAID invoice.
   */
  it('throws Invariant violation when storage returns PAID with missing paymentTxHash', async () => {
    const created = memoryStorage.createInvoice({
      sellerPublicKey: 'GSELLER123EXAMPLE',
      amount: 100,
      assetCode: 'XLM',
      memo: 'INV-TRIP-3',
    });

    vi.spyOn(memoryStorage, 'markAsPaid').mockReturnValueOnce({
      id: created.id,
      sellerPublicKey: 'GSELLER123EXAMPLE',
      amount: 100,
      assetCode: 'XLM',
      memo: 'INV-TRIP-3',
      status: 'PAID',
      paidAt: new Date(),
      // paymentTxHash: omitted intentionally
      payerPublicKey: 'GPAYER_TRIP3',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    } as any);

    await expect(
      invoiceMemoryService.markAsPaid(created.id, 'txhash_trip3', 'GPAYER_TRIP3')
    ).rejects.toThrow(/Invariant violation/);
  });

  /**
   * Sanity — the existing "Invoice not found" pre-invariant check
   * still fires when the storage lookup misses. Unrelated to the
   * type-contract invariant but ensures the refactor didn't disturb
   * the existing not-found behavior.
   */
  it('throws "Invoice not found" when the storage lookup misses', async () => {
    await expect(
      invoiceMemoryService.markAsPaid('non-existent-id', 'txhash', 'GPAYER_NOT_FOUND')
    ).rejects.toThrow('Invoice not found');
  });
});
