import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import http, { createServer, type Server } from 'node:http';
import {
  deploymentReadiness,
  deploymentReadinessAsync,
  pingHorizon,
  resetHorizonPingCache,
} from '../src/config/runtime.ts';

describe('health and readiness unit checks', () => {
  const baseValidProduction = {
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://quittance.example',
    STELLAR_NETWORK: 'TESTNET',
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    ALLOW_SIMULATE: 'false',
  };

  it('validates production configuration successfully', () => {
    const result = deploymentReadiness(baseValidProduction);
    assert.equal(result.ready, true);
    assert.equal(result.checks.storageReady, true);
    assert.equal(result.reasons.length, 0);
    assert.equal(result.missing.length, 0);
  });

  it('fails fast when FRONTEND_URL is missing in production', () => {
    const config = { ...baseValidProduction };
    delete (config as any).FRONTEND_URL;
    const result = deploymentReadiness(config);
    assert.equal(result.ready, false);
    assert.equal(result.checks.frontendOrigins, false);
    assert.ok(result.reasons.some(r => r.includes('FRONTEND_URL')));
    assert.ok(result.missing.includes('FRONTEND_URL'));
  });

  it('fails fast when STELLAR_NETWORK is invalid', () => {
    const result = deploymentReadiness({
      ...baseValidProduction,
      STELLAR_NETWORK: 'INVALID_NET',
    });
    assert.equal(result.ready, false);
    assert.equal(result.checks.stellarNetwork, false);
    assert.ok(result.missing.includes('STELLAR_NETWORK'));
  });

  it('fails fast when ALLOW_SIMULATE is true in deploy environment', () => {
    const result = deploymentReadiness({
      ...baseValidProduction,
      ALLOW_SIMULATE: 'true',
    });
    assert.equal(result.ready, false);
    assert.equal(result.checks.simulationDisabled, false);
    assert.ok(result.missing.includes('ALLOW_SIMULATE'));
  });

  it('fails fast when STELLAR_HORIZON_URL does not use HTTPS in production', () => {
    const result = deploymentReadiness({
      ...baseValidProduction,
      STELLAR_HORIZON_URL: 'http://horizon-testnet.stellar.org',
    });
    assert.equal(result.ready, false);
    assert.equal(result.checks.horizonUrl, false);
    assert.ok(result.missing.includes('STELLAR_HORIZON_URL'));
  });

  it('allows http localhost horizon URL in non-production environments', () => {
    const result = deploymentReadiness({
      NODE_ENV: 'development',
      STELLAR_NETWORK: 'TESTNET',
      STELLAR_HORIZON_URL: 'http://localhost:8000',
      ALLOW_SIMULATE: 'false',
    });
    assert.equal(result.checks.horizonUrl, true);
  });
});

