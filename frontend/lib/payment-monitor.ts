/**
 * Real-time Payment Monitoring
 * Monitors Stellar blockchain for incoming payments to user's wallet
 */

import { server } from './stellar';
import { toast } from 'sonner';

export interface PaymentNotification {
  id: string;
  hash: string;
  from: string;
  to: string;
  amount: string;
  assetCode: string;
  memo?: string;
  timestamp: Date;
}

type PaymentCallback = (payment: PaymentNotification) => void;

class PaymentMonitor {
  private activeStreams: Map<string, () => void> = new Map();
  private callbacks: Map<string, PaymentCallback[]> = new Map();

  /**
   * Start monitoring payments for a wallet address
   */
  startMonitoring(publicKey: string, onPayment?: PaymentCallback) {
    // If already monitoring, just add callback
    if (this.activeStreams.has(publicKey)) {
      if (onPayment) {
        const callbacks = this.callbacks.get(publicKey) || [];
        callbacks.push(onPayment);
        this.callbacks.set(publicKey, callbacks);
      }
      return;
    }

    console.log(`🔄 Starting payment monitoring for: ${publicKey}`);

    // Initialize callbacks array
    this.callbacks.set(publicKey, onPayment ? [onPayment] : []);

    try {
      const closeHandler = server
        .payments()
        .forAccount(publicKey)
        .cursor('now') // Only new payments
        .stream({
          onmessage: async (record: any) => {
            try {
              // Only process incoming payments
              if (record.type === 'payment' && record.to === publicKey) {
                // Fetch transaction for memo
                const transaction = await server
                  .transactions()
                  .transaction(record.transaction_hash)
                  .call();

                const payment: PaymentNotification = {
                  id: record.id,
                  hash: record.transaction_hash,
                  from: record.from,
                  to: record.to,
                  amount: record.amount,
                  assetCode: record.asset_type === 'native' ? 'XLM' : record.asset_code,
                  memo: transaction.memo || undefined,
                  timestamp: new Date(record.created_at),
                };

                console.log('💰 Payment received:', payment);

                // Show toast notification
                this.showNotification(payment);

                // Call all registered callbacks
                const callbacks = this.callbacks.get(publicKey) || [];
                callbacks.forEach((callback) => callback(payment));
              }
            } catch (error) {
              console.error('Error processing payment:', error);
            }
          },
          onerror: (error: any) => {
            console.error('❌ Payment stream error:', error);
            toast.error('Payment monitoring disconnected', {
              description: 'Reconnecting...',
            });

            // Try to reconnect after 5 seconds
            setTimeout(() => {
              console.log('🔄 Reconnecting payment stream...');
              this.stopMonitoring(publicKey);
              this.startMonitoring(publicKey, onPayment);
            }, 5000);
          },
        });

      this.activeStreams.set(publicKey, closeHandler);
      
      toast.success('Payment monitoring active', {
        description: 'You will be notified of incoming payments',
        duration: 3000,
      });
    } catch (error) {
      console.error('Failed to start payment monitoring:', error);
      toast.error('Failed to start payment monitoring');
    }
  }

  /**
   * Stop monitoring payments for a wallet address
   */
  stopMonitoring(publicKey: string) {
    const closeHandler = this.activeStreams.get(publicKey);
    if (closeHandler) {
      closeHandler();
      this.activeStreams.delete(publicKey);
      this.callbacks.delete(publicKey);
      console.log(`⏹️  Stopped payment monitoring for: ${publicKey}`);
    }
  }

  /**
   * Stop all active monitoring
   */
  stopAll() {
    this.activeStreams.forEach((closeHandler, publicKey) => {
      closeHandler();
      console.log(`⏹️  Stopped payment monitoring for: ${publicKey}`);
    });
    this.activeStreams.clear();
    this.callbacks.clear();
  }

  /**
   * Show notification for received payment
   */
  private showNotification(payment: PaymentNotification) {
    const amount = parseFloat(payment.amount).toFixed(2);
    
    // Play notification sound (optional)
    if (typeof window !== 'undefined' && 'Notification' in window) {
      // Request notification permission if not granted
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }

      // Show browser notification if permitted
      if (Notification.permission === 'granted') {
        new Notification('💰 Payment Received!', {
          body: `${amount} ${payment.assetCode} from ${payment.from.slice(0, 8)}...`,
          icon: '/Quittance.jpg',
          tag: payment.hash,
        });
      }
    }

