import { Request, Response } from 'express';
import stellarService from '../services/stellar.service';
import { SELLER_PUBLIC_KEY } from '../config/stellar';

class StellarController {
  /**
   * Get seller account info
   * GET /api/stellar/account
   */
  async getAccountInfo(req: Request, res: Response) {
    try {
      const publicKey = req.query.publicKey as string || SELLER_PUBLIC_KEY;
      
      const account = await stellarService.loadAccount(publicKey);
      const balances = await stellarService.getBalance(publicKey);

      res.json({
        success: true,
        data: {
          publicKey,
          balances,
          sequence: account.sequence,
          subentryCount: account.subentry_count,
        },
      });
    } catch (error: any) {
      console.error('Get account info error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get account info',
      });
    }
  }

  /**
   * Get recent payments
   * GET /api/stellar/payments
   */
  async getPayments(req: Request, res: Response) {
    try {
      const publicKey = req.query.publicKey as string || SELLER_PUBLIC_KEY;
      const limit = parseInt(req.query.limit as string) || 10;

      const payments = await stellarService.getRecentPayments(publicKey, limit);

      res.json({
        success: true,
        data: payments,
      });
    } catch (error: any) {
      console.error('Get payments error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get payments',
      });
    }
  }

  /**
   * Get transaction details
   * GET /api/stellar/transaction/:hash
   */
  async getTransaction(req: Request, res: Response) {
    try {
      const { hash } = req.params;
      const transaction = await stellarService.getTransaction(hash);

      res.json({
        success: true,
        data: transaction,
      });
    } catch (error: any) {
      console.error('Get transaction error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get transaction',
      });
    }
  }

  /**
   * Verify payment
   * POST /api/stellar/verify-payment
   */
  async verifyPayment(req: Request, res: Response) {
    try {
      const { txHash, memo, amount } = req.body;

      if (!txHash || !memo || !amount) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: txHash, memo, amount',
        });
      }

      const isValid = await stellarService.verifyPayment(txHash, memo, amount);

      res.json({
        success: true,
        data: {
          isValid,
          txHash,
          memo,
          amount,
        },
      });
    } catch (error: any) {
      console.error('Verify payment error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to verify payment',
      });
    }
  }
}

export default new StellarController();

