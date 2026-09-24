import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { getEdgeControlConfig, EDGE_CONTROL_DEFAULTS } from './edge-config';

/** Bytes cap — default 16 KiB; live value via getEdgeControlConfig(). */
export const MAX_BODY_BYTES = EDGE_CONTROL_DEFAULTS.maxBodyBytes;
/** Express `limit` string for the default body cap. */
export const MAX_BODY_STRING = EDGE_CONTROL_DEFAULTS.maxBodyString;

/**
 * Error handling middleware to catch request bodies exceeding the configured size limit
 * and return a uniform 413 error envelope.
 *
 * Runs after express.json / urlencoded (step 1 of the edge middleware order in
 * edge-config.ts). Stable code: PAYLOAD_TOO_LARGE.
 */
export const bodyLimitErrorHandler: ErrorRequestHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
    const cfg = getEdgeControlConfig();
    const kb = Math.max(1, Math.ceil(cfg.maxBodyBytes / 1024));
    return res.status(413).json({
      success: false,
      code: 'PAYLOAD_TOO_LARGE',
      error: `Payload too large: request body exceeds ${kb} kB limit`,
    });
  }
  next(err);
};

export default bodyLimitErrorHandler;
