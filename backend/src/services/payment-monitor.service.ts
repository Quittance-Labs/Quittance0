import path from 'node:path';
import type { Pool } from 'pg';
import stellarService, { PaymentPageRecord, PaymentRecord } from './stellar.service';
import invoiceService, { InvoiceService, Queryable } from './invoice.service';
import { SELLER_PUBLIC_KEY, STELLAR_NETWORK } from '../config/stellar';
import { pool } from '../config/database';
import { checkInvoiceIsPayable, verifyHorizonPayment } from './payment-verification';
import { canonicalAmount } from '../utils/safe-amount-compare';
import { PaymentClaimError } from '../domain/payment-attribution';
import { IllegalStateTransitionError } from '../domain/invoice-lifecycle';
import {
  parseSettlementTime,
  SettlementTimeUnavailableError,
} from '../domain/invoice-settlement';
import { monitorBackoffMs } from '../utils/monitor-retry-backoff';
import { classifyHorizonFailure } from '../utils/horizon-client';
import {
  FilePaymentMonitorCheckpointStore,
  PaymentMonitorCheckpointStore,
  PostgresPaymentMonitorCheckpointStore,
} from './payment-monitor-checkpoint';
import {
  LeaderLease,
  PostgresMonitorLeaderLease,
  SingleInstanceLeaderLease,
} from './monitor-leader-lease';
import { createRequestId } from '../utils/request-correlation-id';
import {
  emitEvent,
  emitOperationalFailure,
  logReference,
  type LogContext,
} from '../observability/log-events';

export interface PaymentPageSource {
  getPaymentsPage(account: string, cursor: string, limit: number): Promise<PaymentPageRecord[]>;
  getLatestPaymentCursor(account: string): Promise<string>;
  getCursorAtOrBefore?(account: string, time: Date | string): Promise<string>;
}

export interface MonitorInvoiceService {
  getInvoiceByMemo(memo: string): ReturnType<InvoiceService['getInvoiceByMemo']>;
  markAsPaid: InvoiceService['markAsPaid'];
  markExpiredInvoices: InvoiceService['markExpiredInvoices'];
  logPaymentEvent: InvoiceService['logPaymentEvent'];
  /**
   * PENDING invoices to re-watch after a restart (issue #502). Scoped to the
   * monitor account when one is configured; bounded by `limit`.
   */
  listPendingInvoices?(
    sellerPublicKey: string | undefined,
    limit: number
  ): Promise<WatchedInvoiceSeed[]>;
}

export interface WatchedInvoiceSeed {
  id: string;
  memo: string;
  sellerPublicKey?: string;
  status?: string;
  amount?: number | string;
  assetCode?: string;
  assetIssuer?: string;
  expiresAt?: Date | string;
  createdAt?: Date | string;
}

export interface WatchedInvoice {
  id: string;
  memo: string;
  sellerPublicKey: string;
  status: string;
  amount?: number | string;
  assetCode?: string;
  assetIssuer?: string;
  expiresAt?: Date | string;
  createdAt?: Date | string;
  registeredAt: Date;
}

export interface AccountMonitorSnapshot {
  account: string;
  cursor?: string;
  ledger?: number;
  consecutiveFailures: number;
  lastSuccessAt?: string;
  lastError?: string;
  nextRetryAt?: string;
  watchedCount: number;
  lastPollAt?: string;
  processedTotal: number;
  lagSeconds?: number;
}

export interface PaymentMonitorSnapshot {
  state: 'stopped' | 'starting' | 'running' | 'retrying';
  account?: string;
  cursor?: string;
  ledger?: number;
  consecutiveFailures: number;
  lastSuccessAt?: string;
  lastError?: string;
  nextRetryAt?: string;
  watchedCount: number;
  lastPollAt?: string;
  processedTotal: number;
  lagSeconds?: number;
  isLeader?: boolean;
  accounts?: Record<string, AccountMonitorSnapshot>;
}

