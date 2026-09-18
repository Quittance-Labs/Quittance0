import type { CorsOptions } from 'cors';

type RuntimeEnvironment = Record<string, string | undefined>;

export interface ReadinessCheck {
  ready: boolean;
  checks: {
    frontendOrigins: boolean;
    simulationDisabled: boolean;
    stellarNetwork: boolean;
    horizonUrl: boolean;
  };
  reasons: string[];
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

export function simulationAllowed(env: RuntimeEnvironment = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.ALLOW_SIMULATE === 'true';
}

export function deploymentReadiness(
  env: RuntimeEnvironment = process.env
): ReadinessCheck {
  const network = (env.STELLAR_NETWORK || 'TESTNET').toUpperCase();
  const horizonUrl = env.STELLAR_HORIZON_URL ||
    (network === 'TESTNET'
      ? 'https://horizon-testnet.stellar.org'
      : 'https://horizon.stellar.org');
  const checks = {
    frontendOrigins: configuredFrontendOrigins(env).length > 0,
    simulationDisabled: env.ALLOW_SIMULATE !== 'true',
    stellarNetwork: network === 'TESTNET' || network === 'PUBLIC',
    horizonUrl: /^https:\/\//i.test(horizonUrl),
  };
  const reasons: string[] = [];

  if (!checks.frontendOrigins) reasons.push('FRONTEND_URL or FRONTEND_URLS is required');
  if (!checks.simulationDisabled) reasons.push('ALLOW_SIMULATE must be false in deploy environments');
  if (!checks.stellarNetwork) reasons.push('STELLAR_NETWORK must be TESTNET or PUBLIC');
  if (!checks.horizonUrl) reasons.push('STELLAR_HORIZON_URL must use HTTPS');

  return { ready: Object.values(checks).every(Boolean), checks, reasons };
}

export function corsOptions(env: RuntimeEnvironment = process.env): CorsOptions {
  return {
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    maxAge: 86400,
    origin(origin, callback) {
      // Health checks, curl and server-to-server calls do not carry Origin.
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

export function cutoverDrainMode(env: RuntimeEnvironment = process.env): boolean {
  return env.CUTOVER_DRAIN_MODE === 'true' || env.DRAIN_MODE === 'true';
}

/**
 * Resolves the invoice storage mode from environment configuration.
 *
 * Checks INVOICE_STORAGE and STORAGE_MODE flags first. If neither is set,
 * falls back to postgres when DATABASE_URL is defined, or memory otherwise.
 *
 * @param env - Environment variables map. Defaults to process.env.
 * @returns The resolved storage mode identifier ('memory' | 'postgres').
 */
export function configuredStorageMode(
  env: RuntimeEnvironment = process.env
): 'memory' | 'postgres' {
  const mode = env.INVOICE_STORAGE || env.STORAGE_MODE;
  if (mode === 'memory' || mode === 'postgres') {
    return mode;
  }
  return env.DATABASE_URL ? 'postgres' : 'memory';
}
