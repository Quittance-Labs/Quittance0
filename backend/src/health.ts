import type { Request, Response } from 'express';
import { deploymentReadinessAsync, simulationAllowed } from './config/runtime';
import { STELLAR_NETWORK } from './config/stellar';

/**
 * Generates the standardized health payload describing process status and configuration.
 *
 * @param storage - Storage backend mode description.
 * @returns Status payload object.
 */
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
 * Process-only probe that confirms the HTTP listener is accepting connections without calling external services.
 *
 * @param storage - Storage backend mode description.
 * @returns Express route handler.
 */
export function healthHandler(storage: string) {
  return (_req: Request, res: Response) => res.status(200).json(healthPayload(storage));
}

/**
 * Alias for healthHandler representing liveness check.
 */
export const livenessHandler = healthHandler;

/**
 * Readiness probe handler (/api/ready, /ready, /readyz, /api/health/ready).
 * Validates critical environment configuration and optional Horizon reachability.
 * Responds with HTTP 200 when ready or HTTP 503 when missing required prerequisites.
 *
 * @param storage - Storage backend mode description.
 * @returns Express route handler.
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
