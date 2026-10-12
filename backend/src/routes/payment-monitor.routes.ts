import { Router, Request, Response } from 'express';
import paymentMonitorService, { PaymentMonitorService } from '../services/payment-monitor.service';

function extractOperatorToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (match) return match[1].trim();
  }
  const customHeader = req.headers['x-operator-token'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }
  return undefined;
}

/**
 * Creates the payment monitor HTTP router.
 */
export function createPaymentMonitorRouter(
  monitor: PaymentMonitorService = paymentMonitorService
): Router {
  const router = Router();

  router.post('/payment/sync', async (req: Request, res: Response) => {
    const expectedToken = (
      process.env.OPERATOR_TOKEN ||
      process.env.PAYMENT_MONITOR_OPERATOR_TOKEN ||
      (process.env.NODE_ENV !== 'production' ? 'test-operator-token' : undefined)
    )?.trim();

    const providedToken = extractOperatorToken(req);

    if (!providedToken) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: operator token required',
      });
    }

    if (expectedToken && providedToken !== expectedToken) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: invalid operator token',
      });
    }

    if (!expectedToken) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: operator token not configured on server',
      });
    }

    try {
      const limit = Number(req.body?.limit) || 50;
      await monitor.manualSync(limit);
      res.json({
        success: true,
        message: 'Payment sync completed',
        limit,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error?.message || 'Sync failed',
      });
    }
  });

  router.get('/payment/monitor/status', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: monitor.getStatus(),
    });
  });

  return router;
}

export default createPaymentMonitorRouter;
