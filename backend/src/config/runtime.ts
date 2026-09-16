import type { CorsOptions } from 'cors';

type RuntimeEnvironment = Record<string, string | undefined>;

export interface ReadinessCheck {
  ready: boolean;
  checks: {
    frontendOrigins: boolean;
    simulationDisabled: boolean;
    stellarNetwork: boolean;
    horizonUrl: boolean;
    storageReady: boolean;
    horizonPing?: boolean;
  };
  reasons: string[];
  missing: string[];
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Resolves and normalizes authorized frontend origins from environment configuration.
 *
 * @param env - Runtime environment record.
 * @returns Array of unique origin URLs permitted for CORS.
 */
export function configuredFrontendOrigins(
  env: RuntimeEnvironment = process.env
): string[] {
  const candidates = [env.FRONTEND_URL, ...(env.FRONTEND_URLS || '').split(',')]
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value));

  const origins = candidates
    .map(normalizeOrigin)
    .filter((value): value is string => Boolean(value));

  if (origins.length === 0 && env.NODE_ENV !== 'production') {
    origins.push('http://localhost:3000');
  }

  return [...new Set(origins)];
}

/**
 * Determines whether test payment simulation is allowed in the current runtime environment.
 *
 * @param env - Runtime environment record.
 * @returns Boolean flag indicating whether simulation is permitted.
 */
export function simulationAllowed(env: RuntimeEnvironment = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.ALLOW_SIMULATE === 'true';
}

/**
 * Performs synchronous verification of required environment variables for deployment readiness.
 *
 * @param env - Runtime environment record.
 * @param options - Additional readiness options such as storage identifier.
 * @returns Readiness check summary including status, individual check flags, reasons, and missing variables.
 */
export function deploymentReadiness(
  env: RuntimeEnvironment = process.env,
  options: { storage?: string } = {}
): ReadinessCheck {
  const network = (env.STELLAR_NETWORK || 'TESTNET').toUpperCase();
  const horizonUrl = env.STELLAR_HORIZON_URL ||
    (network === 'TESTNET'
      ? 'https://horizon-testnet.stellar.org'
      : 'https://horizon.stellar.org');
  const isHttps = /^https:\/\//i.test(horizonUrl);
  const isDevOrTestLocal = env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(horizonUrl);
  const checks: ReadinessCheck['checks'] = {
    frontendOrigins: configuredFrontendOrigins(env).length > 0,
    simulationDisabled: env.ALLOW_SIMULATE !== 'true',
    stellarNetwork: network === 'TESTNET' || network === 'PUBLIC',
    horizonUrl: isHttps || isDevOrTestLocal,
    storageReady: true,
  };
  const reasons: string[] = [];
  const missing: string[] = [];

  if (!checks.frontendOrigins) {
    reasons.push('FRONTEND_URL or FRONTEND_URLS is required');
    missing.push('FRONTEND_URL');
  }
  if (!checks.simulationDisabled) {
    reasons.push('ALLOW_SIMULATE must be false in deploy environments');
    missing.push('ALLOW_SIMULATE');
  }
  if (!checks.stellarNetwork) {
    reasons.push('STELLAR_NETWORK must be TESTNET or PUBLIC');
    missing.push('STELLAR_NETWORK');
  }
  if (!checks.horizonUrl) {
    reasons.push('STELLAR_HORIZON_URL must use HTTPS');
    missing.push('STELLAR_HORIZON_URL');
  }

  return { ready: Object.values(checks).every(Boolean), checks, reasons, missing };
}

export interface HorizonPingOptions {
  timeoutMs?: number;
  cacheTtlMs?: number;
}

let cachedHorizonPing: { ok: boolean; timestamp: number; error?: string } | null = null;

/**
 * Pings the Stellar Horizon root endpoint with timeout and response caching.
 *
 * @param horizonUrl - URL of the Horizon server to probe.
 * @param options - Ping options including request timeout and cache duration.
 * @returns Result object containing success flag and error description if unreachable.
 */
