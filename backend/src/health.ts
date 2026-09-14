import type { Request, Response } from 'express';
import { deploymentReadinessAsync, simulationAllowed } from './config/runtime';
import { STELLAR_NETWORK } from './config/stellar';

export function healthPayload(storage: string) {
  return {
    status: 'ok',
    service: 'Quittance API',
    version: '1.0.0',
    storage,
    network: STELLAR_NETWORK,
    simulationEnabled: simulationAllowed(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Liveness probe handler (/api/health, /health, /healthz, /api/health/live).
 * Fast, in-process check that confirms the HTTP listener is accepting traffic.
 * Does not check external dependencies or database to avoid cold-start restart loops.
 */
export function healthHandler(storage: string) {
  return (_req: Request, res: Response) => res.status(200).json(healthPayload(storage));
}

export const livenessHandler = healthHandler;

/**
 * Readiness probe handler (/api/ready, /ready, /readyz, /api/health/ready).
 * Validates critical environment variables (network, Horizon URL, CORS origins)
 * and optionally pings Horizon when configured. Fails fast with HTTP 503 when not ready.
 */
export function readinessHandler(storage: string) {
  return async (req: Request, res: Response) => {
    const pingRequested = req.query.ping === 'true';
    const readiness = await deploymentReadinessAsync(process.env, {
      storage,
      pingHorizon: pingRequested ? true : undefined,
    });

    res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? 'ready' : 'not_ready',
      service: 'Quittance API',
      storage,
      ...readiness,
      timestamp: new Date().toISOString(),
    });
  };
}
