import path from 'node:path';
import stellarService, { PaymentPageRecord, PaymentRecord } from './stellar.service';
import invoiceService, { InvoiceService, Queryable } from './invoice.service';
import { SELLER_PUBLIC_KEY, STELLAR_NETWORK } from '../config/stellar';
import { pool } from '../config/database';
import { checkInvoiceIsPayable, verifyHorizonPayment } from './payment-verification';
import {
  parseSettlementTime,
  SettlementTimeUnavailableError,
} from '../domain/invoice-settlement';
import { monitorBackoffMs } from '../utils/monitor-retry-backoff';
import {
  FilePaymentMonitorCheckpointStore,
  PaymentMonitorCheckpointStore,
  PostgresPaymentMonitorCheckpointStore,
} from './payment-monitor-checkpoint';
import { logEvent, logReference } from '../observability/log-events';
import { createRequestId } from '../utils/request-correlation-id';

export interface PaymentPageSource {
  getPaymentsPage(account: string, cursor: string, limit: number): Promise<PaymentPageRecord[]>;
  getLatestPaymentCursor(account: string): Promise<string>;
}

export interface MonitorInvoiceService {
  getInvoiceByMemo(memo: string): ReturnType<InvoiceService['getInvoiceByMemo']>;
  markAsPaid: InvoiceService['markAsPaid'];
  markExpiredInvoices: InvoiceService['markExpiredInvoices'];
  logPaymentEvent: InvoiceService['logPaymentEvent'];
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
}

function defaultCheckpointStore(database?: Queryable): PaymentMonitorCheckpointStore {
  const cursorFile = process.env.PAYMENT_MONITOR_CURSOR_FILE?.trim();
  if (cursorFile) {
    return new FilePaymentMonitorCheckpointStore(path.resolve(cursorFile));
  }
  if (!database || process.env.STORAGE_MODE === 'memory') {
    return new FilePaymentMonitorCheckpointStore(path.resolve('data/payment-monitor-checkpoint.json'));
  }
  return new PostgresPaymentMonitorCheckpointStore(database);
}

/**
 * Cursor-driven Horizon monitor.
 *
 * Records are read oldest-first and the cursor advances only after one record
 * is fully handled. If the process dies after settlement but before the cursor
 * write, that record is replayed; PAID state and the unique tx hash make the
 * replay harmless. A failure never skips later records from the same page.
 */
