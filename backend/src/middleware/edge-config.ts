/**
 * Public API edge controls — configuration and middleware order (issue #450).
 *
 * Every limit is driven from env with the safe demo defaults documented in
 * docs/ABUSE-CONTROLS.md. A missing or non-numeric value falls back to the
 * default; nothing here invents a second limiter stack.
 *
 * Middleware order (documented so a reordering cannot silently swap a 429 for
 * a 413 or a 503):
 *
 *   App level (both server.ts and server-mvp.ts):
 *     1. express.json / urlencoded with MAX_BODY_STRING
 *        → 413 PAYLOAD_TOO_LARGE via the body-limit error handler
 *
 *   POST /invoices:
 *     2. invoice ceiling          → 503 INVOICE_STORE_FULL
 *     3. create short rate limit  → 429 RATE_LIMIT_EXCEEDED (5 / min / IP)
 *     4. create long rate limit   → 429 RATE_LIMIT_EXCEEDED (10 / 10 min / IP)
 *     5. handler
 *
 *   GET /invoices:
 *     2. list rate limit          → 429 RATE_LIMIT_EXCEEDED (60 / min / IP)
 *     3. handler
 *
 *   POST /invoices/:id/cancel:
 *     2. auth pre-check           → 401 UNAUTHORIZED (before volume)
 *     3. cancel rate limit        → 429 RATE_LIMIT_EXCEEDED (10 / min / IP)
 *     4. handler
 *
 *   POST /invoices/:id/verify:
 *     2. concurrency lock         → 429 VERIFY_IN_PROGRESS
 *     3. verify IP rate limit     → 429 RATE_LIMIT_EXCEEDED (30 / min / IP)
 *     4. verify invoice rate      → 429 RATE_LIMIT_EXCEEDED (10 / min / invoice)
 *     5. verify replay cache      → cached status + body (no Horizon)
 *     6. handler (own per-invoice budget → 429 VERIFY_RATE_LIMIT_EXCEEDED)
 *
 * The limiter store is per-process memory (with optional Redis for the verify
 * cache only). A shared multi-instance store is a separate decision.
 */

export interface EdgeControlConfig {
  /** Hard JSON / urlencoded body cap in bytes. */
  maxBodyBytes: number;
  /** Express `limit` string matching maxBodyBytes (e.g. "16kb"). */
  maxBodyString: string;

  /** Global in-memory invoice ceiling. */
  invoiceCeiling: number;
  /** Retry-After seconds when the ceiling is hit. */
  invoiceCeilingRetryAfterSeconds: number;

  /** Shared short window used by per-minute limiters. */
  rateLimitWindowMs: number;
  /** Create: max invoices per short window per IP. */
  createPerMinute: number;
  /** Create: long window length (ms). */
  createLongWindowMs: number;
  /** Create: max invoices per long window per IP. */
  createPerLongWindow: number;
  /** Verify: max requests per window per IP. */
  verifyPerIp: number;
  /** Verify: max requests per window per invoice (router + handler budgets). */
  verifyPerInvoice: number;
  /** List: max requests per window per IP. */
  listPerMinute: number;
  /** Cancel: max requests per window per IP. */
  cancelPerMinute: number;
  /** Concurrency lock Retry-After when VERIFY_IN_PROGRESS. */
  verifyConcurrencyRetryAfterSeconds: number;
}

const DEFAULTS: EdgeControlConfig = {
  maxBodyBytes: 16 * 1024,
  maxBodyString: '16kb',
  invoiceCeiling: 5000,
  invoiceCeilingRetryAfterSeconds: 300,
  rateLimitWindowMs: 60_000,
  createPerMinute: 5,
  createLongWindowMs: 600_000,
  createPerLongWindow: 10,
  verifyPerIp: 30,
  verifyPerInvoice: 10,
  listPerMinute: 60,
  cancelPerMinute: 10,
  verifyConcurrencyRetryAfterSeconds: 5,
};

function readPositiveInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number
): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * Resolve edge-control configuration from env (or an injected map for tests).
 * Safe demo defaults match docs/ABUSE-CONTROLS.md.
 */
