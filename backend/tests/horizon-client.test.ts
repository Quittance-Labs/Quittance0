import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  horizonCall,
  horizonErrorStatus,
  isHorizonUnavailable,
  classifyHorizonFailure,
  parseRetryAfterMs,
  HorizonUnavailableError,
  HORIZON_MAX_ATTEMPTS,
  HORIZON_MAX_CONCURRENT,
} from '../src/utils/horizon-client.ts';

const noSleep = () => Promise.resolve();

/** Error shaped like the SDK's Horizon NetworkError. */
function httpError(status: number, headers: Record<string, string> = {}) {
  const err = new Error(`Horizon ${status}`) as any;
  err.response = { status, statusText: String(status), headers };
  return err;
}

describe('horizonCall — retry and classification', () => {
  it('returns the result on first success without retrying', async () => {
    let calls = 0;
    const out = await horizonCall(async () => (++calls, 'ok'), { sleepFn: noSleep });
    assert.equal(out, 'ok');
    assert.equal(calls, 1);
  });

  it('retries a 429 and succeeds on the next attempt', async () => {
    let calls = 0;
    const out = await horizonCall(
      async () => {
        calls += 1;
        if (calls === 1) throw httpError(429);
        return 'ok';
      },
      { sleepFn: noSleep }
    );
    assert.equal(out, 'ok');
    assert.equal(calls, 2);
  });

  it('honors Retry-After seconds on a 429', async () => {
    const slept: number[] = [];
    let calls = 0;
    await assert.rejects(
      horizonCall(
        async () => {
          calls += 1;
          throw httpError(429, { 'retry-after': '7' });
        },
        { sleepFn: async (ms) => void slept.push(ms), maxAttempts: 2 }
      ),
      (e: any) => e instanceof HorizonUnavailableError && e.retryAfterMs === 7000
    );
    assert.equal(calls, 2);
    assert.deepEqual(slept, [7000]);
  });

  it('converts a persistent 429 into HorizonUnavailableError after the attempt budget', async () => {
    let calls = 0;
    await assert.rejects(
      horizonCall(
        async () => {
          calls += 1;
          throw httpError(429);
        },
        { sleepFn: noSleep }
      ),
      (e: any) => e instanceof HorizonUnavailableError && e.status === 429
    );
    assert.equal(calls, HORIZON_MAX_ATTEMPTS);
  });

  it('does not retry a 404 — a missing transaction is not an outage', async () => {
    let calls = 0;
    await assert.rejects(
      horizonCall(
        async () => {
          calls += 1;
          throw httpError(404);
        },
        { sleepFn: noSleep }
      ),
      (e: any) => !(e instanceof HorizonUnavailableError) && e.response?.status === 404
    );
    assert.equal(calls, 1);
  });

  it('does not retry other 4xx client errors', async () => {
    let calls = 0;
    await assert.rejects(
      horizonCall(
        async () => {
          calls += 1;
          throw httpError(400);
        },
        { sleepFn: noSleep }
      ),
      /Horizon 400/
    );
    assert.equal(calls, 1);
  });

  it('retries a 5xx and a bare transport failure, then gives up as unavailable', async () => {
    let calls = 0;
    await assert.rejects(
      horizonCall(
        async () => {
          calls += 1;
          throw calls === 1 ? httpError(502) : Object.assign(new TypeError('fetch failed'), { code: 'ECONNRESET' });
        },
        { sleepFn: noSleep, maxAttempts: 2 }
      ),
      HorizonUnavailableError
    );
    assert.equal(calls, 2);
  });

  it('does not retry an ordinary thrown error with no transport shape', async () => {
    let calls = 0;
    await assert.rejects(
      horizonCall(
        async () => {
          calls += 1;
          throw new RangeError('bug in callback');
        },
        { sleepFn: noSleep }
      ),
      RangeError
    );
    assert.equal(calls, 1);
  });

  it('times out a hung call and retries it', async () => {
    let calls = 0;
    const out = await horizonCall(
      async () => {
        calls += 1;
        if (calls === 1) return new Promise<string>(() => {});
        return 'ok';
      },
      { sleepFn: noSleep, timeoutMs: 25 }
    );
    assert.equal(out, 'ok');
    assert.equal(calls, 2);
  });
});

