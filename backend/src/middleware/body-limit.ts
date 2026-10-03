import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { EDGE_CONTROL_DEFAULTS } from './edge-config';

/** Compatibility defaults only; app parsers use getEdgeControlConfig() at startup. */
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
    // body-parser supplies the actual limit captured by its parser instance.
    // Re-reading env here could describe a different cap after a config change.
    const bytes = err.limit;
    const limit = Number.isSafeInteger(bytes) && bytes > 0
      ? (bytes % 1024 === 0 ? `${bytes / 1024} kB` : `${bytes} byte`)
      : 'configured';
    return res.status(413).json({
      success: false,
      code: 'PAYLOAD_TOO_LARGE',
      error: `Payload too large: request body exceeds ${limit} limit`,
    });
  }
  next(err);
};

export default bodyLimitErrorHandler;
