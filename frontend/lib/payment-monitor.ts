/**
 * Real-time Payment Monitoring
 * Monitors Stellar blockchain for incoming payments to user's wallet
 */

import { isPaymentOperation, server } from './stellar';
import { canonicalAmount } from './stroop-amount.js';
import { explorerSegmentFor, resolveStellarNetwork } from '@shared/network';
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

export const paymentMonitorLabels = Object.freeze({
  listening: {
    title: 'Listening for payment',
    description: 'The invoice status updates automatically after confirmation.',
  },
  paused: {
    title: 'Payment monitoring stopped',
    description: 'Manual verification remains available.',
  },
});

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

    console.log(`Starting payment monitoring for: ${publicKey}`);

    // Initialize callbacks array
    this.callbacks.set(publicKey, onPayment ? [onPayment] : []);

    try {
      let streamActive = true;
      const pendingPaymentIds = new Set<string>();
      const deliveredPaymentIds = new Set<string>();
      const closeHandler = server
        .payments()
        .forAccount(publicKey)
        .cursor('now') // Only new payments
        .stream({
          onmessage: async (record: any) => {
            // Horizon can replay an operation while reconnecting. Reserve its
            // ID before the memo lookup so concurrent deliveries toast once.
            if (!streamActive || !isPaymentOperation(record) || record.to !== publicKey) return;
            const paymentId = record.id || record.paging_token;
            if (
              !paymentId ||
              pendingPaymentIds.has(paymentId) ||
              deliveredPaymentIds.has(paymentId)
            ) return;
            pendingPaymentIds.add(paymentId);

            try {
              // Fetch transaction for memo
              const transaction = await server
                .transactions()
                .transaction(record.transaction_hash)
                .call();

              if (!streamActive) return;

              const payment: PaymentNotification = {
                id: paymentId,
                hash: record.transaction_hash,
                from: record.from,
                to: record.to,
                amount: record.amount,
                assetCode: record.asset_type === 'native' ? 'XLM' : record.asset_code,
                memo: transaction.memo || undefined,
                timestamp: new Date(record.created_at),
              };

              console.log('Payment received:', payment);

              // Show toast notification
              this.showNotification(payment);
              deliveredPaymentIds.add(paymentId);
              // Bound replay bookkeeping for wallets left open for days.
              if (deliveredPaymentIds.size > 1000) {
                deliveredPaymentIds.delete(deliveredPaymentIds.values().next().value!);
              }

              // Call all registered callbacks
              const callbacks = this.callbacks.get(publicKey) || [];
              callbacks.forEach((callback) => {
                try {
                  callback(payment);
                } catch (error) {
                  console.error('Payment callback failed:', error);
                }
              });
            } catch (error) {
              console.error('Error processing payment:', error);
            } finally {
              pendingPaymentIds.delete(paymentId);
            }
          },
          onerror: (error: any) => {
            if (!streamActive) return;
            console.error('Payment stream error:', error);
            // Horizon/stream failures are surfaced as a stable string so the
            // monitor banner reads consistently with API/verification errors.
            toast.error('Payment monitoring disconnected', {
              description: 'The live stream is unavailable. Reconnecting automatically.',
            });

            // Try to reconnect after 5 seconds
            setTimeout(() => {
              if (!streamActive) return;
              console.log('Reconnecting payment stream...');
              this.stopMonitoring(publicKey);
              this.startMonitoring(publicKey, onPayment);
            }, 5000);
          },
        });

      this.activeStreams.set(publicKey, () => {
        streamActive = false;
        closeHandler();
      });
      
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
      console.log(`Stopped payment monitoring for: ${publicKey}`);
    }
  }

  /**
   * Stop all active monitoring
   */
  stopAll() {
    this.activeStreams.forEach((closeHandler, publicKey) => {
      closeHandler();
      console.log(`Stopped payment monitoring for: ${publicKey}`);
    });
    this.activeStreams.clear();
    this.callbacks.clear();
  }

  /**
   * Show notification for received payment
   */
  private showNotification(payment: PaymentNotification) {
    const amount = canonicalAmount(payment.amount) ?? payment.amount;
    
    // Play notification sound (optional)
    if (typeof window !== 'undefined' && 'Notification' in window) {
      // Request notification permission if not granted
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }

      // Show browser notification if permitted
      if (Notification.permission === 'granted') {
        new Notification('Payment Received!', {
          body: `${amount} ${payment.assetCode} from ${payment.from.slice(0, 8)}...`,
          icon: '/Quittance.jpg',
          tag: payment.hash,
        });
      }
    }

    // Show toast notification
    toast.success('Payment Received!', {
      description: `${amount} ${payment.assetCode}${payment.memo ? ` - Memo: ${payment.memo}` : ''}`,
      duration: 10000,
      action: {
        label: 'View',
        onClick: () => {
          const network = explorerSegmentFor(
            resolveStellarNetwork(process.env.NEXT_PUBLIC_STELLAR_NETWORK)
          );
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

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    paymentMonitor.stopAll();
  });
}
