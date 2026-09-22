/**
 * Payment attribution (issue #379).
 *
 * A Stellar transaction may settle at most one invoice. What normally enforces
 * that is the memo check in `services/payment-verification.ts`: the
 * transaction must carry *this* invoice's memo, so a payment that already
 * settled invoice A cannot pass for invoice B.
 *
 * That proof rests on one invoice per memo. If a memo were ever issued twice,
 * the same transaction would satisfy both invoices and both would be marked
 * PAID against a single on-chain payment. This module is the backstop for that
 * case: it records which invoice a transaction hash settled and returns a
 * decision instead of letting a second invoice claim the same hash.
 *
 * The decision and the record are one synchronous call
 * (`PaymentClaimIndex.claim`). Both verify paths read the invoice status,
 * await Horizon, and only then attribute the payment, so two requests can reach
 * this point holding the same invoice and the same hash. There is no await
 * between the read and the write here, so the first caller records the claim
 * and every later caller observes it -- which is what makes a replay
 * idempotent rather than a second transition.
 */

/** Rejection code for a transaction that already settled another invoice. */
export type AttributionCode = 'TX_HASH_ALREADY_USED';

/** Which invoice a transaction hash settled, and when it was first seen. */
export interface PaymentClaim {
  txHash: string;
  invoiceId: string;
  claimedAt: Date;
}

export type AttributionDecision =
  /** No claim on this hash yet: the caller may mark the invoice PAID. */
  | { kind: 'apply' }
  /** This invoice already claimed the hash: a replay, not a new payment. */
  | { kind: 'replay'; claim: PaymentClaim }
  /** Another invoice already claimed the hash: refuse to settle it twice. */
  | { kind: 'conflict'; code: AttributionCode; claim: PaymentClaim };

/**
 * In-process account of hash -> invoice claims.
 *
 * Ceiling, stated rather than implied: this lives in the process, so it is lost
 * on restart and is not shared between instances. It is the correct guard for
 * the single-instance memory MVP, and the reason the durable form of the same
 * rule belongs in the database -- see docs/VERIFY-IDEMPOTENCY.md for the
 * recommended indexes.
 */
export class PaymentClaimIndex {
  private readonly claims = new Map<string, PaymentClaim>();

  /** Read-only lookup. Does not record anything. */
  peek(txHash: string): PaymentClaim | undefined {
    return this.claims.get(txHash);
  }

  /**
   * Decide and record in one step, so two callers cannot both be told 'apply'.
   * Recording happens only when the caller is allowed to apply, which keeps a
   * refused claim from capturing the hash.
   */
  claim(txHash: string, invoiceId: string, at: Date = new Date()): AttributionDecision {
    const existing = this.claims.get(txHash);

    if (existing) {
      return existing.invoiceId === invoiceId
        ? { kind: 'replay', claim: existing }
        : { kind: 'conflict', code: 'TX_HASH_ALREADY_USED', claim: existing };
    }

    const claim: PaymentClaim = { txHash, invoiceId, claimedAt: at };
    this.claims.set(txHash, claim);
    return { kind: 'apply' };
  }

  size(): number {
    return this.claims.size;
  }

  clear(): void {
    this.claims.clear();
  }
}

/**
 * Raised when a transaction hash is offered to an invoice it did not settle.
 * Carries the code the verify path reports, so the handler does not have to
 * parse a message to find it.
 */
export class PaymentClaimError extends Error {
  readonly code: AttributionCode = 'TX_HASH_ALREADY_USED';

  constructor(
    readonly txHash: string,
    readonly invoiceId: string,
    readonly settledInvoiceId: string
  ) {
    super('Transaction ' + txHash + ' already settled invoice ' + settledInvoiceId);
    this.name = 'PaymentClaimError';
  }
}

/**
 * Raised when an invoice memo is already in use. Invoice memos are how the
 * payment monitor maps an on-chain payment back to an invoice, so two invoices
 * sharing one memo would make one of them unreachable.
 */
export class MemoCollisionError extends Error {
  constructor(readonly memo: string) {
    super('Invoice memo ' + memo + ' is already in use');
    this.name = 'MemoCollisionError';
  }
}

import type {
  StoredInvoice,
  MarkAsPaidOptions,
  PayerInfo,
} from '../storage/invoice-storage';

/**
 * In-process promise queue mutex per transaction hash.
 * Serializes concurrent payment claims targeting the same transaction.
 */
export class TxClaimLock {
  private readonly tails = new Map<string, Promise<void>>();

