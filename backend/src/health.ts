import type { Request, Response } from 'express';
import { deploymentReadiness, simulationAllowed } from './config/runtime';
import { STELLAR_NETWORK } from './config/stellar';

/**
 * Constructs the health status payload.
 *
 * @param storage - Static storage mode string or resolver function.
 * @returns Health check payload object.
 */
export function healthPayload(storage: string | (() => string)) {
  const storageMode = typeof storage === 'function' ? storage() : storage;
  return {
    status: 'ok',
    service: 'Quittance API',
    version: '1.0.0',
    storage: storageMode,
    network: STELLAR_NETWORK,
    simulationEnabled: simulationAllowed(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates an Express handler for liveness health checks.
 *
 * @param storage - Static storage mode string or resolver function.
 * @returns Express request handler.
 */
export function healthHandler(storage: string | (() => string)) {
  return (_req: Request, res: Response) => res.status(200).json(healthPayload(storage));
}

/**
 * Creates an Express handler for deployment readiness checks.
 *
 * @param storage - Static storage mode string or resolver function.
 * @returns Express request handler.
 */
export function readinessHandler(storage: string | (() => string)) {
  return (_req: Request, res: Response) => {
    const storageMode = typeof storage === 'function' ? storage() : storage;
    const readiness = deploymentReadiness();
    res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? 'ready' : 'not_ready',
      service: 'Quittance API',
      storage: storageMode,
      ...readiness,
      timestamp: new Date().toISOString(),
    });
  };
}
