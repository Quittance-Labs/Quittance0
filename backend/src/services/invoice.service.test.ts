import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';

/**
 * Hoist the mock pool object so it is available inside the
 * `vi.mock` factory below. Vitest hoists `vi.mock` calls to the
 * top of the file, which means factory closures cannot reference
 * variables declared at module scope — `vi.hoisted` is the canonical
 * workaround.
 */
const { mockPool } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

/**
 * Mock the pg.Pool module BEFORE importing the service. With this,
 * `invoice.service.ts`'s `import { pool } from '../config/database'`
 * resolves to our `mockPool` instance; the real `new Pool(...)`,
 * `pool.on('error', …)`, and the dotenv DATABASE_URL load are
 * all bypassed (no live DB connection required during tests).
 */
vi.mock('../config/database', () => ({
  pool: mockPool as unknown as Pool,
  query: vi.fn(),
}));

// Import AFTER `vi.mock` so the service module's `pool` reference
// resolves to `mockPool`. Vitest hoists `vi.mock` above imports,
// so even a static top-level import below is safe.
import invoiceService from './invoice.service';

/**
 * Regression tests for the type-contract invariant in
 * `invoiceService.markAsPaid` (commit `c09a61a`).
 *
 * Contract: when an invoice is marked PAID via the SQL UPDATE,
 * three fields MUST be returned atomically — `paid_at`,
 * `payment_tx_hash`, `payer_public_key` (each non-null). If any of
 * the three is missing on a returned PAID row (e.g., a partial
 * UPDATE in a future refactor racing with another writer), the
 * service throws "Invariant violation".
 *
 * Locks the predicate at CI. Mirrors the 5-case structure of
 * `invoice-memory.service.test.ts` (commit `56e9185`).
 */
describe('invoiceService.markAsPaid — type-contract invariant (commit c09a61a)', () => {
  beforeEach(() => {
    // Reset call history and stubbed returns before each test.
    mockPool.query.mockReset();
  });

  afterEach(() => {
    // Restore any `vi.spyOn` etc.; resets mockPool because the next
    // test's `mockReset` will clear it cleanly anyway. Defense in
    // depth against cross-test pollution from a future spy install.
    vi.restoreAllMocks();
  });

  /**
   * Build a synthetic SQL row matching `node-postgres`'s column
   * naming on the `invoices` table. Defaults are PENDING; override
   * per test.
   */
  function makeRow(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      id: 'inv-test-row',
      user_id: null,
      seller_public_key: 'GSELLER123EXAMPLE',
      seller_name: null,
      seller_email: null,
      amount: '100.0000000',
      asset_code: 'XLM',
      asset_issuer: null,
      memo: 'INV-TEST-ROW',
      description: null,
      customer_name: null,
      customer_email: null,
      status: 'PENDING',
      payment_tx_hash: null,
      payer_public_key: null,
      payer_name: null,
      payer_email: null,
      created_at: new Date(),
      paid_at: null,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      metadata: null,
      ...overrides,
    };
  }

  /**
   * The `markAsPaid` SQL service calls `pool.query` twice on success:
   *   1. UPDATE invoices SET status='PAID' ... RETURNING *
   *   2. logPaymentEvent → INSERT INTO payment_events ...
   * The invariant throws BETWEEN these two calls (before
   * logPaymentEvent), so the tripwire cases only need to stub
   * the first call. The happy path stubs both.
   */
  it('passes when SQL UPDATE returns a properly-shaped PAID row', async () => {
    const validPaidRow = makeRow({
      id: 'inv-happy-1',
      status: 'PAID',
      paid_at: new Date(),
      payment_tx_hash: 'txhash_happy',
      payer_public_key: 'GPAYER_HAPPY',
    });

    mockPool.query
      .mockResolvedValueOnce({ rows: [validPaidRow], rowCount: 1 })  // UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });             // logPaymentEvent INSERT

    const result = await invoiceService.markAsPaid('inv-happy-1', 'txhash_happy', 'GPAYER_HAPPY');

    expect(result.status).toBe('PAID');
    expect(result.paidAt).toBeDefined();
    expect(result.paymentTxHash).toBe('txhash_happy');
    expect(result.payerPublicKey).toBe('GPAYER_HAPPY');
  });

  /**
   * Tripwire case 1 — `payer_public_key` is null on the returned row.
   * Mirrors what a partial UPDATE that flips status without the
   * caller's pubkey would produce. Must throw.
   */
  it('throws Invariant violation when SQL UPDATE returns PAID row with null payer_public_key', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          id: 'inv-trip-1',
          status: 'PAID',
          paid_at: new Date(),
          payment_tx_hash: 'txhash_trip1',
          payer_public_key: null, // ← missing
        }),
      ],
      rowCount: 1,
    });

    await expect(
      invoiceService.markAsPaid('inv-trip-1', 'txhash_trip1', 'GPAYER_TRIP1')
    ).rejects.toThrow(/Invariant violation/);
  });

  /**
   * Tripwire case 2 — `paid_at` is null on the returned row.
   */
  it('throws Invariant violation when SQL UPDATE returns PAID row with null paid_at', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          id: 'inv-trip-2',
          status: 'PAID',
          paid_at: null, // ← missing
          payment_tx_hash: 'txhash_trip2',
          payer_public_key: 'GPAYER_TRIP2',
        }),
      ],
      rowCount: 1,
    });

    await expect(
      invoiceService.markAsPaid('inv-trip-2', 'txhash_trip2', 'GPAYER_TRIP2')
    ).rejects.toThrow(/Invariant violation/);
  });

  /**
   * Tripwire case 3 — `payment_tx_hash` is null on the returned row.
   */
  it('throws Invariant violation when SQL UPDATE returns PAID row with null payment_tx_hash', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          id: 'inv-trip-3',
          status: 'PAID',
          paid_at: new Date(),
          payment_tx_hash: null, // ← missing
          payer_public_key: 'GPAYER_TRIP3',
        }),
      ],
      rowCount: 1,
    });

    await expect(
      invoiceService.markAsPaid('inv-trip-3', 'txhash_trip3', 'GPAYER_TRIP3')
    ).rejects.toThrow(/Invariant violation/);
  });

  /**
   * Sanity — the existing "Invoice not found" pre-invariant check
   * still fires when the SQL UPDATE returns 0 rows. The error is
   * then wrapped by the SQL service's catch as `Failed to update
   * invoice: <original message>`, so we assert on the substring.
   */
  it('wraps "Invoice not found" when SQL UPDATE returns 0 rows', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      invoiceService.markAsPaid('non-existent-id', 'txhash', 'GPAYER_NOT_FOUND')
    ).rejects.toThrow(/Invoice not found/);
  });
});