  /**
   * Acquire a lock on the given transaction hash for the duration of the provided callback.
   */
  async acquire<T>(txHash: string, fn: () => Promise<T>): Promise<T> {
    const key = txHash.toLowerCase();
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = prev.then(
      () => current,
      () => current
    );
    this.tails.set(key, next);
    await prev;
    try {
      return await fn();
    } finally {
      release!();
      if (this.tails.get(key) === next) {
        this.tails.delete(key);
      }
    }
  }

  /**
   * Determine whether a lock is currently active for the given transaction hash.
   */
  isLocked(txHash: string): boolean {
    return this.tails.has(txHash.toLowerCase());
  }

  /**
   * Reset all lock queues.
   */
  clear(): void {
    this.tails.clear();
  }
}

export const txClaimLock = new TxClaimLock();

/**
 * Storage interface required by the shared payment claim function.
 */
export interface ClaimPaymentStorage {
  getInvoiceById?(id: string): Promise<StoredInvoice | null> | StoredInvoice | null;
  markAsPaid(
    id: string,
    txHash: string,
    payerPublicKey: string,
    payerInfo?: PayerInfo,
    options?: MarkAsPaidOptions
  ): Promise<StoredInvoice | undefined> | StoredInvoice | undefined;
  logPaymentEvent?(invoiceId: string, eventType: string, eventData: any): Promise<void> | void;
  getPaymentClaim?(txHash: string): PaymentClaim | undefined;
}

/**
 * Input arguments for the shared claimPayment function.
 */
export interface ClaimPaymentParams {
  storage: ClaimPaymentStorage;
  invoiceId: string;
  txHash: string;
  payerPublicKey: string;
  payerInfo?: PayerInfo;
  options?: MarkAsPaidOptions;
}

/**
 * Result returned by the shared claimPayment function.
 */
export type ClaimPaymentResult =
  | { kind: 'settled'; invoice: StoredInvoice }
  | { kind: 'replay'; invoice: StoredInvoice };

/**
 * Shared single claim path used by both manual verify and background payment monitor.
 * Serializes settlement per txHash to prevent concurrent race conditions.
 */
export async function claimPayment(
  params: ClaimPaymentParams,
  lock: TxClaimLock = txClaimLock
): Promise<ClaimPaymentResult> {
  const { storage, invoiceId, txHash, payerPublicKey, payerInfo, options } = params;

  return await lock.acquire(txHash, async () => {
    if (typeof storage.getPaymentClaim === 'function') {
      const existingClaim = storage.getPaymentClaim(txHash);
      if (existingClaim && existingClaim.invoiceId !== invoiceId) {
        throw new PaymentClaimError(txHash, invoiceId, existingClaim.invoiceId);
      }
    }

    const current = typeof storage.getInvoiceById === 'function'
      ? await storage.getInvoiceById(invoiceId)
      : null;

    if (current && current.status === 'PAID') {
      if (current.paymentTxHash === txHash) {
        return { kind: 'replay', invoice: current };
      }
      throw new PaymentClaimError(txHash, invoiceId, current.id);
    }

    try {
      const settled = await storage.markAsPaid(
        invoiceId,
        txHash,
        payerPublicKey,
        payerInfo,
        options
      );

      if (!settled) {
        const latest = typeof storage.getInvoiceById === 'function'
          ? await storage.getInvoiceById(invoiceId)
          : null;
        if (latest && latest.status === 'PAID' && latest.paymentTxHash === txHash) {
          return { kind: 'replay', invoice: latest };
        }
        throw new Error('Invoice not found, expired, or already processed');
      }

      return { kind: 'settled', invoice: settled };
    } catch (error: any) {
      if (error instanceof PaymentClaimError) {
        throw error;
      }

      if (
        error?.code === '23505' ||
        error?.constraint === 'uq_invoices_payment_tx_hash' ||
        error?.message?.includes('uq_invoices_payment_tx_hash') ||
        (error?.message?.includes('payment_tx_hash') && error?.message?.includes('duplicate key'))
      ) {
        throw new PaymentClaimError(txHash, invoiceId, 'already-claimed');
      }

      if (
        error?.message?.includes('already processed') ||
        error?.message?.includes('Invoice not found, expired, or already processed')
      ) {
        const latest = typeof storage.getInvoiceById === 'function'
          ? await storage.getInvoiceById(invoiceId)
          : null;
        if (latest && latest.status === 'PAID') {
          if (latest.paymentTxHash === txHash) {
            return { kind: 'replay', invoice: latest };
          }
          throw new PaymentClaimError(txHash, invoiceId, latest.id);
        }
      }

      throw error;
    }
  });
}


