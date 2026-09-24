// Shared Horizon client wrapper (issue #513).
//
// Verify, the payment monitor, account lookups and submit all reach Horizon
// through this module, so a single concurrency budget, timeout and retry
// policy applies to every call instead of each call site improvising its own.
//
// Policy:
// - at most MAX_CONCURRENT calls in flight; the rest queue
// - each attempt is bounded by a timeout — a hung Horizon call is a failure,
//   not a stalled poll loop or a hung request
// - 429 and 5xx are retried, honoring Retry-After when Horizon sends one and
//   backing off exponentially otherwise; 4xx failures are not retried
// - when the budget is exhausted the caller gets HorizonUnavailableError, a
//   distinct outage signal — never something that could be read as a
//   transaction-level rejection (missing tx, memo mismatch, ...)

/** Maximum Horizon calls in flight at once, shared by verify and monitor. */
export const HORIZON_MAX_CONCURRENT = 4;

/** Per-attempt timeout. Public Horizon p99 is a few hundred ms; 10s is generous. */
export const HORIZON_TIMEOUT_MS = 10_000;

/** Maximum attempts per call including the first. */
export const HORIZON_MAX_ATTEMPTS = 3;

/** Backoff floor/ceiling when no Retry-After is provided. */
const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 5_000;

/**
 * The failure a caller should treat as "Horizon is unreachable right now" —
 * rate limited, server error, timeout or transport failure after every
 * attempt. Distinct from a real 404, which propagates unwrapped.
 */
export class HorizonUnavailableError extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'HorizonUnavailableError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** The per-attempt deadline fired. */
class HorizonTimeout extends Error {
  constructor(timeoutMs: number) {
    super(`Horizon call timed out after ${timeoutMs}ms`);
    this.name = 'HorizonTimeout';
  }
}

/** HTTP status carried by a thrown error, across SDK and fetch shapes. */
export function horizonErrorStatus(error: unknown): number | undefined {
  const err = error as any;
  return (
    err?.response?.status ??
    err?.status ??
    (typeof err?.getResponse === 'function' ? err.getResponse()?.status : undefined)
  );
}

const NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ERR_NETWORK',
  'EAI_AGAIN',
]);

/**
 * Named Horizon failure classes (issue #556). Verify and the monitor call this
 * before comparing memo, destination, or amount so a timeout or 429 never
 * becomes MEMO_MISMATCH / AMOUNT_MISMATCH / DESTINATION_MISMATCH.
 */
export type HorizonFailureClass =
  | 'timeout'
  | 'rate_limited'
  | 'server_error'
  | 'connection';

/**
 * Classify a thrown error into one Horizon outage class, or null when the
 * failure is not an outage (404, ordinary bugs, semantic verification rejects).
 */
export function classifyHorizonFailure(error: unknown): HorizonFailureClass | null {
  if (error instanceof HorizonTimeout) return 'timeout';
  if (error instanceof HorizonUnavailableError) {
    if (error.status === 429) return 'rate_limited';
    if (error.status !== undefined && error.status >= 500) return 'server_error';
    return error.status === undefined ? 'connection' : 'server_error';
  }

  const status = horizonErrorStatus(error);
  if (status === 429) return 'rate_limited';
  if (status !== undefined && status >= 500) return 'server_error';
  if (status !== undefined) return null;

  const err = error as any;
  if (!(error instanceof Error)) return null;
  if (err?.name === 'HorizonTimeout' || err?.code === 'ETIMEDOUT' || err?.code === 'ECONNABORTED') {
    return 'timeout';
  }
  if (NETWORK_ERROR_CODES.has(err?.code)) return 'connection';
  if (err?.request !== undefined && err?.response === undefined) return 'connection';
  if (error instanceof TypeError) return 'connection';
  return null;
}

/** Whether a thrown error came from an overloaded or unreachable Horizon. */
export function isHorizonUnavailable(error: unknown): boolean {
  return classifyHorizonFailure(error) !== null;
}

/**
 * Parse a Retry-After header value (integer seconds or HTTP-date) into ms.
 * Returns undefined when the header is absent or unparsable.
 */
export function parseRetryAfterMs(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

/** Retry-After carried by a thrown error, if the server sent one. */
function retryAfterOf(error: unknown): number | undefined {
  const err = error as any;
  const headers = err?.response?.headers ?? err?.headers;
  if (!headers) return undefined;
  const value =
    typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after'];
  return parseRetryAfterMs(value);
}

function backoffMs(attempt: number): number {
  const jitter = Math.floor(Math.random() * BASE_BACKOFF_MS);
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt + jitter);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// --- Concurrency budget -------------------------------------------------

let inFlight = 0;
const queue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < HORIZON_MAX_CONCURRENT) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight -= 1;
  const next = queue.shift();
  if (next) next();
}

export interface HorizonCallOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  /** Label for error messages, e.g. 'transactions().transaction'. */
  label?: string;
  /** Injected for tests. */
  sleepFn?: (ms: number) => Promise<void>;
  randomFn?: () => number;
}

/**
 * Run `fn` (one Horizon request) inside the shared budget: concurrency cap,
 * per-attempt timeout, bounded retries on 429/5xx/transport failures.
 *
 * @throws HorizonUnavailableError when every attempt fails with an
 *         outage-class error; the original error otherwise.
 */
export async function horizonCall<T>(
  fn: () => Promise<T>,
  options: HorizonCallOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? HORIZON_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? HORIZON_MAX_ATTEMPTS;
  const sleepFn = options.sleepFn ?? sleep;
  const label = options.label ?? 'Horizon call';

  await acquireSlot();
  try {
    let lastError: unknown;
    let lastRetryAfter: number | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          fn(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new HorizonTimeout(timeoutMs)), timeoutMs);
          }),
        ]);
      } catch (error) {
        lastError = error;
        if (!isHorizonUnavailable(error)) {
          throw error;
        }
        lastRetryAfter = retryAfterOf(error) ?? lastRetryAfter;
        if (attempt < maxAttempts - 1) {
          await sleepFn(lastRetryAfter ?? backoffMs(attempt));
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    const status = horizonErrorStatus(lastError);
    throw new HorizonUnavailableError(
      `${label} failed after ${maxAttempts} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
      status,
      lastRetryAfter,
    );
  } finally {
    releaseSlot();
  }
}
