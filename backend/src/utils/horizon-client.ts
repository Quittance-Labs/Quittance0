/**
 * Shared Horizon client wrapper for concurrency limiting, timeouts, and 429/5xx retries.
 * Verify, payment monitor, account lookups, and transaction submissions route through
 * this module to enforce a single concurrency budget and backoff policy.
 */

export const HORIZON_MAX_CONCURRENT = 4;
export const HORIZON_TIMEOUT_MS = 10_000;
export const HORIZON_MAX_ATTEMPTS = 3;

const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 5_000;

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
 * Error thrown when Horizon is unreachable or overloaded after exhausting all attempt retries.
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

/**
 * Error thrown when an individual Horizon attempt times out.
 */
class HorizonTimeout extends Error {
  constructor(timeoutMs: number) {
    super(`Horizon call timed out after ${timeoutMs}ms`);
    this.name = 'HorizonTimeout';
  }
}

/**
 * Extracts HTTP status code from Horizon SDK or fetch error shapes.
 *
 * @param error - Caught error object or unknown thrown value.
 * @returns Status code if present, undefined otherwise.
 */
export function horizonErrorStatus(error: unknown): number | undefined {
  const err = error as any;
  return (
    err?.response?.status ??
    err?.status ??
    (typeof err?.getResponse === 'function' ? err.getResponse()?.status : undefined)
  );
}

/**
 * Determines whether an error indicates a transient Horizon outage (429, 5xx, timeout, or network disconnect).
 *
 * @param error - Caught error object or unknown thrown value.
 * @returns True if error represents an outage; false if application or non-retryable client error.
 */
export function isHorizonUnavailable(error: unknown): boolean {
  if (error instanceof HorizonUnavailableError) return true;
  if (error instanceof HorizonTimeout) return true;
  const status = horizonErrorStatus(error);
  if (status !== undefined) {
    return status === 429 || status >= 500;
  }
  const err = error as any;
  if (!(error instanceof Error)) return false;
  if (NETWORK_ERROR_CODES.has(err?.code)) return true;
  if (err?.request !== undefined && err?.response === undefined) return true;
  return error instanceof TypeError;
}

/**
 * Parses a Retry-After header string into milliseconds.
 * Supports integer delta-seconds and RFC HTTP-date strings.
 *
 * @param value - Raw header value.
 * @param now - Reference timestamp in milliseconds (defaults to Date.now()).
 * @returns Milliseconds delay to wait, or undefined if invalid or omitted.
 */
export function parseRetryAfterMs(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

function retryAfterOf(error: unknown): number | undefined {
  const err = error as any;
  const headers = err?.response?.headers ?? err?.headers;
  if (!headers) return undefined;
  const value =
    typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after'];
  return parseRetryAfterMs(value);
}

function calculateBackoffMs(attempt: number, randomFn?: () => number): number {
  const rand = randomFn ? randomFn() : Math.random();
  const jitter = Math.floor(rand * BASE_BACKOFF_MS);
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, attempt) + jitter);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let inFlight = 0;
const waitQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < HORIZON_MAX_CONCURRENT) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight -= 1;
  const next = waitQueue.shift();
  if (next) next();
}

export interface HorizonCallOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  label?: string;
  sleepFn?: (ms: number) => Promise<void>;
  randomFn?: () => number;
}

/**
 * Executes a Horizon API call within the global concurrency budget, per-attempt timeout, and retry policy.
 *
 * @param fn - Async function executing the Horizon SDK or network call.
 * @param options - Configuration options for timeout, max attempts, and mock injection.
 * @returns Resolved value of fn.
 * @throws HorizonUnavailableError when retries on 429/5xx/transport errors are exhausted.
 */
export async function horizonCall<T>(
  fn: () => Promise<T>,
  options: HorizonCallOptions = {}
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
          const delay = lastRetryAfter ?? calculateBackoffMs(attempt, options.randomFn);
          await sleepFn(delay);
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    const status = horizonErrorStatus(lastError);
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new HorizonUnavailableError(
      `${label} failed after ${maxAttempts} attempts: ${message}`,
      status,
      lastRetryAfter
    );
  } finally {
    releaseSlot();
  }
}
