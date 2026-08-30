import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  configuredFrontendOrigins,
  corsOptions,
  deploymentReadiness,
  simulationAllowed,
} from '../src/config/runtime.ts';

describe('production runtime config', () => {
  const production = {
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://quittance.vercel.app/',
    FRONTEND_URLS: 'https://preview.example.com, https://quittance.vercel.app',
    STELLAR_NETWORK: 'TESTNET',
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    ALLOW_SIMULATE: 'false',
  };

  it('normalizes and deduplicates configured frontend origins', () => {
    assert.deepEqual(configuredFrontendOrigins(production), [
      'https://quittance.vercel.app',
      'https://preview.example.com',
    ]);
  });

  it('allows configured browser origins and rejects unknown ones', async () => {
    const origin = corsOptions(production).origin as Function;
    await new Promise<void>((resolve, reject) => origin(
      'https://preview.example.com',
      (error: Error | null, allowed: boolean) => error ? reject(error) : (assert.equal(allowed, true), resolve())
    ));
    await assert.rejects(() => new Promise<void>((resolve, reject) => origin(
      'https://evil.example',
      (error: Error | null) => error ? reject(error) : resolve()
    )), /not allowed/i);
  });

  it('forces simulation off in production even when the variable says true', () => {
    assert.equal(simulationAllowed({ NODE_ENV: 'production', ALLOW_SIMULATE: 'true' }), false);
    assert.equal(simulationAllowed({ NODE_ENV: 'development', ALLOW_SIMULATE: 'true' }), true);
  });

  it('reports explicit readiness failures for unsafe deploy config', () => {
    assert.equal(deploymentReadiness(production).ready, true);
    const unsafe = deploymentReadiness({ NODE_ENV: 'production', STELLAR_NETWORK: 'BAD' });
    assert.equal(unsafe.ready, false);
    assert.ok(unsafe.reasons.length >= 2);
  });
});