describe('horizon ping reachability and caching', () => {
  let mockHorizonServer: Server;
  let mockHorizonUrl: string;
  let requestCount = 0;
  let respondWithStatus = 200;

  before(async () => {
    mockHorizonServer = createServer((req, res) => {
      requestCount += 1;
      res.writeHead(respondWithStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ horizon_version: '2.30.0' }));
    });
    mockHorizonServer.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => mockHorizonServer.once('listening', resolve));
    const port = (mockHorizonServer.address() as AddressInfo).port;
    mockHorizonUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => mockHorizonServer.close(() => resolve()));
  });

  it('returns ok when horizon responds with 200', async () => {
    resetHorizonPingCache();
    requestCount = 0;
    respondWithStatus = 200;

    const result = await pingHorizon(mockHorizonUrl, { timeoutMs: 1000 });
    assert.equal(result.ok, true);
    assert.equal(result.error, undefined);
    assert.equal(requestCount, 1);
  });

  it('reuses cached ping result within TTL without repeated network requests', async () => {
    const cachedResult = await pingHorizon(mockHorizonUrl, { cacheTtlMs: 5000 });
    assert.equal(cachedResult.ok, true);
    assert.equal(requestCount, 1);
  });

  it('returns error when horizon responds with server error', async () => {
    resetHorizonPingCache();
    respondWithStatus = 503;

    const result = await pingHorizon(mockHorizonUrl, { timeoutMs: 1000 });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes('HTTP 503'));
  });

  it('handles unreachable host gracefully with connection error', async () => {
    resetHorizonPingCache();
    const badUrl = 'http://127.0.0.1:1';
    const result = await pingHorizon(badUrl, { timeoutMs: 500 });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes('failed') || result.error?.includes('timed out'));
  });

  it('integrates with deploymentReadinessAsync when ping is enabled', async () => {
    resetHorizonPingCache();
    respondWithStatus = 200;

    const env = {
      NODE_ENV: 'development',
      STELLAR_NETWORK: 'TESTNET',
      STELLAR_HORIZON_URL: mockHorizonUrl,
      ALLOW_SIMULATE: 'false',
    };

    const readyWithPing = await deploymentReadinessAsync(env, { pingHorizon: true });
    assert.equal(readyWithPing.ready, true);
    assert.equal(readyWithPing.checks.horizonPing, true);

    resetHorizonPingCache();
    respondWithStatus = 500;
    const readyWithFailingPing = await deploymentReadinessAsync(env, { pingHorizon: true });
    assert.equal(readyWithFailingPing.ready, false);
    assert.equal(readyWithFailingPing.checks.horizonPing, false);
    assert.ok(readyWithFailingPing.reasons.some(r => r.includes('HTTP 500')));
  });
});

describe('HTTP probe integration and route aliases', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://quittance.example';
    process.env.ALLOW_SIMULATE = 'false';
    process.env.STELLAR_NETWORK = 'TESTNET';
    process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
    process.env.HEALTH_HORIZON_PING = 'false';

    const { default: app } = await import('../src/server-mvp.ts');
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves liveness across all standard aliases without external dependencies', async () => {
    const paths = ['/api/health', '/api/health/live', '/health', '/healthz'];
    for (const path of paths) {
      const res = await fetch(`${baseUrl}${path}`);
      assert.equal(res.status, 200, `Expected 200 from ${path}`);
      const body = await res.json() as any;
      assert.equal(body.status, 'ok');
      assert.equal(body.service, 'Quittance API');
      assert.equal(body.storage, 'in-memory');
      assert.ok(body.timestamp);
    }
  });

  it('serves readiness across all standard aliases', async () => {
    const paths = ['/api/ready', '/api/health/ready', '/ready', '/readyz'];
    for (const path of paths) {
      const res = await fetch(`${baseUrl}${path}`);
      assert.equal(res.status, 200, `Expected 200 from ${path}`);
      const body = await res.json() as any;
      assert.equal(body.status, 'ready');
      assert.equal(body.ready, true);
      assert.equal(body.checks.storageReady, true);
      assert.equal(body.checks.frontendOrigins, true);
      assert.equal(body.checks.simulationDisabled, true);
      assert.equal(body.checks.stellarNetwork, true);
      assert.equal(body.checks.horizonUrl, true);
    }
  });

  it('supports dynamic horizon ping via ?ping=true query param', async () => {
    const res = await fetch(`${baseUrl}/api/ready?ping=true`);
    assert.equal(typeof res.status, 'number');
    const body = await res.json() as any;
    assert.equal(typeof body.checks.horizonPing, 'boolean');
  });

  it('responds with 503 on readiness endpoint when configuration is invalid', async () => {
    const originalFrontendUrl = process.env.FRONTEND_URL;
    delete process.env.FRONTEND_URL;
    try {
      const res = await fetch(`${baseUrl}/api/ready`);
      assert.equal(res.status, 503);
      const body = await res.json() as any;
      assert.equal(body.status, 'not_ready');
      assert.equal(body.ready, false);
      assert.ok(body.missing.includes('FRONTEND_URL'));
      assert.ok(body.reasons.some((r: string) => r.includes('FRONTEND_URL')));
    } finally {
      process.env.FRONTEND_URL = originalFrontendUrl;
    }
  });
});