export interface PaymentMonitorOptions {
  account?: string;
  network?: string;
  pollIntervalMs?: number;
  pageSize?: number;
  maxPagesPerRun?: number;
  source?: PaymentPageSource;
  invoices?: MonitorInvoiceService;
  checkpoints?: PaymentMonitorCheckpointStore;
  database?: Queryable;
  lease?: LeaderLease;
}

interface AccountMonitorState {
  account: string;
  cursor?: string;
  ledger?: number;
  consecutiveFailures: number;
  lastSuccessAt?: string;
  lastError?: string;
  nextRetryAt?: string;
  lastPollAt?: string;
  processedTotal: number;
}

/** Bounded hydrate pass — a restart must never replay unbounded history. */
const HYDRATE_WATCH_LIMIT = 500;

function defaultCheckpointStore(database?: Queryable): PaymentMonitorCheckpointStore {
  const cursorFile = process.env.PAYMENT_MONITOR_CURSOR_FILE?.trim();
  if (cursorFile) {
    return new FilePaymentMonitorCheckpointStore(path.resolve(cursorFile));
  }
  if (!database || process.env.STORAGE_MODE === 'memory' || process.env.INVOICE_STORAGE === 'memory') {
    return new FilePaymentMonitorCheckpointStore(path.resolve('data/payment-monitor-checkpoint.json'));
  }
  return new PostgresPaymentMonitorCheckpointStore(database);
}

function isPool(db: any): db is Pool {
  return db && typeof db.connect === 'function';
}

/**
 * Multi-account cursor-driven Horizon payment monitor with leader leasing,
 * fair round-robin budgeting, and restart safety.
 */
export class PaymentMonitorService {
  private buildLogContext(): LogContext {
    return {
      requestId: createRequestId(),
      service: 'api',
      environment: process.env.NODE_ENV || 'development',
    };
  }

  private account?: string;
  private network: string;
  private pollIntervalMs: number;
  private pageSize: number;
  private maxPagesPerRun: number;
  private source: PaymentPageSource;
  private invoices: MonitorInvoiceService;
  private checkpoints: PaymentMonitorCheckpointStore;
  private database?: Queryable;
  private lease?: LeaderLease;
  private pollTimer: NodeJS.Timeout | null = null;
  private expirationTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private syncInFlight = false;
  private watchedInvoices = new Map<string, WatchedInvoice>();
  private memoToWatchedId = new Map<string, string>();
  private processedTxHashes = new Set<string>();
  private accountStates = new Map<string, AccountMonitorState>();
  private processedTotal = 0;
  private roundRobinOffset = 0;
  private lastPollAt?: string;
  private snapshot: PaymentMonitorSnapshot = {
    state: 'stopped',
    consecutiveFailures: 0,
    watchedCount: 0,
    processedTotal: 0,
  };

  constructor(options: PaymentMonitorOptions = {}) {
    this.account = (options.account ?? SELLER_PUBLIC_KEY) || undefined;
    this.network = options.network ?? STELLAR_NETWORK;
    this.pollIntervalMs = options.pollIntervalMs ?? Number(process.env.PAYMENT_MONITOR_POLL_MS || 5_000);
    this.pageSize = Math.min(200, Math.max(1, options.pageSize ?? 100));
    this.maxPagesPerRun = Math.max(1, options.maxPagesPerRun ?? 10);
    this.source = options.source ?? stellarService;
    this.invoices = options.invoices ?? invoiceService;
    this.database = 'database' in options ? options.database : (process.env.STORAGE_MODE === 'memory' ? undefined : pool);
    this.checkpoints = options.checkpoints ?? defaultCheckpointStore(this.database);
    if (options.lease) {
      this.lease = options.lease;
    } else if (this.database && isPool(this.database)) {
      this.lease = new PostgresMonitorLeaderLease(this.database);
    } else {
      this.lease = new SingleInstanceLeaderLease();
    }
    this.snapshot.account = this.account;
  }

