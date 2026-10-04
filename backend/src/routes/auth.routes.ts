import { Router } from 'express';
import { createRateLimiter, getClientIp } from '../middleware/rate-limit';
import { sendSellerSessionError, type SellerSessionProvider } from '../middleware/seller-session';

/** Mounted under /api by the shared invoice router in all three server modes. */
export function createSellerAuthRouter(provider: SellerSessionProvider, rateLimit: boolean): Router {
  const router = Router();
  const challengeLimit = rateLimit ? [createRateLimiter({
    windowMs: 60_000, max: 20, keyGenerator: req => `seller-challenge:${getClientIp(req)}`,
  })] : [];
  const sessionLimit = rateLimit ? [createRateLimiter({
    windowMs: 60_000, max: 30, keyGenerator: req => `seller-session:${getClientIp(req)}`,
  })] : [];
  router.get('/auth/challenge', ...challengeLimit, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json({ success: true, data: provider().issueChallenge(req.query.account, req.query.network) });
    } catch (error) {
      sendSellerSessionError(res, error);
    }
  });
  router.post('/auth/session', ...sessionLimit, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json({ success: true, data: provider().redeemChallenge(req.body?.transaction, req.body?.network) });
    } catch (error) {
      sendSellerSessionError(res, error);
    }
  });
  return router;
}
