import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock `./api` BEFORE importing the service so the service's
// `import { stellarApi } from './api'` resolves to a vi.fn() we control.
// vi.mock is hoisted to file-top by vitest's transformer.
vi.mock('./api', () => ({
  stellarApi: {
    getAccount: vi.fn(),
    getPayments: vi.fn(),
    getTransaction: vi.fn(),
    verifyPayment: vi.fn(),
  },
}));

import { stellarApi } from './api';
import { paymentMonitorService, PaymentMonitorService } from './payment-monitor.service';
import type { StellarPaymentRecord } from './utils';

const mockedGetPayments = vi.mocked(stellarApi.getPayments);

/**
 * Helper to build a synthetic `StellarPaymentRecord`. The fields mirror
 * the backend `PaymentRecord` interface from
 * `backend/src/services/stellar.service.ts:5-15`. Only the fields the
 * monitor reads/cares about need to be set; everything else is
 * defaulted to keep test inputs concise.
 */
const makeRecord = (
  id: string,
  amount: string = '10',
  assetCode: string = 'XLM'
): StellarPaymentRecord => ({
  id,
  txHash: `hash-${id}`,
  from: 'GA_FROM_ADDRESS',
  to: 'GA_TO_ADDRESS',
  amount,
  assetCode,
  ledger: 1,
  createdAt: '2025-01-01T00:00:00Z',
});