export class PaymentMonitorService {
  private account?: string;
  private network: string;
  private pollIntervalMs: number;
  private pageSize: number;
  private maxPagesPerRun: number;
  private source: PaymentPageSource;
  private invoices: MonitorInvoiceService;
  private checkpoints: PaymentMonitorCheckpointStore;
  private database?: Queryable;
  private pollTimer: NodeJS.Timeout | null = null;
  private expirationTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private syncInFlight = false;
  private snapshot: PaymentMonitorSnapshot = { state: 'stopped', consecutiveFailures: 0 };

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
    if ('database' in options) this.database = options.database;
    if (options.checkpoints !== undefined) {
      this.checkpoints = options.checkpoints;
    } else if (options.database !== undefined) {
      this.checkpoints = defaultCheckpointStore(this.database);
    }
    this.snapshot.account = this.account;
  }

  start() {
    if (this.isRunning) return;
    if (!this.account) throw new Error('Payment monitor requires SELLER_PUBLIC_KEY');
    this.isRunning = true;
    this.snapshot = { state: 'starting', account: this.account, consecutiveFailures: 0 };
    this.expirationTimer = setInterval(() => {
      void this.invoices.markExpiredInvoices().catch((error) => {
        console.error('Error checking expired invoices:', error);
      });
    }, 60_000);
    this.schedule(0);
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.expirationTimer) clearInterval(this.expirationTimer);
    this.pollTimer = null;
    this.expirationTimer = null;
    this.snapshot = { ...this.snapshot, state: 'stopped', nextRetryAt: undefined };
  }

  getStatus(): PaymentMonitorSnapshot {
    return { ...this.snapshot };
  }

  private schedule(delayMs: number) {
    if (!this.isRunning) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick() {
    if (!this.isRunning || this.syncInFlight) return;
    this.syncInFlight = true;
    try {
      await this.runOnce();
      this.snapshot = {
        ...this.snapshot,
        state: 'running',
        consecutiveFailures: 0,
        lastSuccessAt: new Date().toISOString(),
        lastError: undefined,
        nextRetryAt: undefined,
      };
      this.schedule(this.pollIntervalMs);
    } catch (error: any) {
      const failures = this.snapshot.consecutiveFailures + 1;
      const retryMs = monitorBackoffMs(failures - 1);
      this.snapshot = {
        ...this.snapshot,
        state: 'retrying',
        consecutiveFailures: failures,
        lastError: error?.message || String(error),
        nextRetryAt: new Date(Date.now() + retryMs).toISOString(),
      };
      console.error(`Payment monitor failed; retrying in ${retryMs}ms`, error);
      this.schedule(retryMs);
    } finally {
      this.syncInFlight = false;
    }
  }

  /** Process available records up to the bounded per-run page budget. */
  async runOnce(): Promise<{ processed: number; cursor: string; bootstrapped: boolean }> {
    if (!this.account) throw new Error('Payment monitor requires SELLER_PUBLIC_KEY');

    const checkpoint = await this.checkpoints.load(this.account, this.network);
    if (!checkpoint) {
      const cursor = await this.source.getLatestPaymentCursor(this.account);
      await this.checkpoints.save({ account: this.account, network: this.network, cursor });
      this.snapshot = { ...this.snapshot, cursor };
      return { processed: 0, cursor, bootstrapped: true };
    }

    let cursor = checkpoint.cursor;
    let processed = 0;
    for (let pageNumber = 0; pageNumber < this.maxPagesPerRun; pageNumber += 1) {
      const page = await this.source.getPaymentsPage(this.account, cursor, this.pageSize);
      if (page.length === 0) break;

      for (const record of page) {
        if (record.payment) await this.handlePayment(record.payment);
        await this.checkpoints.save({
          account: this.account,
          network: this.network,
          cursor: record.pagingToken,
          ledger: record.ledger,
        });
        cursor = record.pagingToken;
        processed += 1;
        this.snapshot = { ...this.snapshot, cursor, ledger: record.ledger };
      }

      if (page.length < this.pageSize) break;
    }
    return { processed, cursor, bootstrapped: false };
  }

  private async handlePayment(payment: PaymentRecord): Promise<void> {
    if (!payment.memo) return;
    const invoice = await this.invoices.getInvoiceByMemo(payment.memo);
    if (!invoice) return;

    const payable = checkInvoiceIsPayable(invoice.status);
    if (!payable.ok && invoice.status !== 'CANCELLED') return;

    const isNative = payment.assetCode === 'XLM' && !payment.assetIssuer;
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
      await this.invoices.logPaymentEvent(
        invoice.id,
        verification.code === 'AMOUNT_MISMATCH' ? 'PARTIAL_PAYMENT' : 'PAYMENT_REJECTED',
        {
          code: verification.code,
          txHash: payment.txHash,
          expectedAmount: invoice.amount.toFixed(7),
          receivedAmount: payment.amount,
          payerPublicKey: payment.from,
        }
      );
      return;
    }

    const settledAt = parseSettlementTime(payment.createdAt) ?? verification.value.settledAt;
    if (invoice.status === 'CANCELLED' && !settledAt) {
      throw new SettlementTimeUnavailableError();
    }

    await this.saveTransaction(payment, invoice.id);
    await this.invoices.markAsPaid(
      invoice.id,
      payment.txHash,
      payment.from,
      undefined,
      { settledAt }
    );
    const monitorReqId = createRequestId();
    logEvent('info', 'invoice.paid', { requestId: monitorReqId, service: 'api' }, {
      invoiceRef: logReference(invoice.id),
      sellerRef: logReference(invoice.sellerPublicKey),
      txRef: logReference(payment.txHash),
      assetCode: invoice.assetCode,
      network: STELLAR_NETWORK,
      storage: this.database ? 'postgres' : 'in-memory',
    });
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
      console.warn('Could not persist transaction record:', error);
    }
  }

  /** Keep the operator endpoint, now backed by the durable cursor. */
  async manualSync(_limit: number = 50) {
    return this.runOnce();
  }
}

export default new PaymentMonitorService();