  /**
   * Reconfigures monitor dependencies and runtime parameters.
   */
  configure(options: Partial<PaymentMonitorOptions>): void {
    if (options.account !== undefined) this.account = options.account;
    if (options.network !== undefined) this.network = options.network;
    if (options.pollIntervalMs !== undefined) this.pollIntervalMs = options.pollIntervalMs;
    if (options.pageSize !== undefined) this.pageSize = Math.min(200, Math.max(1, options.pageSize));
    if (options.maxPagesPerRun !== undefined) this.maxPagesPerRun = Math.max(1, options.maxPagesPerRun);
    if (options.source !== undefined) this.source = options.source;
    if (options.invoices !== undefined) this.invoices = options.invoices;
    if ('database' in options) {
      this.database = options.database;
      if (options.lease === undefined && !('lease' in options)) {
        if (this.database && isPool(this.database)) {
          this.lease = new PostgresMonitorLeaderLease(this.database);
        } else {
          this.lease = new SingleInstanceLeaderLease();
        }
      }
    }
    if (options.lease !== undefined) {
      this.lease = options.lease;
    }
    if (options.checkpoints !== undefined) {
      this.checkpoints = options.checkpoints;
    } else if (options.database !== undefined) {
      this.checkpoints = defaultCheckpointStore(this.database);
    }
    this.snapshot.account = this.account;
  }

  private getOrCreateAccountState(account: string): AccountMonitorState {
    let state = this.accountStates.get(account);
    if (!state) {
      state = {
        account,
        consecutiveFailures: 0,
        processedTotal: 0,
      };
      this.accountStates.set(account, state);
    }
    return state;
  }

  /**
   * Derive active account set from watches and optional pinned account.
   */
  getActiveAccounts(): string[] {
    const accounts = new Set<string>();
    if (this.account) {
      accounts.add(this.account);
    }
    for (const watched of this.watchedInvoices.values()) {
      if (watched.sellerPublicKey) {
        accounts.add(watched.sellerPublicKey);
      }
    }
    return Array.from(accounts);
  }

  /**
   * Register an invoice watch as it becomes PENDING.
   */
  registerWatch(invoice: WatchedInvoiceSeed): void {
    if (!invoice || !invoice.id) return;

    const status = invoice.status || 'PENDING';
    if (status !== 'PENDING') {
      this.unregisterWatch(invoice.id);
      return;
    }

    const sellerKey = invoice.sellerPublicKey || this.account || '';
    const watched: WatchedInvoice = {
      id: invoice.id,
      memo: invoice.memo,
      sellerPublicKey: sellerKey,
      status,
      amount: invoice.amount,
      assetCode: invoice.assetCode,
      assetIssuer: invoice.assetIssuer,
      expiresAt: invoice.expiresAt,
      createdAt: invoice.createdAt,
      registeredAt: new Date(),
    };

    this.watchedInvoices.set(invoice.id, watched);
    if (invoice.memo) {
      this.memoToWatchedId.set(invoice.memo, invoice.id);
    }
    if (sellerKey) {
      this.getOrCreateAccountState(sellerKey);
    }
    this.snapshot.watchedCount = this.watchedInvoices.size;
  }

  /**
   * Unregister an invoice watch when it reaches PAID, CANCELLED, or EXPIRED.
   * Keeps existing account cursor intact when an account goes idle.
   */
  unregisterWatch(invoiceId: string): void {
    const existing = this.watchedInvoices.get(invoiceId);
    if (existing) {
      if (existing.memo) {
        this.memoToWatchedId.delete(existing.memo);
      }
      this.watchedInvoices.delete(invoiceId);
      this.snapshot.watchedCount = this.watchedInvoices.size;
    }
  }

  /**
   * Prunes watched invoices whose expiresAt timestamp has elapsed.
   */
  pruneExpiredWatches(now: Date = new Date()): number {
    let pruned = 0;
    for (const [id, watched] of this.watchedInvoices.entries()) {
      if (watched.expiresAt && new Date(watched.expiresAt).getTime() <= now.getTime()) {
        this.unregisterWatch(id);
        pruned += 1;
      }
    }
    return pruned;
  }

