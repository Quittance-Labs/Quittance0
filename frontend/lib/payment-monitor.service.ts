/**
 * Typed Payment Monitor — first typed consumer of the typed-Stellar
 * network surface (PR-a's `stellarApi.getPayments(publicKey, limit)`).
 *
 * Coexists with `frontend/lib/payment-monitor.ts` (the untyped SDK-direct
 * SSE-based monitor). PR-c migrates `WalletConnect.tsx` off the untyped
 * singleton onto this typed service; until then both files live side by
 * side and PR-b does not touch the untyped one.
 *
 * ## Why polling (vs SSE)
 *
 * - Goal of PR-b: prove a typed consumer of the typed HTTP surface.
 *   `stellarApi.getPayments` is the right shape (`Promise<ApiResponse<T>>`,
 *   `StellarPaymentRecord` discriminated) — using the SDK-direct
 *   `streamPayments` would re-introduce the `as unknown as` CollectionPage
 *   cast (documented in the typed-Stellar commit's out-of-scope section).
 * - Tradeoff: 5s polling lag vs sub-second SSE. Acceptable for MVP
 *   demonstration of the typed contract; lag can be tightened by reducing
 *   `pollIntervalMs` in callers without API changes.
 *
 * ## Dedup
 *
 * Each monitored publicKey owns a `Set<string>` of seen `payment.id`
 * values. The initial snapshot fetch populates the set; each subsequent
 * poll fires `onPayment` only for new IDs not yet seen. Same payment
 * never re-fires even if the paginated horizon response reorders.
 *
 * `seenIds` grows monotonically per session; long-running sessions may
 * want to prune by `ledger` (logged in the future followup below).
 *
 * ## Lifecycle
 *
 * - Module-level `beforeunload` cleanup is intentionally NOT registered
 *   here (the untyped singleton registers one for itself). Caller code
 *   owns cleanup via `stopMonitoring` / `stopAll` on wallet disconnect
 *   / route change — the explicit pattern is more debuggable than
 *   hidden lifecycle hooks.
 */

import { stellarApi } from './api';
import type {
  ApiResponse,
  StellarPaymentRecord,
  StellarPayments,
} from './utils';

export interface MonitorOptions {
  /**
   * Stellar address whose incoming payments we're polling for. Required.
   * Matches `backends/src/services/stellar.service.ts:PaymentRecord.to`.
   */
  publicKey: string;

  /**
   * Invoked once per *new* (not previously seen) payment record. Same
   * payment will not re-fire across polls thanks to the per-key
   * `seenIds` dedup set.
   */
  onPayment?: (payment: StellarPaymentRecord) => void;

  /**
   * Invoked on poll-iteration errors (network failures, axios timeouts,
   * `response.success === false`). The polling loop does NOT abort on a
   * single error — transient hiccups don't kill the monitor. Caller
   * may decide to `stopMonitoring` from inside the callback if it wants
   * to abandon after a sustained failure.
   */
  onError?: (error: Error) => void;

  /**
   * Poll interval in milliseconds. Defaults to 5000ms (testnet-friendly;
   * won't hit Horizon rate limits at typical session volumes).
   */
  pollIntervalMs?: number;

  /**
   * Snapshot fetch limit; same limit is reused for each poll. Defaults
   * to 20 (matches the Horizon `limit` parameter sweet-spot for UI
   * consumers — most wallet activity is < 20 payments on a short
   * window).
   */
  limit?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_LIMIT = 20;

/**
 * Typed payment monitor. Polls `stellarApi.getPayments` on a fixed
 * interval and fires `onPayment` for each unseen payment record.
 *
 * Usage:
 * ```ts
 * import { paymentMonitorService } from '@/lib/payment-monitor.service';
 *
 * await paymentMonitorService.startMonitoring({
 *   publicKey: walletAddress,
 *   onPayment: (p) => console.log('new payment:', p.amount, p.assetCode),
 *   pollIntervalMs: 5_000,
 * });
 *
 * // ... later on wallet disconnect:
 * paymentMonitorService.stopMonitoring(walletAddress);
 * ```
 */
export class PaymentMonitorService {
  /** Per-publicKey interval timers. */
  private readonly timers = new Map<
    string,
    ReturnType<typeof setInterval>
  >();

  /** Per-publicKey set of `payment.id` already fired to `onPayment`. */
  private readonly seenIds = new Map<string, Set<string>>();

  /** Active polling count (number of distinct publicKeys). */
  getActiveCount(): number {
    return this.timers.size;
  }

