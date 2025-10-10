import stellarService, { PaymentRecord } from './stellar.service';
import invoiceService from './invoice.service';
import { SELLER_PUBLIC_KEY } from '../config/stellar';
import { pool } from '../config/database';

class PaymentMonitorService {
  private closeHandler: (() => void) | null = null;
  private isRunning: boolean = false;

  /**
   * Start monitoring payments for the seller account
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Payment monitor is already running');
      return;
    }

    console.log('🚀 Starting payment monitor...');
    this.isRunning = true;

    // Start streaming payments
    this.closeHandler = stellarService.streamPayments(
      SELLER_PUBLIC_KEY,
      this.handlePayment.bind(this),
      this.handleError.bind(this)
    );

    // Start periodic check for expired invoices
    this.startExpirationCheck();

    console.log('✅ Payment monitor started successfully');
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️ Payment monitor is not running');
      return;
    }

    console.log('🛑 Stopping payment monitor...');
    
    if (this.closeHandler) {
      this.closeHandler();
      this.closeHandler = null;
    }

    this.isRunning = false;
    console.log('✅ Payment monitor stopped');
  }

  /**
   * Handle incoming payment
   */
  private async handlePayment(payment: PaymentRecord) {
    try {
      console.log('🔍 Processing payment:', payment.txHash);

      // Check if payment has a memo
      if (!payment.memo) {
        console.log('⚠️ Payment without memo, skipping:', payment.txHash);
        return;
      }

      // Find invoice by memo
      const invoice = await invoiceService.getInvoiceByMemo(payment.memo);

      if (!invoice) {
        console.log('⚠️ No invoice found for memo:', payment.memo);
        return;
      }

      // Check if invoice is already paid
      if (invoice.status === 'PAID') {
        console.log('⚠️ Invoice already paid:', invoice.id);
        return;
      }

      // Check if invoice is expired
      if (invoice.status === 'EXPIRED') {
        console.log('⚠️ Invoice is expired:', invoice.id);
        return;
      }

      // Verify payment amount
      const expectedAmount = invoice.amount.toFixed(7);
      const receivedAmount = parseFloat(payment.amount).toFixed(7);

      if (expectedAmount !== receivedAmount) {
        console.log('⚠️ Amount mismatch:', {
          expected: expectedAmount,
          received: receivedAmount,
          invoiceId: invoice.id,
        });

        // Log the partial payment attempt
        await invoiceService.logPaymentEvent(invoice.id, 'PARTIAL_PAYMENT', {
          txHash: payment.txHash,
          expectedAmount,
          receivedAmount,
          payerPublicKey: payment.from,
        });

        return;
      }

      // Verify asset
      if (payment.assetCode !== invoice.assetCode) {
        console.log('⚠️ Asset mismatch:', {
          expected: invoice.assetCode,
          received: payment.assetCode,
          invoiceId: invoice.id,
        });
        return;
      }

      // Save transaction to database
      await this.saveTransaction(payment, invoice.id);

      // Mark invoice as paid
      await invoiceService.markAsPaid(invoice.id, payment.txHash, payment.from);

      console.log('✅ Payment processed successfully:', {
        invoiceId: invoice.id,
        txHash: payment.txHash,
        amount: payment.amount,
      });

      // TODO: Send notification to customer/seller
      // await this.sendPaymentNotification(invoice, payment);

    } catch (error: any) {
      console.error('❌ Error processing payment:', error);
    }
  }

  /**
   * Save transaction to database
   */
  private async saveTransaction(payment: PaymentRecord, invoiceId: string) {
    const query = `
      INSERT INTO transactions (
        invoice_id, from_address, to_address, amount, asset_code, asset_issuer,
        tx_hash, memo, ledger, processed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (tx_hash) DO NOTHING
    `;

    const values = [
      invoiceId,
      payment.from,
      payment.to,
      payment.amount,
      payment.assetCode,
      payment.assetIssuer || null,
      payment.txHash,
      payment.memo || null,
      payment.ledger,
    ];

    await pool.query(query, values);
    console.log('💾 Transaction saved to database');
  }

  /**
   * Handle stream errors
   */
  private handleError(error: Error) {
    console.error('❌ Payment stream error:', error);
    
    // Attempt to restart after delay
    setTimeout(() => {
      if (this.isRunning) {
        console.log('🔄 Attempting to restart payment stream...');
        this.stop();
        this.start();
      }
    }, 5000);
  }

  /**
   * Start periodic check for expired invoices
   */
  private startExpirationCheck() {
    setInterval(async () => {
      try {
        await invoiceService.markExpiredInvoices();
      } catch (error) {
        console.error('Error checking expired invoices:', error);
      }
    }, 60000); // Check every minute
  }

  /**
   * Manual sync - fetch recent payments and process them
   */
  async manualSync(limit: number = 50) {
    console.log('🔄 Starting manual payment sync...');

    try {
      const payments = await stellarService.getRecentPayments(SELLER_PUBLIC_KEY, limit);
      
      for (const payment of payments) {
        await this.handlePayment(payment);
      }

      console.log(`✅ Manual sync completed, processed ${payments.length} payments`);
    } catch (error) {
      console.error('❌ Manual sync error:', error);
      throw error;
    }
  }
}

export default new PaymentMonitorService();

