import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';

export const MAX_BODY_BYTES = process.env.MAX_BODY_BYTES
  ? parseInt(process.env.MAX_BODY_BYTES, 10)
  : 16 * 1024;
export const MAX_BODY_STRING = process.env.MAX_BODY_BYTES
  ? `${process.env.MAX_BODY_BYTES}b`
  : '16kb';

/**
 * Error handling middleware to catch request bodies exceeding the configured size limit
 * and return a uniform 413 error envelope.
 */
export const bodyLimitErrorHandler: ErrorRequestHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
    const limitDisplay = Math.round(MAX_BODY_BYTES / 1024);
    return res.status(413).json({
      success: false,
      code: 'PAYLOAD_TOO_LARGE',
      error: `Payload too large: request body exceeds ${limitDisplay} kB limit`,
    });
  }
  next(err);
};