describe('horizonCall — concurrency budget', () => {
  it('caps simultaneous calls at HORIZON_MAX_CONCURRENT', async () => {
    let inFlightNow = 0;
    let peak = 0;
    const total = HORIZON_MAX_CONCURRENT * 3;
    await Promise.all(
      Array.from({ length: total }, () =>
        horizonCall(
          async () => {
            inFlightNow += 1;
            peak = Math.max(peak, inFlightNow);
            await new Promise((r) => setTimeout(r, 10));
            inFlightNow -= 1;
          },
          { sleepFn: noSleep }
        )
      )
    );
    assert.ok(peak <= HORIZON_MAX_CONCURRENT, `peak ${peak} exceeded budget`);
    assert.ok(peak >= Math.min(2, HORIZON_MAX_CONCURRENT), 'calls should overlap');
  });
});

describe('horizon error helpers', () => {
  it('reads status from SDK-shaped and fetch-shaped errors', () => {
    assert.equal(horizonErrorStatus(httpError(429)), 429);
    assert.equal(horizonErrorStatus(Object.assign(new Error('x'), { status: 500 })), 500);
    assert.equal(horizonErrorStatus(new Error('nope')), undefined);
  });

  it('classifies outage classes only', () => {
    assert.equal(isHorizonUnavailable(httpError(429)), true);
    assert.equal(isHorizonUnavailable(httpError(503)), true);
    assert.equal(isHorizonUnavailable(httpError(404)), false);
    assert.equal(isHorizonUnavailable(new HorizonUnavailableError('x')), true);
    assert.equal(isHorizonUnavailable(new TypeError('fetch failed')), true);
    assert.equal(isHorizonUnavailable(new RangeError('bug')), false);
    assert.equal(isHorizonUnavailable('not an error'), false);
  });

  it('parses Retry-After seconds and HTTP dates', () => {
    assert.equal(parseRetryAfterMs('3'), 3000);
    const future = new Date(Date.now() + 2000).toUTCString();
    const ms = parseRetryAfterMs(future);
    assert.ok(ms !== undefined && ms > 500 && ms <= 2000, `date parse gave ${ms}`);
    assert.equal(parseRetryAfterMs('garbage'), undefined);
    assert.equal(parseRetryAfterMs(undefined), undefined);
    assert.equal(parseRetryAfterMs('-5'), 0);
  });
});

describe('classifyHorizonFailure — simulated statuses and error classes', () => {
  it('simulates Horizon status 429 Too Many Requests as 429', () => {
    assert.equal(classifyHorizonFailure(httpError(429)), '429');
  });

  it('simulates Horizon status 504 Gateway Timeout as timeout', () => {
    assert.equal(classifyHorizonFailure(httpError(504)), 'timeout');
  });

  it('simulates Horizon status 503 Service Unavailable as connection', () => {
    assert.equal(classifyHorizonFailure(httpError(503)), 'connection');
  });

  it('simulates Horizon status 502 Bad Gateway as connection', () => {
    assert.equal(classifyHorizonFailure(httpError(502)), 'connection');
  });

  it('simulates TimeoutError class as timeout', () => {
    const timeoutErr = new Error('Request timed out');
    timeoutErr.name = 'TimeoutError';
    assert.equal(classifyHorizonFailure(timeoutErr), 'timeout');
  });

  it('simulates AbortError class as timeout', () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    assert.equal(classifyHorizonFailure(abortErr), 'timeout');
  });

  it('simulates ECONNREFUSED error code as connection', () => {
    const connErr = Object.assign(new TypeError('fetch failed'), { code: 'ECONNREFUSED' });
    assert.equal(classifyHorizonFailure(connErr), 'connection');
  });

  it('simulates ETIMEDOUT error code as timeout', () => {
    const connErr = Object.assign(new TypeError('fetch failed'), { code: 'ETIMEDOUT' });
    assert.equal(classifyHorizonFailure(connErr), 'timeout');
  });

  it('simulates Horizon status 404 Not Found as null', () => {
    assert.equal(classifyHorizonFailure(httpError(404)), null);
  });

  it('simulates Horizon status 400 Bad Request as null', () => {
    assert.equal(classifyHorizonFailure(httpError(400)), null);
  });
});
