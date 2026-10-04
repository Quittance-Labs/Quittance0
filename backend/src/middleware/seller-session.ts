import type { Request, RequestHandler, Response } from 'express';
import { SellerSessionError, type SellerSession, type SellerSessionService } from '../services/seller-session.service';

export type SellerSessionProvider = () => SellerSessionService;

export function sendSellerSessionError(res: Response, error: unknown): void {
  const failure = error instanceof SellerSessionError
    ? error
    : new SellerSessionError('AUTH_TOKEN_INVALID', 'Seller session is invalid');
  res.setHeader('Cache-Control', 'no-store');
  res.status(failure.status).json({ success: false, code: failure.code, error: failure.message });
}

export function sellerSessionFor(res: Response): SellerSession | undefined {
  return res.locals?.sellerSession as SellerSession | undefined;
}

/** Handler-level guard also keeps direct adapter users from treating a key as proof. */
export function requireSellerContext(req: Request, res: Response): SellerSession | undefined {
  const session = sellerSessionFor(res);
  if (!session) {
    sendSellerSessionError(res, new SellerSessionError('AUTH_SESSION_REQUIRED', 'A seller session is required'));
    return;
  }
  const keys = [req.query?.sellerPublicKey, req.body?.sellerPublicKey, req.headers?.['x-seller-public-key']];
  if (keys.some(key => key !== undefined && key !== session.sellerPublicKey)) {
    sendSellerSessionError(res, new SellerSessionError('AUTH_SELLER_MISMATCH', 'Requested seller does not match the authenticated wallet', 403));
    return;
  }
  return session;
}

function attachSession(provider: SellerSessionProvider, required: boolean): RequestHandler {
  return (req, res, next) => {
    res.vary('Authorization');
    const authorization = req.headers.authorization;
    if (authorization === undefined && !required) return next();
    if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) {
      return sendSellerSessionError(res, new SellerSessionError('AUTH_SESSION_REQUIRED', 'A seller session is required'));
    }
    try {
      const session = provider().verifyToken(authorization.slice(7));
      const declaredKeys = [req.query?.sellerPublicKey, req.body?.sellerPublicKey, req.headers['x-seller-public-key']];
      if (declaredKeys.some(key => key !== undefined && key !== session.sellerPublicKey)) {
        throw new SellerSessionError('AUTH_SELLER_MISMATCH', 'Requested seller does not match the authenticated wallet', 403);
      }
      res.locals.sellerSession = session;
      res.setHeader('Cache-Control', 'no-store');
      return next();
    } catch (error) {
      return sendSellerSessionError(res, error);
    }
  };
}

/** Applies before seller rate limits and before any storage or mutation work. */
export function requireSellerSession(provider: SellerSessionProvider): RequestHandler {
  return attachSession(provider, true);
}

/** Anonymous invoice reads remain public; malformed/stale presented tokens fail. */
export function optionalSellerSession(provider: SellerSessionProvider): RequestHandler {
  return attachSession(provider, false);
}
