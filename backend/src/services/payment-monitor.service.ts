import stellarService, { PaymentRecord } from './stellar.service';
import invoiceMemoryService from './invoice-memory.service';

export type PaymentMonitorListener = (event: {
  type: 'listening' | 'matched' | 'paid' | 'expired' | 'error';
  invoiceId?: string;
  invoice?: any;
  payment?: PaymentRecord;
  error?: string;
}) => void;

export class PaymentMonitorService {
  private activeStreams: Map<string, () => void> = new Map();
  private invoiceListeners: Map<string, Set<PaymentMonitorListener>> = new Map();
  private expirationInterval: NodeJS.Timeout | null = null;
  private invoiceService: any = invoiceMemoryService;

  constructor(customInvoiceService?: any) {
    if (customInvoiceService) {
      this.invoiceService = customInvoiceService;
    }
  }

  setInvoiceService(service: any) {
    this.invoiceService = service;
  }

  /**
   * Start payment monitor (defaults to env seller if configured)
   */
  start(sellerPublicKey?: string) {
    const key = sellerPublicKey || process.env.SELLER_PUBLIC_KEY;
    if (key) {
      this.startMonitoringSeller(key);
    }
  }

  /**
   * Stop payment monitor
   */
  stop(sellerPublicKey?: string) {
    if (sellerPublicKey) {
      this.stopMonitoringSeller(sellerPublicKey);
    } else {
      this.stopAll();
    }
  }

  /**
   * Manual sync - fetch recent payments for seller
   */
  async manualSync(limit: number = 50, sellerPublicKey?: string) {
    const key = sellerPublicKey || process.env.SELLER_PUBLIC_KEY;
    if (!key) {
      console.log('⚠️ No seller public key provided for manual sync');
      return;
    }
    const payments = await stellarService.getRecentPayments(key, limit);
    for (const payment of payments) {
      await this.handlePayment(payment);
    }
  }

  /**
   * Start monitoring payments for a specific seller account
   */
  startMonitoringSeller(sellerPublicKey: string) {
    if (!sellerPublicKey || typeof sellerPublicKey !== 'string') {
      return;
    }

    if (this.activeStreams.has(sellerPublicKey)) {
      return;
    }

    console.log(`🚀 Starting payment monitor for seller: ${sellerPublicKey}`);

    try {
      const closeHandler = stellarService.streamPayments(
        sellerPublicKey,
        (payment) => this.handlePayment(payment, sellerPublicKey),
        (error) => this.handleError(error, sellerPublicKey)
      );

      this.activeStreams.set(sellerPublicKey, closeHandler);
    } catch (error) {
      console.error(`❌ Failed to start stream for seller ${sellerPublicKey}:`, error);
    }

    this.ensureExpirationCheck();
  }

  /**
   * Stop monitoring a seller account
   */
  stopMonitoringSeller(sellerPublicKey: string) {
    const closeHandler = this.activeStreams.get(sellerPublicKey);
    if (closeHandler) {
      try {
        closeHandler();
      } catch (err) {
        console.error('Error closing stream:', err);
      }
      this.activeStreams.delete(sellerPublicKey);
      console.log(`🛑 Stopped payment monitor for seller: ${sellerPublicKey}`);
    }
  }

  /**
   * Stop all active monitoring streams
   */
  stopAll() {
    this.activeStreams.forEach((closeHandler, seller) => {
      try {
        closeHandler();
      } catch (err) {
        console.error('Error closing stream:', err);
      }
      console.log(`🛑 Stopped stream for: ${seller}`);
    });
    this.activeStreams.clear();
    this.invoiceListeners.clear();
    if (this.expirationInterval) {
      clearInterval(this.expirationInterval);
      this.expirationInterval = null;
    }
  }