    // Show toast notification
    toast.success('💰 Payment Received!', {
      description: `${amount} ${payment.assetCode}${payment.memo ? ` - Memo: ${payment.memo}` : ''}`,
      duration: 10000,
      action: {
        label: 'View',
        onClick: () => {
          const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'TESTNET' ? 'testnet' : 'public';
          window.open(`https://stellar.expert/explorer/${network}/tx/${payment.hash}`, '_blank');
        },
      },
    });
  }

  /**
   * Check if monitoring is active for an address
   */
  isMonitoring(publicKey: string): boolean {
    return this.activeStreams.has(publicKey);
  }

  /**
   * Get number of active monitors
   */
  getActiveCount(): number {
    return this.activeStreams.size;
  }
}

// Export singleton instance
export const paymentMonitor = new PaymentMonitor();
export default paymentMonitor;

export type InvoiceMonitorStatus = 'idle' | 'listening' | 'matched' | 'paid' | 'expired' | 'error';

export interface InvoiceMonitorEvent {
  status: InvoiceMonitorStatus;
  message?: string;
  invoice?: Invoice;
  txHash?: string;
}

import { invoiceApi, Invoice } from './api';

/**
 * Monitor an individual invoice for auto-completion.
 * Uses SSE stream from backend if available, and falls back to live Horizon stream + auto verify.
 */
export function monitorInvoice(
  invoice: Invoice,
  onEvent: (event: InvoiceMonitorEvent) => void
): () => void {
  let isCleanedUp = false;
  let eventSource: EventSource | null = null;

  if (invoice.status === 'PAID') {
    onEvent({ status: 'paid', invoice });
    return () => {};
  }

  if (invoice.status !== 'PENDING') {
    onEvent({ status: invoice.status.toLowerCase() as InvoiceMonitorStatus, invoice });
    return () => {};
  }

  onEvent({ status: 'listening', message: 'Listening for transfer on Stellar network...' });

  // 1. Try SSE Stream from backend API
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
  const sseUrl = `${apiUrl}/invoices/${invoice.id}/stream`;

  if (typeof window !== 'undefined' && typeof window.EventSource !== 'undefined') {
    try {
      eventSource = new EventSource(sseUrl);

      eventSource.onmessage = (e) => {
        if (isCleanedUp) return;
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'matched') {
            onEvent({
              status: 'matched',
              message: 'Payment detected! Verifying on-chain...',
              invoice: data.invoice,
              txHash: data.payment?.txHash,
            });
          } else if (data.type === 'paid') {
            onEvent({
              status: 'paid',
              message: 'Payment confirmed on Stellar!',
              invoice: data.invoice,
              txHash: data.payment?.txHash || data.invoice?.paymentTxHash,
            });
          } else if (data.type === 'expired') {
            onEvent({
              status: 'expired',
              message: 'Invoice has expired',
              invoice: data.invoice,
            });
          }
        } catch (err) {
          console.error('SSE parse error:', err);
        }
      };

      eventSource.onerror = () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
      };
    } catch (err) {
      console.warn('SSE initialization failed:', err);
    }
  }

  // 2. Client-side Horizon stream fallback
  try {
    const onHorizonPayment = async (payment: PaymentNotification) => {
      if (isCleanedUp) return;

      // Check memo match
      if (!payment.memo || payment.memo !== invoice.memo) {
        return;
      }

      // Check destination
      if (payment.to !== invoice.sellerPublicKey) {
        return;
      }

      // Check amount
      const expectedAmount = Number(invoice.amount).toFixed(7);
      const receivedAmount = parseFloat(payment.amount).toFixed(7);
      if (expectedAmount !== receivedAmount) {
        return;
      }

      // Check asset
      if (payment.assetCode !== invoice.assetCode) {
        return;
      }

      onEvent({
        status: 'matched',
        message: 'Matching payment detected on Stellar! Verifying...',
        txHash: payment.hash,
      });

      // Auto-verify with backend to transition invoice to PAID
      try {
        const verifyRes = await invoiceApi.verify(invoice.id, payment.hash);
        if (verifyRes.data) {
          const paidInvoice: Invoice | undefined =
            'id' in verifyRes.data ? (verifyRes.data as Invoice) : (verifyRes.data as any).invoice;
          onEvent({
            status: 'paid',
            message: 'Payment verified and marked PAID!',
            invoice: paidInvoice || invoice,
            txHash: payment.hash,
          });
        }
      } catch (err: any) {
        console.error('Auto verify error:', err);
      }
    };

    paymentMonitor.startMonitoring(invoice.sellerPublicKey, onHorizonPayment);
  } catch (err) {
    console.error('Failed to attach Horizon monitor listener:', err);
  }

  return () => {
    isCleanedUp = true;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    paymentMonitor.stopAll();
  });
}

