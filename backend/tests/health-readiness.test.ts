import assert from 'node:assert/strict';
import { describe, it, before, after, beforeEach } from 'node:test';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { healthHandler, readinessHandler, healthPayload } from '../src/health.ts';
import {
  deploymentReadiness,
  deploymentReadinessAsync,
  pingHorizon,
  resetHorizonPingCache,
} from '../src/config/runtime.ts';

describe('Liveness and Readiness Probes (#437)', () => {
  describe('healthHandler & liveness contract', () => {
    it('returns 200 OK with stable metadata without touching external dependencies', () => {
      const payload = healthPayload('in-memory');
      assert.equal(payload.status, 'ok');
      assert.equal(payload.service, 'Quittance API');
      assert.equal(payload.version, '1.0.0');
      assert.equal(payload.storage, 'in-memory');
      assert.ok(payload.timestamp);
    });

    it('answers liveness even when production configuration is completely missing', async () => {
      const app = express();
      app.get('/api/health', healthHandler('in-memory'));
      app.get('/health', healthHandler('in-memory'));
      app.get('/healthz', healthHandler('in-memory'));
      app.get('/api/health/live', healthHandler('in-memory'));

      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const port = (server.address() as AddressInfo).port;

      try {
        const endpoints = ['/api/health', '/health', '/healthz', '/api/health/live'];
        for (const ep of endpoints) {
          const res = await fetch(`http://127.0.0.1:${port}${ep}`);
          assert.equal(res.status, 200, `Expected 200 on ${ep}`);
          const body = (await res.json()) as any;
          assert.equal(body.status, 'ok');
          assert.equal(body.storage, 'in-memory');
        }
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('deploymentReadiness (sync config check)', () => {
    const validProductionEnv = {
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://quittance.example.com',
      STELLAR_NETWORK: 'TESTNET',
      STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
      ALLOW_SIMULATE: 'false',
    };

    it('passes all checks with valid production environment', () => {
      const result = deploymentReadiness(validProductionEnv);
      assert.equal(result.ready, true);
      assert.equal(result.checks.frontendOrigins, true);
      assert.equal(result.checks.simulationDisabled, true);
      assert.equal(result.checks.stellarNetwork, true);
      assert.equal(result.checks.horizonUrl, true);
      assert.equal(result.checks.storageReady, true);
      assert.equal(result.reasons.length, 0);
      assert.equal(result.missing.length, 0);
    });

    it('fails fast when FRONTEND_URL is missing in production', () => {
      const result = deploymentReadiness({
        ...validProductionEnv,
        FRONTEND_URL: '',
        FRONTEND_URLS: '',
      });
      assert.equal(result.ready, false);
      assert.equal(result.checks.frontendOrigins, false);
      assert.ok(result.missing.includes('FRONTEND_URL'));
      assert.ok(result.reasons.some((r) => r.includes('FRONTEND_URL')));
    });

    it('fails fast when STELLAR_NETWORK is invalid', () => {
      const result = deploymentReadiness({
        ...validProductionEnv,
        STELLAR_NETWORK: 'MAINNET', // Invalid: only TESTNET or PUBLIC are supported
      });
      assert.equal(result.ready, false);
      assert.equal(result.checks.stellarNetwork, false);
      assert.ok(result.missing.includes('STELLAR_NETWORK'));
    });

    it('fails fast when STELLAR_HORIZON_URL does not use HTTPS in production', () => {
      const result = deploymentReadiness({
        ...validProductionEnv,
        STELLAR_HORIZON_URL: 'http://horizon-insecure.stellar.org',
      });
      assert.equal(result.ready, false);
      assert.equal(result.checks.horizonUrl, false);
      assert.ok(result.missing.includes('STELLAR_HORIZON_URL'));
    });

    it('fails fast when ALLOW_SIMULATE is true in production', () => {
      const result = deploymentReadiness({
        ...validProductionEnv,
        ALLOW_SIMULATE: 'true',
      });
      assert.equal(result.ready, false);
      assert.equal(result.checks.simulationDisabled, false);
      assert.ok(result.missing.includes('ALLOW_SIMULATE'));
    });

    it('in-memory MVP is ready without requiring Postgres', () => {
      const result = deploymentReadiness(validProductionEnv, { storage: 'in-memory' });
      assert.equal(result.checks.storageReady, true);
      assert.equal(result.ready, true);
    });
  });

  describe('readinessHandler & HTTP 503 fast failure', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
      resetHorizonPingCache();
    });

    after(() => {
      process.env = originalEnv;
      resetHorizonPingCache();
    });

    it('returns HTTP 503 with structured JSON error when configuration is invalid', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.FRONTEND_URL;
      delete process.env.FRONTEND_URLS;
      process.env.STELLAR_NETWORK = 'TESTNET';
      process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
      process.env.ALLOW_SIMULATE = 'false';

      const app = express();
      app.get('/api/ready', readinessHandler('in-memory'));

      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const port = (server.address() as AddressInfo).port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/ready`);
        assert.equal(res.status, 503);
        const body = (await res.json()) as any;
        assert.equal(body.status, 'not_ready');
        assert.equal(body.ready, false);
        assert.equal(body.storage, 'in-memory');
        assert.equal(body.checks.frontendOrigins, false);
        assert.ok(body.missing.includes('FRONTEND_URL'));
        assert.ok(body.reasons.length > 0);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('returns HTTP 200 across all readiness aliases when configuration is valid', async () => {
      process.env.NODE_ENV = 'production';
      process.env.FRONTEND_URL = 'https://quittance.example.com';
      process.env.STELLAR_NETWORK = 'TESTNET';
      process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
      process.env.ALLOW_SIMULATE = 'false';

      const app = express();
      app.get('/api/ready', readinessHandler('in-memory'));
      app.get('/ready', readinessHandler('in-memory'));
      app.get('/readyz', readinessHandler('in-memory'));
      app.get('/api/health/ready', readinessHandler('in-memory'));

      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const port = (server.address() as AddressInfo).port;

      try {
        const endpoints = ['/api/ready', '/ready', '/readyz', '/api/health/ready'];
        for (const ep of endpoints) {
          const res = await fetch(`http://127.0.0.1:${port}${ep}`);
          assert.equal(res.status, 200, `Expected 200 on ${ep}`);
          const body = (await res.json()) as any;
          assert.equal(body.status, 'ready');
          assert.equal(body.ready, true);
          assert.equal(body.storage, 'in-memory');
          assert.equal(body.checks.storageReady, true);
        }
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('Optional Horizon Ping probe (HEALTH_HORIZON_PING)', () => {
    let mockHorizonServer: Server;
    let mockHorizonPort: number;
    let horizonCallCount = 0;
    let horizonShouldFail = false;

    before(async () => {
      mockHorizonServer = http.createServer((_req, res) => {
        horizonCallCount++;
        if (horizonShouldFail) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Horizon Error' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ horizon_version: '2.30.0', core_version: '20.0.0' }));
        }
      });

      mockHorizonServer.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => mockHorizonServer.once('listening', resolve));
      mockHorizonPort = (mockHorizonServer.address() as AddressInfo).port;
    });

    after(async () => {
      await new Promise<void>((resolve) => mockHorizonServer.close(() => resolve()));
    });

    beforeEach(() => {
      horizonCallCount = 0;
      horizonShouldFail = false;
      resetHorizonPingCache();
    });

    it('does not ping Horizon when HEALTH_HORIZON_PING is off (default)', async () => {
      const result = await deploymentReadinessAsync({
        NODE_ENV: 'test',
        FRONTEND_URL: 'http://localhost:3000',
        STELLAR_NETWORK: 'TESTNET',
        STELLAR_HORIZON_URL: `http://127.0.0.1:${mockHorizonPort}`,
        ALLOW_SIMULATE: 'false',
        HEALTH_HORIZON_PING: 'false',
      });

      assert.equal(result.ready, true);
      assert.equal(result.checks.horizonPing, undefined);
      assert.equal(horizonCallCount, 0, 'Should not have called Horizon');
    });

    it('pings Horizon and passes readiness when HEALTH_HORIZON_PING is enabled and Horizon responds', async () => {
      const result = await deploymentReadinessAsync({
        NODE_ENV: 'test',
        FRONTEND_URL: 'http://localhost:3000',
        STELLAR_NETWORK: 'TESTNET',
        STELLAR_HORIZON_URL: `http://127.0.0.1:${mockHorizonPort}`,
        ALLOW_SIMULATE: 'false',
        HEALTH_HORIZON_PING: 'true',
      });

      assert.equal(result.ready, true);
      assert.equal(result.checks.horizonPing, true);
      assert.equal(horizonCallCount, 1, 'Should have called Horizon once');
    });

    it('fails fast with 503 when HEALTH_HORIZON_PING is enabled and Horizon is unreachable', async () => {
      horizonShouldFail = true;

      const result = await deploymentReadinessAsync({
        NODE_ENV: 'test',
        FRONTEND_URL: 'http://localhost:3000',
        STELLAR_NETWORK: 'TESTNET',
        STELLAR_HORIZON_URL: `http://127.0.0.1:${mockHorizonPort}`,
        ALLOW_SIMULATE: 'false',
        HEALTH_HORIZON_PING: 'true',
      });

      assert.equal(result.ready, false);
      assert.equal(result.checks.horizonPing, false);
      assert.ok(result.reasons.some((r) => r.includes('Horizon')));
    });

    it('caches Horizon ping response to prevent rate-limiting on repeated probes', async () => {
      const horizonUrl = `http://127.0.0.1:${mockHorizonPort}`;

      const first = await pingHorizon(horizonUrl, { cacheTtlMs: 5000 });
      assert.equal(first.ok, true);
      assert.equal(horizonCallCount, 1);

      const second = await pingHorizon(horizonUrl, { cacheTtlMs: 5000 });
      assert.equal(second.ok, true);
      assert.equal(horizonCallCount, 1, 'Should have returned cached result');

      resetHorizonPingCache();
      const third = await pingHorizon(horizonUrl, { cacheTtlMs: 5000 });
      assert.equal(third.ok, true);
      assert.equal(horizonCallCount, 2, 'Should have made a new call after cache reset');
    });

    it('supports on-demand ping through /api/ready?ping=true', async () => {
      const app = express();
      process.env.NODE_ENV = 'test';
      process.env.FRONTEND_URL = 'http://localhost:3000';
      process.env.STELLAR_NETWORK = 'TESTNET';
      process.env.STELLAR_HORIZON_URL = `http://127.0.0.1:${mockHorizonPort}`;
      process.env.ALLOW_SIMULATE = 'false';
      delete process.env.HEALTH_HORIZON_PING;

      app.get('/api/ready', readinessHandler('in-memory'));

      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const port = (server.address() as AddressInfo).port;

      try {
        const normalRes = await fetch(`http://127.0.0.1:${port}/api/ready`);
        assert.equal(normalRes.status, 200);
        assert.equal(horizonCallCount, 0);

        const pingRes = await fetch(`http://127.0.0.1:${port}/api/ready?ping=true`);
        assert.equal(pingRes.status, 200);
        const body = (await pingRes.json()) as any;
        assert.equal(body.checks.horizonPing, true);
        assert.equal(horizonCallCount, 1);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});