  /**
   * Returns true if `publicKey` currently has an active polling
   * monitor. Mirrors the untyped `payment-monitor.isMonitoring` shape
   * for PR-c migration.
   */
  isMonitoring(publicKey: string): boolean {
    return this.timers.has(publicKey);
  }

  /**
   * Begin polling `stellarApi.getPayments(publicKey, limit)` for
   * `publicKey`. Idempotent — calling twice for the same key returns
   * `{ success: true, data: [] }` and does NOT re-fetch or re-fire
   * the initial snapshot. Use `stopMonitoring(publicKey)` first if
   * you want to re-establish polling with new options.
   *
   * Returns the *initial snapshot* `ApiResponse<StellarPayments>` —
   * callers may inspect `response.data` shortly before the polling
   * loop fires subsequent `onPayment` callbacks. Useful for an
   * immediate UI render of the most recent N payments on monitor
   * start.
   */
  async startMonitoring(
    options: MonitorOptions
  ): Promise<ApiResponse<StellarPayments>> {
    const {
      publicKey,
      onPayment,
      onError,
      pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
      limit = DEFAULT_LIMIT,
    } = options;

    if (this.timers.has(publicKey)) {
      // Idempotent second call — don't re-fetch, don't re-fire.
      return { success: true, data: [] };
    }

    // Snapshot + populate seenIds. If the initial fetch fails, surface
    // the failure via onError + return the response envelope for the
    // caller to inspect, but DO NOT register a polling timer.
    const response = await stellarApi.getPayments(publicKey, limit);
    if (!response.success) {
      const error = new Error(response.error ?? 'Payment fetch failed');
      onError?.(error);
      return response;
    }

    const seen = new Set<string>();
    this.seenIds.set(publicKey, seen);
    for (const payment of response.data) {
      seen.add(payment.id);
      onPayment?.(payment);
    }

    // Register the polling timer. Errors inside the loop are routed to
    // the onError callback WITHOUT aborting the loop — transient
    // network hiccups don't kill the monitor; sustained failures are
    // the caller's responsibility to handle (stopMonitoring from
    // inside onError is a valid pattern).
    const timer = setInterval(() => {
      void this.poll(publicKey, limit, onPayment, onError);
    }, pollIntervalMs);
    this.timers.set(publicKey, timer);

    return response;
  }

  /**
   * Stop polling for `publicKey`. Clears the interval timer and the
   * per-key seenIds set so a subsequent `startMonitoring` starts with a
   * fresh seenIds baseline. Idempotent — calling on a key that's not
   * monitored is a no-op.
   */
  stopMonitoring(publicKey: string): void {
    const timer = this.timers.get(publicKey);
    if (timer !== undefined) {
      clearInterval(timer);
      this.timers.delete(publicKey);
    }
    this.seenIds.delete(publicKey);
  }

  /**
   * Stop every active poll. Useful on wallet-change / route-change /
   * logout teardown. Mirrors the untyped `payment-monitor.stopAll`
   * shape for PR-c migration.
   */
  stopAll(): void {
    for (const [publicKey, timer] of this.timers) {
      clearInterval(timer);
      this.timers.delete(publicKey);
      this.seenIds.delete(publicKey);
    }
  }

  /**
   * Single-poll iteration. Pulled out of the setInterval callback so it
   * can be `await`ed by tests without juggling fake timers.
   */
  private async poll(
    publicKey: string,
    limit: number,
    onPayment: ((payment: StellarPaymentRecord) => void) | undefined,
    onError: ((error: Error) => void) | undefined
  ): Promise<void> {
    try {
      const response = await stellarApi.getPayments(publicKey, limit);
      if (!response.success) {
        onError?.(new Error(response.error ?? 'Payment poll failed'));
        return;
      }
      const seen = this.seenIds.get(publicKey);
      if (!seen) {
        // Defensive: seenIds cleared between iterations (shouldn't
        // happen — poll only runs while a timer is registered). Skip
        // without firing.
        return;
      }
      for (const payment of response.data) {
        if (!seen.has(payment.id)) {
          seen.add(payment.id);
          onPayment?.(payment);
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(error);
    }
  }
}

/**
 * Module-level singleton. Mirrors the untyped `paymentMonitor` export
 * shape so PR-c migration in `WalletConnect.tsx` is a single-line
 * import-rename. Test code should construct its own
 * `new PaymentMonitorService()` instead of importing the singleton.
 */
export const paymentMonitorService = new PaymentMonitorService();