  getWatchedCount(): number {
    return this.watchedInvoices.size;
  }

  getWatchedInvoices(): WatchedInvoice[] {
    return Array.from(this.watchedInvoices.values());
  }

  isWatching(invoiceId: string): boolean {
    return this.watchedInvoices.has(invoiceId);
  }

  private getWatchedCountForAccount(account: string): number {
    let count = 0;
    for (const watched of this.watchedInvoices.values()) {
      if (watched.sellerPublicKey === account) {
        count += 1;
      }
    }
    return count;
  }

  private getEarliestCreatedAt(account: string): Date | undefined {
    let earliest: Date | undefined;
    for (const watched of this.watchedInvoices.values()) {
      if (watched.sellerPublicKey === account && watched.createdAt) {
        const d = new Date(watched.createdAt);
        if (!earliest || d.getTime() < earliest.getTime()) {
          earliest = d;
        }
      }
    }
    return earliest;
  }

  private async findCursorAtOrBefore(account: string, createdAt: Date): Promise<string> {
    const targetMs = createdAt.getTime();
    try {
      const page = await this.source.getPaymentsPage(account, '0', 50);
      if (!page || page.length === 0) {
        return await this.source.getLatestPaymentCursor(account);
      }
      let candidate: string | undefined;
      for (const rec of page) {
        const recTime = rec.payment?.createdAt ? new Date(rec.payment.createdAt).getTime() : undefined;
        if (recTime !== undefined && recTime < targetMs) {
          candidate = rec.pagingToken;
        }
      }
      return candidate ?? (await this.source.getLatestPaymentCursor(account));
    } catch {
      return await this.source.getLatestPaymentCursor(account);
    }
  }

  private async bootstrapAccountCursor(account: string): Promise<string> {
    const earliestCreatedAt = this.getEarliestCreatedAt(account);
    let cursor: string;
    if (earliestCreatedAt && typeof this.source.getCursorAtOrBefore === 'function') {
      cursor = await this.source.getCursorAtOrBefore(account, earliestCreatedAt);
    } else if (earliestCreatedAt) {
      cursor = await this.findCursorAtOrBefore(account, earliestCreatedAt);
    } else {
      cursor = await this.source.getLatestPaymentCursor(account);
    }

    await this.checkpoints.save({ account, network: this.network, cursor });
    const acctState = this.getOrCreateAccountState(account);
    acctState.cursor = cursor;
    acctState.lastSuccessAt = new Date().toISOString();
    return cursor;
  }

  private async hydrateWatches(): Promise<void> {
    if (!this.invoices.listPendingInvoices) return;
    const pending = await this.invoices.listPendingInvoices(
      this.account,
      HYDRATE_WATCH_LIMIT
    );
    let restored = 0;
    for (const invoice of pending) {
      if (invoice && invoice.id) {
        this.registerWatch(invoice);
        restored += 1;
      }
    }
    this.pruneExpiredWatches();
    if (restored > 0) {
      console.info(`[payment-monitor] Restored ${restored} pending invoice watch(es) from storage`);
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.snapshot = {
      ...this.snapshot,
      state: 'starting',
      account: this.account,
      consecutiveFailures: 0,
      watchedCount: this.watchedInvoices.size,
      processedTotal: this.processedTotal,
    };

    if (this.lease) {
      void this.lease.start().catch(() => {
        emitOperationalFailure('monitor.start', 'warn');
      });
    }

    this.expirationTimer = setInterval(() => {
      this.pruneExpiredWatches();
      void this.invoices.markExpiredInvoices().catch((_error) => {
        emitOperationalFailure('monitor.expire');
      });
    }, 60_000);

    void this.hydrateWatches()
      .catch((_error) => {
        emitOperationalFailure('monitor.hydrate');
      })
      .finally(() => {
        if (this.isRunning) this.schedule(0);
      });
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.expirationTimer) clearInterval(this.expirationTimer);
    this.pollTimer = null;
    this.expirationTimer = null;

    if (this.lease) {
      void this.lease.stop().catch(() => {
        emitOperationalFailure('monitor.start', 'warn');
      });
    }

    this.snapshot = {
      ...this.snapshot,
      state: 'stopped',
      nextRetryAt: undefined,
      watchedCount: this.watchedInvoices.size,
      processedTotal: this.processedTotal,
    };
  }