export async function pingHorizon(
  horizonUrl: string,
  options: HorizonPingOptions = {}
): Promise<{ ok: boolean; error?: string }> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const cacheTtlMs = options.cacheTtlMs ?? 5000;
  const now = Date.now();

  if (cachedHorizonPing && (now - cachedHorizonPing.timestamp) < cacheTtlMs) {
    return { ok: cachedHorizonPing.ok, error: cachedHorizonPing.error };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(horizonUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const ok = res.status >= 200 && res.status < 400;
    const result = {
      ok,
      timestamp: now,
      error: ok ? undefined : `Horizon returned HTTP ${res.status}`,
    };
    cachedHorizonPing = result;
    return { ok: result.ok, error: result.error };
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError' || err.code === 20;
    const errorMsg = isTimeout
      ? `Horizon ping timed out after ${timeoutMs}ms`
      : `Horizon ping failed: ${err.message || 'connection error'}`;
    const result = { ok: false, timestamp: now, error: errorMsg };
    cachedHorizonPing = result;
    return { ok: false, error: errorMsg };
  }
}

/**
 * Resets the in-memory Horizon ping cache.
 */
export function resetHorizonPingCache(): void {
  cachedHorizonPing = null;
}

export interface DeploymentReadinessOptions {
  storage?: string;
  pingHorizon?: boolean;
  timeoutMs?: number;
}

/**
 * Asynchronously evaluates deployment readiness, optionally probing Horizon network reachability.
 *
 * @param env - Runtime environment record.
 * @param options - Options including storage identifier and Horizon ping configuration.
 * @returns Readiness check result with boolean status and detailed check breakdown.
 */
export async function deploymentReadinessAsync(
  env: RuntimeEnvironment = process.env,
  options: DeploymentReadinessOptions = {}
): Promise<ReadinessCheck> {
  const syncResult = deploymentReadiness(env, { storage: options.storage });
  const checks = { ...syncResult.checks };
  const reasons = [...syncResult.reasons];
  const missing = [...syncResult.missing];

  const network = (env.STELLAR_NETWORK || 'TESTNET').toUpperCase();
  const horizonUrl = env.STELLAR_HORIZON_URL ||
    (network === 'TESTNET'
      ? 'https://horizon-testnet.stellar.org'
      : 'https://horizon.stellar.org');

  const shouldPingHorizon = options.pingHorizon ??
    (env.HEALTH_HORIZON_PING === 'true' || env.CHECK_HORIZON_CONNECTIVITY === 'true');

  if (shouldPingHorizon) {
    const ping = await pingHorizon(horizonUrl, { timeoutMs: options.timeoutMs });
    checks.horizonPing = ping.ok;
    if (!ping.ok) {
      reasons.push(ping.error || 'Horizon ping check failed');
    }
  }

  const allChecksPassed = Object.values(checks).every(Boolean);
  return {
    ready: allChecksPassed,
    checks,
    reasons,
    missing,
  };
}

/**
 * Configures CORS options for HTTP server middleware.
 *
 * @param env - Runtime environment record.
 * @returns Express CORS configuration object.
 */
export function corsOptions(env: RuntimeEnvironment = process.env): CorsOptions {
  return {
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    maxAge: 86400,
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      const normalized = normalizeOrigin(origin);
      if (normalized && configuredFrontendOrigins(env).includes(normalized)) {
        return callback(null, true);
      }

      const error = Object.assign(new Error('Origin is not allowed by Quittance CORS policy'), {
        code: 'CORS_ORIGIN_DENIED',
      });
      return callback(error);
    },
  };
}

/**
 * Checks whether the server is operating in cutover drain mode.
 *
 * @param env - Runtime environment record.
 * @returns Boolean flag indicating whether drain mode is active.
 */
export function cutoverDrainMode(env: RuntimeEnvironment = process.env): boolean {
  return env.CUTOVER_DRAIN_MODE === 'true' || env.DRAIN_MODE === 'true';
}

/**
 * Resolves the configured invoice storage backend mode.
 *
 * @param env - Runtime environment record.
 * @returns Either memory or postgres storage type string.
 */
export function configuredStorageMode(
  env: RuntimeEnvironment = process.env
): 'memory' | 'postgres' {
  if (env.INVOICE_STORAGE === 'memory' || env.INVOICE_STORAGE === 'postgres') {
    return env.INVOICE_STORAGE;
  }
  return env.DATABASE_URL ? 'postgres' : 'memory';
}