export function resolveEdgeControlConfig(
  env: NodeJS.ProcessEnv = process.env
): EdgeControlConfig {
  const maxBodyBytes = readPositiveInt(env, 'MAX_BODY_BYTES', DEFAULTS.maxBodyBytes);
  // Prefer an explicit MAX_BODY_STRING; otherwise derive a kb string Express accepts.
  const maxBodyString =
    (env.MAX_BODY_STRING && env.MAX_BODY_STRING.trim()) ||
    `${Math.max(1, Math.ceil(maxBodyBytes / 1024))}kb`;

  return {
    maxBodyBytes,
    maxBodyString,
    invoiceCeiling: readPositiveInt(env, 'INVOICE_CEILING', DEFAULTS.invoiceCeiling),
    invoiceCeilingRetryAfterSeconds: readPositiveInt(
      env,
      'INVOICE_CEILING_RETRY_AFTER_SECONDS',
      DEFAULTS.invoiceCeilingRetryAfterSeconds
    ),
    rateLimitWindowMs: readPositiveInt(
      env,
      'RATE_LIMIT_WINDOW_MS',
      DEFAULTS.rateLimitWindowMs
    ),
    createPerMinute: readPositiveInt(
      env,
      'RATE_LIMIT_CREATE_PER_MIN',
      DEFAULTS.createPerMinute
    ),
    createLongWindowMs: readPositiveInt(
      env,
      'RATE_LIMIT_CREATE_LONG_WINDOW_MS',
      DEFAULTS.createLongWindowMs
    ),
    createPerLongWindow: readPositiveInt(
      env,
      'RATE_LIMIT_CREATE_PER_10MIN',
      DEFAULTS.createPerLongWindow
    ),
    verifyPerIp: readPositiveInt(env, 'RATE_LIMIT_VERIFY_PER_IP', DEFAULTS.verifyPerIp),
    verifyPerInvoice: readPositiveInt(
      env,
      'RATE_LIMIT_VERIFY_PER_INVOICE',
      DEFAULTS.verifyPerInvoice
    ),
    listPerMinute: readPositiveInt(
      env,
      'RATE_LIMIT_LIST_PER_MIN',
      DEFAULTS.listPerMinute
    ),
    cancelPerMinute: readPositiveInt(
      env,
      'RATE_LIMIT_CANCEL_PER_MIN',
      DEFAULTS.cancelPerMinute
    ),
    verifyConcurrencyRetryAfterSeconds: readPositiveInt(
      env,
      'VERIFY_CONCURRENCY_RETRY_AFTER_SECONDS',
      DEFAULTS.verifyConcurrencyRetryAfterSeconds
    ),
  };
}

/**
 * Live config from the current process env. Call at middleware-factory / request
 * time (not at import) so dotenv bootstrap and tests can override values.
 */
export function getEdgeControlConfig(
  env: NodeJS.ProcessEnv = process.env
): EdgeControlConfig {
  return resolveEdgeControlConfig(env);
}

export const EDGE_CONTROL_DEFAULTS: Readonly<EdgeControlConfig> = Object.freeze({
  ...DEFAULTS,
});

/**
 * Env variable names that configure the public API edge. Listed so env examples
 * and docs stay in sync with resolveEdgeControlConfig.
 */
export const EDGE_CONTROL_ENV_VARS = [
  'ENABLE_RATE_LIMITING',
  'ENABLE_VERIFY_CONCURRENCY_LOCK',
  'ENABLE_INVOICE_CEILING',
  'DISABLE_VERIFY_CACHE',
  'MAX_BODY_BYTES',
  'MAX_BODY_STRING',
  'INVOICE_CEILING',
  'INVOICE_CEILING_RETRY_AFTER_SECONDS',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_CREATE_PER_MIN',
  'RATE_LIMIT_CREATE_LONG_WINDOW_MS',
  'RATE_LIMIT_CREATE_PER_10MIN',
  'RATE_LIMIT_VERIFY_PER_IP',
  'RATE_LIMIT_VERIFY_PER_INVOICE',
  'RATE_LIMIT_LIST_PER_MIN',
  'RATE_LIMIT_CANCEL_PER_MIN',
  'VERIFY_CONCURRENCY_RETRY_AFTER_SECONDS',
] as const;