  reset(): void {
    this.stop();
    this.watchedInvoices.clear();
    this.memoToWatchedId.clear();
    this.processedTxHashes.clear();
    this.accountStates.clear();
    this.processedTotal = 0;
    this.roundRobinOffset = 0;
    this.lastPollAt = undefined;
    this.snapshot = {
      state: 'stopped',
      consecutiveFailures: 0,
      watchedCount: 0,
      processedTotal: 0,
    };
  }

  getStatus(): PaymentMonitorSnapshot {
    const now = Date.now();
    const accountsSnapshot: Record<string, AccountMonitorSnapshot> = {};

    const allAccounts = new Set<string>([
      ...Array.from(this.accountStates.keys()),
      ...this.getActiveAccounts(),
    ]);

    for (const acct of allAccounts) {
      const state = this.getOrCreateAccountState(acct);
      const lastSuccessMs = state.lastSuccessAt ? new Date(state.lastSuccessAt).getTime() : undefined;
      const lagSeconds = lastSuccessMs !== undefined ? Math.max(0, Math.round((now - lastSuccessMs) / 1000)) : undefined;

      accountsSnapshot[acct] = {
        account: acct,
        cursor: state.cursor,
        ledger: state.ledger,
        consecutiveFailures: state.consecutiveFailures,
        lastSuccessAt: state.lastSuccessAt,
        lastError: state.lastError,
        nextRetryAt: state.nextRetryAt,
        watchedCount: this.getWatchedCountForAccount(acct),
        lastPollAt: state.lastPollAt,
        processedTotal: state.processedTotal,
        lagSeconds,
      };
    }

    const primaryAccount = this.account || this.getActiveAccounts()[0];
    const primaryState = primaryAccount ? this.accountStates.get(primaryAccount) : undefined;
    const primarySuccessMs = primaryState?.lastSuccessAt ? new Date(primaryState.lastSuccessAt).getTime() : undefined;
    const primaryLag = primarySuccessMs !== undefined ? Math.max(0, Math.round((now - primarySuccessMs) / 1000)) : undefined;

    return {
      ...this.snapshot,
      account: primaryAccount,
      cursor: primaryState?.cursor ?? this.snapshot.cursor,
      ledger: primaryState?.ledger ?? this.snapshot.ledger,
      consecutiveFailures: primaryState?.consecutiveFailures ?? this.snapshot.consecutiveFailures,
      lastSuccessAt: primaryState?.lastSuccessAt ?? this.snapshot.lastSuccessAt,
      lastError: primaryState?.lastError ?? this.snapshot.lastError,
      nextRetryAt: primaryState?.nextRetryAt ?? this.snapshot.nextRetryAt,
      watchedCount: this.watchedInvoices.size,
      processedTotal: this.processedTotal,
      lastPollAt: this.lastPollAt,
      lagSeconds: primaryLag ?? (this.snapshot.lastSuccessAt ? Math.max(0, Math.round((now - new Date(this.snapshot.lastSuccessAt).getTime()) / 1000)) : undefined),
      isLeader: this.lease ? this.lease.isLeader() : true,
      accounts: accountsSnapshot,
    };
  }