describe('PaymentMonitorService', () => {
  beforeEach(() => {
    mockedGetPayments.mockReset();
  });

  afterEach(() => {
    // Tear down any timers + seenIds from this test to keep the
    // singleton's state pristine for the next test in the file (and
    // for sibling test files within the same Vitest worker).
    paymentMonitorService.stopAll();
  });

  it('startMonitoring fires onPayment for each record in the initial snapshot', async () => {
    mockedGetPayments.mockResolvedValue({
      success: true,
      data: [makeRecord('a'), makeRecord('b')],
    });
    const onPayment = vi.fn();
    const r = await paymentMonitorService.startMonitoring({
      publicKey: 'GA_TEST_INITIAL',
      onPayment,
      // Large interval so the polling iteration never fires during this
      // test (only the initial snapshot is what we're asserting).
      pollIntervalMs: 60_000,
    });
    expect(r.success).toBe(true);
    expect(r.data).toEqual([
      expect.objectContaining({ id: 'a' }),
      expect.objectContaining({ id: 'b' }),
    ]);
    expect(onPayment).toHaveBeenCalledTimes(2);
    expect(onPayment).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'a' }));
    expect(onPayment).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'b' }));
  });

  it('idempotent — second startMonitoring for same key returns empty response and does not re-fire', async () => {
    mockedGetPayments.mockResolvedValue({
      success: true,
      data: [makeRecord('a')],
    });
    const onPayment = vi.fn();
    await paymentMonitorService.startMonitoring({
      publicKey: 'GA_TEST_IDEMPOTENT',
      onPayment,
      pollIntervalMs: 60_000,
    });
    expect(onPayment).toHaveBeenCalledTimes(1);

    // Second call for the same key returns a typed empty envelope and
    // does NOT re-fire the initial snapshot.
    const second = await paymentMonitorService.startMonitoring({
      publicKey: 'GA_TEST_IDEMPOTENT',
      onPayment,
      pollIntervalMs: 60_000,
    });
    expect(second).toEqual({ success: true, data: [] });
    expect(onPayment).toHaveBeenCalledTimes(1);
  });

  it('dedup — polling that returns overlapping payments never re-fires onPayment for the already-seen IDs', async () => {
    let pollCount = 0;
    mockedGetPayments.mockImplementation(async () => {
      pollCount += 1;
      if (pollCount === 1) {
        return {
          success: true,
          data: [makeRecord('a'), makeRecord('b')],
        };
      }
      // Subsequent polls return the SAME IDs in different order —
      // simulating Horizon's stable ordering on a no-op window.
      return {
        success: true,
        data: [makeRecord('b'), makeRecord('a')],
      };
    });

    const onPayment = vi.fn();
    await paymentMonitorService.startMonitoring({
      publicKey: 'GA_TEST_DEDUP',
      onPayment,
      pollIntervalMs: 10, // fast so the second poll fires within the test
      limit: 50,
    });

    // Initial snapshot fires the two callbacks once.
    expect(onPayment).toHaveBeenCalledTimes(2);

    // Wait long enough for at least one poll cycle to run.
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Dedup invariant: the overlapping payments were not re-fired.
    // Filter to payments matching the known ids ('a' and 'b') so we
    // tolerate any incidental callback that the polling mechanic
    // itself may emit (none expected here, but defensive assertion).
    const firedABCalls = onPayment.mock.calls.filter(([p]) => {
      const id = (p as StellarPaymentRecord).id;
      return id === 'a' || id === 'b';
    });
    expect(firedABCalls).toHaveLength(2);

    // At least one poll iteration ran (initial + ≥1 timer poll).
    expect(pollCount).toBeGreaterThanOrEqual(2);
  });

  it('new payment in a subsequent poll fires onPayment exactly once', async () => {
    let pollCount = 0;
    mockedGetPayments.mockImplementation(async () => {
      pollCount += 1;
      if (pollCount === 1) {
        return { success: true, data: [makeRecord('a')] };
      }
      return { success: true, data: [makeRecord('a'), makeRecord('b')] };
    });

    const onPayment = vi.fn();
    await paymentMonitorService.startMonitoring({
      publicKey: 'GA_TEST_NEW_PAYMENT',
      onPayment,
      pollIntervalMs: 10,
    });
    expect(onPayment).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 60));

    // 'b' should have fired exactly once during the second poll.
    const bCalls = onPayment.mock.calls.filter(
      ([p]) => (p as StellarPaymentRecord).id === 'b'
    );
    expect(bCalls).toHaveLength(1);
  });

  it('onError fires when initial snapshot returns success: false', async () => {
    mockedGetPayments.mockResolvedValue({
      success: false,
      error: 'horizon unavailable',
      data: [], // empty array satisfies the envelope's `data: StellarPayments`
    });
    const onError = vi.fn();
    const r = await paymentMonitorService.startMonitoring({
      publicKey: 'GA_TEST_INITIAL_ERROR',
      onError,
      pollIntervalMs: 60_000,
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('horizon unavailable');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('onError fires on poll iterations where success: false returns, without aborting the monitor', async () => {
    let pollCount = 0;
    mockedGetPayments.mockImplementation(async () => {
      pollCount += 1;
      if (pollCount === 1) {
        return { success: true, data: [makeRecord('a')] };
      }
      return { success: false, error: 'transient', data: [] };
    });
    const onError = vi.fn();
    await paymentMonitorService.startMonitoring({
      publicKey: 'GA_TEST_POLL_ERROR',
      onError,
      pollIntervalMs: 10,
    });
    // Initial snapshot was success: true, so no error fires from
    // the start phase.
    expect(onError).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 60));
    // At least one error fired (number of error-ed polls depends on
    // real wall-clock timing — we only assert ≥1 to keep this test
    // resilient to scheduler jitter).
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    // Monitor persists — `pollCount` shows at least initial + 1 errored
    // iteration + at least one more iteration AFTER the first error
    // (i.e. polling did not abort on the error).
    expect(pollCount).toBeGreaterThanOrEqual(3);
  });

  it('isMonitoring / getActiveCount reflect current monitoring state', async () => {
    mockedGetPayments.mockResolvedValue({ success: true, data: [] });
    const key = 'GA_TEST_LIFECYCLE';

    expect(paymentMonitorService.isMonitoring(key)).toBe(false);
    expect(paymentMonitorService.getActiveCount()).toBe(0);

    await paymentMonitorService.startMonitoring({
      publicKey: key,
      pollIntervalMs: 60_000,
    });
    expect(paymentMonitorService.isMonitoring(key)).toBe(true);
    expect(paymentMonitorService.getActiveCount()).toBe(1);

    paymentMonitorService.stopMonitoring(key);
    expect(paymentMonitorService.isMonitoring(key)).toBe(false);
    expect(paymentMonitorService.getActiveCount()).toBe(0);
  });

  it('stopMonitoring clears the per-key seenIds baseline (next startMonitoring re-fires the initial snapshot)', async () => {
    mockedGetPayments.mockResolvedValue({
      success: true,
      data: [makeRecord('a')],
    });
    const key = 'GA_TEST_STOP_RESTART';
    const onPayment = vi.fn();

    await paymentMonitorService.startMonitoring({
      publicKey: key,
      onPayment,
      pollIntervalMs: 60_000,
    });
    expect(onPayment).toHaveBeenCalledTimes(1);

    paymentMonitorService.stopMonitoring(key);

    // Restart — the seenIds baseline was cleared so the initial
    // snapshot fires again, even for the same payment ID 'a'.
    await paymentMonitorService.startMonitoring({
      publicKey: key,
      onPayment,
      pollIntervalMs: 60_000,
    });
    expect(onPayment).toHaveBeenCalledTimes(2);
  });

  it('stopAll clears every active monitor simultaneously', async () => {
    mockedGetPayments.mockResolvedValue({ success: true, data: [] });
    const onPayment = vi.fn();

    const key1 = 'GA_TEST_STOP_ALL_1';
    const key2 = 'GA_TEST_STOP_ALL_2';

    await paymentMonitorService.startMonitoring({
      publicKey: key1,
      onPayment,
      pollIntervalMs: 60_000,
    });
    await paymentMonitorService.startMonitoring({
      publicKey: key2,
      onPayment,
      pollIntervalMs: 60_000,
    });

    expect(paymentMonitorService.getActiveCount()).toBe(2);
    expect(paymentMonitorService.isMonitoring(key1)).toBe(true);
    expect(paymentMonitorService.isMonitoring(key2)).toBe(true);

    paymentMonitorService.stopAll();

    expect(paymentMonitorService.getActiveCount()).toBe(0);
    expect(paymentMonitorService.isMonitoring(key1)).toBe(false);
    expect(paymentMonitorService.isMonitoring(key2)).toBe(false);
  });

  it('Class instance is independent of the singleton (test-isolation)', async () => {
    // Direct-class construction, bypassing the singleton, lets a test
    // own its state without polluting sibling tests.
    const local = new PaymentMonitorService();
    const localGetPayments = mockedGetPayments;

    localGetPayments.mockResolvedValue({
      success: true,
      data: [makeRecord('z')],
    });
    const onPayment = vi.fn();
    await local.startMonitoring({
      publicKey: 'GA_TEST_LOCAL_INSTANCE',
      onPayment,
      pollIntervalMs: 60_000,
    });
    expect(onPayment).toHaveBeenCalledTimes(1);
    expect(local.isMonitoring('GA_TEST_LOCAL_INSTANCE')).toBe(true);
    expect(paymentMonitorService.isMonitoring('GA_TEST_LOCAL_INSTANCE')).toBe(false);
    local.stopAll();
  });
});