  /**
   * Subscribe to live events for a specific invoice
   */
  subscribeInvoice(invoiceId: string, listener: PaymentMonitorListener): () => void {
    if (!this.invoiceListeners.has(invoiceId)) {
      this.invoiceListeners.set(invoiceId, new Set());
    }
    this.invoiceListeners.get(invoiceId)!.add(listener);

    return () => {
      const listeners = this.invoiceListeners.get(invoiceId);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.invoiceListeners.delete(invoiceId);
        }
      }
    };
  }

  /**
   * Notify invoice listeners
   */
  private notifyInvoice(invoiceId: string, event: {
    type: 'listening' | 'matched' | 'paid' | 'expired' | 'error';
    invoiceId?: string;
    invoice?: any;
    payment?: PaymentRecord;
    error?: string;
  }) {
    const listeners = this.invoiceListeners.get(invoiceId);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(event);
        } catch (err) {
          console.error('Listener error:', err);
        }
      });
    }
  }

  /**
   * Handle incoming payment record
   */
  async handlePayment(payment: PaymentRecord, monitoredSeller?: string): Promise<{ success: boolean; reason?: string; invoice?: any }> {
    try {
      console.log('🔍 Processing payment:', payment.txHash, 'memo:', payment.memo);

      if (!payment.memo) {
        console.log('⚠️ Payment without memo, skipping:', payment.txHash);
        return { success: false, reason: 'Payment without memo' };
      }

      // Find invoice by memo
      const invoice = await this.invoiceService.getInvoiceByMemo(payment.memo);

      if (!invoice) {
        console.log('⚠️ No invoice found for memo:', payment.memo);
        return { success: false, reason: 'Invoice not found for memo' };
      }

      // Check idempotency: If already paid with the SAME txHash
      if (invoice.status === 'PAID') {
        if (invoice.paymentTxHash === payment.txHash) {
          console.log('ℹ️ Invoice already paid with this txHash (idempotent):', invoice.id);
          return { success: true, invoice, reason: 'Already paid (idempotent)' };
        }
        console.log('⚠️ Invoice already paid with different txHash:', invoice.id);
        return { success: false, invoice, reason: 'Invoice already paid' };
      }

      // Check if invoice is expired
      const isExpired =
        invoice.status === 'EXPIRED' ||
        new Date(invoice.expiresAt).getTime() <= Date.now();

      if (isExpired) {
        console.log('⚠️ Invoice is expired:', invoice.id);
        this.notifyInvoice(invoice.id, { type: 'expired', invoiceId: invoice.id, invoice });
        return { success: false, invoice, reason: 'Invoice is expired' };
      }

      // Verify destination matches seller
      if (payment.to !== invoice.sellerPublicKey) {
        console.log('⚠️ Destination mismatch:', { expected: invoice.sellerPublicKey, actual: payment.to });
        return { success: false, reason: 'Destination mismatch' };
      }

      // Verify amount (compare with 7 decimal precision)
      const expectedAmount = Number(invoice.amount).toFixed(7);
      const receivedAmount = parseFloat(payment.amount).toFixed(7);

      if (expectedAmount !== receivedAmount) {
        console.log('⚠️ Amount mismatch:', { expected: expectedAmount, received: receivedAmount, invoiceId: invoice.id });
        return { success: false, reason: 'Amount mismatch' };
      }

      // Verify asset
      if (payment.assetCode !== invoice.assetCode) {
        console.log('⚠️ Asset mismatch:', { expected: invoice.assetCode, received: payment.assetCode, invoiceId: invoice.id });
        return { success: false, reason: 'Asset mismatch' };
      }

      // Notify that payment matched before marking
      this.notifyInvoice(invoice.id, {
        type: 'matched',
        invoiceId: invoice.id,
        invoice,
        payment,
      });

      // Mark invoice as paid
      const updatedInvoice = await this.invoiceService.markAsPaid(
        invoice.id,
        payment.txHash,
        payment.from
      );

      console.log('✅ Payment processed successfully:', {
        invoiceId: invoice.id,
        txHash: payment.txHash,
        amount: payment.amount,
      });

      this.notifyInvoice(invoice.id, {
        type: 'paid',
        invoiceId: invoice.id,
        invoice: updatedInvoice,
        payment,
      });

      return { success: true, invoice: updatedInvoice };
    } catch (error: any) {
      console.error('❌ Error processing payment:', error);
      return { success: false, reason: error.message };
    }
  }

  private handleError(error: Error, sellerPublicKey: string) {
    console.error(`❌ Payment stream error for ${sellerPublicKey}:`, error);
  }

  private ensureExpirationCheck() {
    if (!this.expirationInterval) {
      this.expirationInterval = setInterval(async () => {
        try {
          if (this.invoiceService.markExpiredInvoices) {
            await this.invoiceService.markExpiredInvoices();
          }
        } catch (error) {
          console.error('Error checking expired invoices:', error);
        }
      }, 60000);
    }
  }
}

export default new PaymentMonitorService();