  private schedule(delayMs: number) {
    if (!this.isRunning) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick() {
    if (!this.isRunning || this.syncInFlight) return;

    if (this.lease && !this.lease.isLeader()) {
      // Standby replica: keep serving HTTP without polling
      this.schedule(this.pollIntervalMs);
      return;
    }

    this.syncInFlight = true;
    this.lastPollAt = new Date().toISOString();
    try {
      await this.runOnce();
      this.snapshot = {
        ...this.snapshot,
        state: 'running',
        consecutiveFailures: 0,
        lastSuccessAt: new Date().toISOString(),
        lastError: undefined,
        nextRetryAt: undefined,
        watchedCount: this.watchedInvoices.size,
        processedTotal: this.processedTotal,
        lastPollAt: this.lastPollAt,
      };
      this.schedule(this.pollIntervalMs);
    } catch (error: any) {
      emitEvent('error', 'horizon.request.failed', this.buildLogContext(), {
        operation: 'tick',
        errorCode: 'HORIZON_UNAVAILABLE',
        network: this.network,
        attempt: 1,
        durationMs: 0,
      });
      const failures = this.snapshot.consecutiveFailures + 1;
      const retryMs = monitorBackoffMs(failures - 1);
      this.snapshot = {
        ...this.snapshot,
        state: 'retrying',
        consecutiveFailures: failures,
        lastError: error?.message || String(error),
        nextRetryAt: new Date(Date.now() + retryMs).toISOString(),
        watchedCount: this.watchedInvoices.size,
        processedTotal: this.processedTotal,
        lastPollAt: this.lastPollAt,
      };
      this.schedule(retryMs);
    } finally {
      this.syncInFlight = false;
    }
  }

  /**
   * Process available records up to the bounded per-run page budget,
   * round-robining across all accounts with active watched invoices.
   */
  async runOnce(targetAccount?: string): Promise<{
    processed: number;
    cursor: string;
    bootstrapped: boolean;
    accounts?: Record<string, { processed: number; cursor: string; bootstrapped: boolean }>;
  }> {
    this.lastPollAt = new Date().toISOString();

    const activeAccounts = targetAccount
      ? [targetAccount]
      : this.getActiveAccounts();

    if (activeAccounts.length === 0) {
      const fallbackCursor = this.snapshot.cursor || '0';
      return { processed: 0, cursor: fallbackCursor, bootstrapped: false, accounts: {} };
    }

    const totalAccounts = activeAccounts.length;
    const startIndex = this.roundRobinOffset % totalAccounts;
    const orderedAccounts = [
      ...activeAccounts.slice(startIndex),
      ...activeAccounts.slice(0, startIndex),
    ];
    this.roundRobinOffset = (this.roundRobinOffset + 1) % totalAccounts;

    let remainingPageBudget = this.maxPagesPerRun;
    let totalProcessed = 0;
    let anyBootstrapped = false;
    let lastPolledCursor = this.snapshot.cursor || '0';
    const perAccountResults: Record<string, { processed: number; cursor: string; bootstrapped: boolean }> = {};

    for (const account of orderedAccounts) {
      const acctState = this.getOrCreateAccountState(account);
      acctState.lastPollAt = new Date().toISOString();

      const now = Date.now();
      if (acctState.nextRetryAt && new Date(acctState.nextRetryAt).getTime() > now) {
        continue;
      }

      if (remainingPageBudget <= 0) {
        break;
      }

      const checkpoint = await this.checkpoints.load(account, this.network);
      if (!checkpoint) {
        const bootstrappedCursor = await this.bootstrapAccountCursor(account);
        anyBootstrapped = true;
        lastPolledCursor = bootstrappedCursor;
        perAccountResults[account] = { processed: 0, cursor: bootstrappedCursor, bootstrapped: true };
        continue;
      }

      let cursor = checkpoint.cursor;
      let acctProcessed = 0;
      const maxPagesForAccount = Math.min(
        remainingPageBudget,
        Math.max(1, Math.floor(this.maxPagesPerRun / orderedAccounts.length))
      );

      try {
        for (let pageNumber = 0; pageNumber < maxPagesForAccount; pageNumber += 1) {
          const page = await this.source.getPaymentsPage(account, cursor, this.pageSize);
          remainingPageBudget -= 1;
          if (page.length === 0) break;

          let advancedInPage = false;
          for (const record of page) {
            if (record.pagingToken === cursor && cursor !== checkpoint.cursor) {
              continue;
            }

            if (record.payment) {
              await this.handlePayment(record.payment);
            }

            await this.checkpoints.save({
              account,
              network: this.network,
              cursor: record.pagingToken,
              ledger: record.ledger,
            });

            cursor = record.pagingToken;
            acctProcessed += 1;
            totalProcessed += 1;
            this.processedTotal += 1;
            acctState.processedTotal += 1;
            acctState.cursor = cursor;
            acctState.ledger = record.ledger;
            advancedInPage = true;
          }

          if (!advancedInPage || page.length < this.pageSize) break;
        }

        acctState.consecutiveFailures = 0;
        acctState.lastSuccessAt = new Date().toISOString();
        acctState.lastError = undefined;
        acctState.nextRetryAt = undefined;
        lastPolledCursor = cursor;
        perAccountResults[account] = { processed: acctProcessed, cursor, bootstrapped: false };
      } catch (error: any) {
        if (error instanceof Error && !classifyHorizonFailure(error) && error.message.includes('database')) {
          throw error;
        }

        acctState.consecutiveFailures += 1;
        const retryMs = monitorBackoffMs(acctState.consecutiveFailures - 1);
        acctState.lastError = error?.message || String(error);
        acctState.nextRetryAt = new Date(Date.now() + retryMs).toISOString();
        emitEvent('error', 'horizon.request.failed', this.buildLogContext(), {
          operation: 'getPaymentsPage',
          errorCode: 'HORIZON_UNAVAILABLE',
          network: this.network,
          attempt: 1,
          durationMs: 0,
          account,
        });

        if (orderedAccounts.length === 1) {
          throw error;
        }
      }
    }

    this.snapshot = {
      ...this.snapshot,
      cursor: lastPolledCursor,
      lastSuccessAt: totalProcessed > 0 || !anyBootstrapped ? new Date().toISOString() : this.snapshot.lastSuccessAt,
      watchedCount: this.watchedInvoices.size,
      processedTotal: this.processedTotal,
      lastPollAt: this.lastPollAt,
    };

    return {
      processed: totalProcessed,
      cursor: lastPolledCursor,
      bootstrapped: anyBootstrapped && totalProcessed === 0,
      accounts: perAccountResults,
    };
  }

  private async handlePayment(payment: PaymentRecord): Promise<void> {
    if (!payment.memo) return;

    if (this.processedTxHashes.has(payment.txHash)) {
      return;
    }

    const invoice = await this.invoices.getInvoiceByMemo(payment.memo);
    if (!invoice) return;

    if (invoice.status === 'PAID') {
      if (invoice.paymentTxHash === payment.txHash) {
        this.processedTxHashes.add(payment.txHash);
        this.unregisterWatch(invoice.id);
        return;
      }
      await this.invoices.logPaymentEvent(
        invoice.id,
        'PAYMENT_REJECTED',
        {
          code: 'INVOICE_ALREADY_PAID',
          txHash: payment.txHash,
          existingTxHash: invoice.paymentTxHash,
        }
      );
      return;
    }

    const payable = checkInvoiceIsPayable(invoice.status);
    if (!payable.ok && invoice.status !== 'CANCELLED' && invoice.status !== 'EXPIRED') return;

    const isNative = payment.assetCode === 'XLM' && !payment.assetIssuer;
    const startedAt = Date.now();
    const context = this.buildLogContext();
    emitEvent('info', 'payment.verify.started', context, {
      invoiceRef: logReference(invoice.id),
      txRef: logReference(payment.txHash),
      network: this.network,
    });

    const verification = verifyHorizonPayment({
      txHash: payment.txHash,
      network: this.network,
      transaction: { memo: payment.memo, memo_type: payment.memoType },
      operations: [{
        type: 'payment',
        from: payment.from,
        to: payment.to,
        amount: payment.amount,
        asset_type: isNative ? 'native' : 'credit_alphanum12',
        asset_code: isNative ? undefined : payment.assetCode,
        asset_issuer: payment.assetIssuer,
      }],
      expected: {
        memo: invoice.memo,
        amount: invoice.amount,
        destination: invoice.sellerPublicKey,
        assetCode: invoice.assetCode,
        assetIssuer: invoice.assetIssuer,
        network: this.network,
      },
    });

    if (!verification.ok) {
      emitEvent('warn', 'payment.verify.rejected', context, {
        invoiceRef: logReference(invoice.id),
        txRef: logReference(payment.txHash),
        errorCode: verification.code,
        network: this.network,
        durationMs: Date.now() - startedAt,
      });
      await this.invoices.logPaymentEvent(
        invoice.id,
        verification.code === 'AMOUNT_TOO_LOW' || verification.code === 'AMOUNT_MISMATCH'
          ? 'PARTIAL_PAYMENT'
          : 'PAYMENT_REJECTED',
        {
          code: verification.code,
          txHash: payment.txHash,
          expectedAmount: canonicalAmount(invoice.amount) ?? String(invoice.amount),
          receivedAmount: payment.amount,
          payerPublicKey: payment.from,
        }
      );
      return;
    }

    const settledAt = parseSettlementTime(payment.createdAt) ?? verification.value.settledAt;
    if (!settledAt) {
      throw new SettlementTimeUnavailableError();
    }

    try {
      await this.saveTransaction(payment, invoice.id);
      await this.invoices.markAsPaid(
        invoice.id,
        payment.txHash,
        payment.from,
        undefined,
        { settledAt, destinationMuxedId: verification.value.toMuxedId }
      );
      this.processedTxHashes.add(payment.txHash);
      this.unregisterWatch(invoice.id);
      emitEvent('info', 'invoice.paid', context, {
        invoiceRef: logReference(invoice.id),
        sellerRef: logReference(invoice.sellerPublicKey),
        txRef: logReference(payment.txHash),
        assetCode: invoice.assetCode || 'XLM',
        network: this.network,
        storage: this.database ? 'postgres' : 'memory',
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (error instanceof PaymentClaimError) {
        emitEvent('warn', 'payment.verify.rejected', context, {
          invoiceRef: logReference(invoice.id),
          txRef: logReference(payment.txHash),
          errorCode: error.code || 'TX_HASH_ALREADY_USED',
          network: this.network,
          durationMs: Date.now() - startedAt,
        });
        await this.invoices.logPaymentEvent(
          invoice.id,
          'PAYMENT_REJECTED',
          {
            code: 'TX_HASH_ALREADY_USED',
            txHash: payment.txHash,
            error: error.message,
          }
        );
        return;
      }
      if (error instanceof IllegalStateTransitionError) {
        console.warn(
          'Payment monitor skipped settling invoice due to state conflict:',
          error.message
        );
        await this.invoices.logPaymentEvent(invoice.id, 'PAYMENT_REJECTED', {
          code: error.code,
          txHash: payment.txHash,
          fromStatus: error.fromStatus,
          toStatus: error.toStatus,
        });
        return;
      }
      throw error;
    }
  }

  private async saveTransaction(payment: PaymentRecord, invoiceId: string) {
    if (!this.database) {
      return;
    }
    try {
      await this.database.query(
        `INSERT INTO transactions (
          invoice_id, from_address, to_address, amount, asset_code, asset_issuer,
          tx_hash, memo, ledger, processed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (tx_hash) DO NOTHING`,
        [
          invoiceId,
          payment.from,
          payment.to,
          payment.amount,
          payment.assetCode,
          payment.assetIssuer || null,
          payment.txHash,
          payment.memo || null,
          payment.ledger,
        ]
      );
    } catch (error) {
      emitOperationalFailure('monitor.persist', 'warn');
    }
  }

  async manualSync(_limit: number = 50) {
    return this.runOnce();
  }
}

export default new PaymentMonitorService();
