import type { Request, Response } from 'express';
import { deploymentReadiness, simulationAllowed } from './config/runtime';
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

export function healthHandler(storage: string) {
  return (_req: Request, res: Response) => res.status(200).json(healthPayload(storage));
}

export function readinessHandler(storage: string) {
  return (_req: Request, res: Response) => {
    const readiness = deploymentReadiness();
    res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? 'ready' : 'not_ready',
      service: 'Quittance API',
      storage,
      ...readiness,
      timestamp: new Date().toISOString(),
    });
  };
}
