import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  horizonCall,
  horizonErrorStatus,
  isHorizonUnavailable,
  parseRetryAfterMs,
  HorizonUnavailableError,
  HORIZON_MAX_ATTEMPTS,
  HORIZON_MAX_CONCURRENT,
} from '../src/utils/horizon-client.ts';
import { ALLOW_INSECURE_HORIZON } from '../src/config/stellar.ts';

const noSleep = () => Promise.resolve();

function createHttpError(status: number, headers: Record<string, string> = {}) {
  const err = new Error(`Horizon ${status}`) as any;
  err.response = { status, statusText: String(status), headers };
  return err;
}

describe('horizonCall retry and classification', () => {
  it('returns the result on first success without retrying', async () => {
    let calls = 0;
    const result = await horizonCall(async () => {
      calls += 1;
      return 'ok';
    }, { sleepFn: noSleep });
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  it('retries a 429 and succeeds on the next attempt', async () => {
    let calls = 0;
    const result = await horizonCall(
      async () => {
        calls += 1;
        if (calls === 1) throw createHttpError(429);
        return 'ok';
      },
      { sleepFn: noSleep }
    );
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  it('honors Retry-After seconds on a 429', async () => {
    const sleptDurations: number[] = [];
    let calls = 0;
    await assert.rejects(
      horizonCall(
        async () => {
          calls += 1;
          throw createHttpError(429, { 'retry-after': '5' });
        },
        {
          sleepFn: async (ms) => {
            sleptDurations.push(ms);
          },
          maxAttempts: 2,
        }
      ),
      (err: any) => err instanceof HorizonUnavailableError && err.retryAfterMs === 5000
    );
    assert.equal(calls, 2);
    assert.deepEqual(sleptDurations, [5000]);
  });

  it('converts persistent 429 into HorizonUnavailableError after exhausting budget', async () => {
    let calls = 0;
    await assert.rejects(
      horizonCall(
        async () => {
          calls += 1;
          throw createHttpError(429);
        },
        { sleepFn: noSleep }
      ),
      (err: any) => err instanceof HorizonUnavailableError && err.status === 429
    );
    assert.equal(calls, HORIZON_MAX_ATTEMPTS);
  });

  it('does not retry a 404 missing transaction', async () => {
    let calls = 0;
    await assert.rejects(
      horizonCall(
        async () => {
          calls += 1;
          throw createHttpError(404);
        },
        { sleepFn: noSleep }
      ),
      (err: any) => !(err instanceof HorizonUnavailableError) && err.response?.status === 404
    );
    assert.equal(calls, 1);
  });

  it('does not retry other 4xx client errors', async () => {
    let calls = 0;
    await assert.rejects(
      horizonCall(
        async () => {
          calls += 1;
          throw createHttpError(400);
        },
        { sleepFn: noSleep }
      ),
      /Horizon 400/
    );
    assert.equal(calls, 1);
  });

  it('retries 5xx and transport disconnect, then fails with HorizonUnavailableError', async () => {
    let calls = 0;
    await assert.rejects(
      horizonCall(
        async () => {
          calls += 1;
          if (calls === 1) {
            throw createHttpError(503);
          }
          throw Object.assign(new TypeError('fetch failed'), { code: 'ECONNRESET' });
        },
        { sleepFn: noSleep, maxAttempts: 2 }
      ),
      HorizonUnavailableError
    );
    assert.equal(calls, 2);
  });

  it('does not retry generic runtime errors without transport indicators', async () => {
    let calls = 0;
    await assert.rejects(
      horizonCall(
        async () => {
          calls += 1;
          throw new RangeError('internal caller error');
        },
        { sleepFn: noSleep }
      ),
      RangeError
    );
    assert.equal(calls, 1);
  });

  it('times out hung calls and retries', async () => {
    let calls = 0;
    const result = await horizonCall(
      async () => {
        calls += 1;
        if (calls === 1) {
          return new Promise<string>(() => {});
        }
        return 'ok';
      },
      { sleepFn: noSleep, timeoutMs: 25 }
    );
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });
});

describe('horizonCall concurrency budget', () => {
  it('caps simultaneous calls at HORIZON_MAX_CONCURRENT', async () => {
    let activeInFlight = 0;
    let peakConcurrency = 0;
    const totalRequests = HORIZON_MAX_CONCURRENT * 3;

    await Promise.all(
      Array.from({ length: totalRequests }, () =>
        horizonCall(
          async () => {
            activeInFlight += 1;
            peakConcurrency = Math.max(peakConcurrency, activeInFlight);
            await new Promise((resolve) => setTimeout(resolve, 15));
            activeInFlight -= 1;
          },
          { sleepFn: noSleep }
        )
      )
    );

    assert.ok(peakConcurrency <= HORIZON_MAX_CONCURRENT);
    assert.ok(peakConcurrency >= Math.min(2, HORIZON_MAX_CONCURRENT));
  });
});

describe('horizon error helpers', () => {
  it('extracts status code from various error shapes', () => {
    assert.equal(horizonErrorStatus(createHttpError(429)), 429);
    assert.equal(horizonErrorStatus(Object.assign(new Error('err'), { status: 502 })), 502);
    assert.equal(horizonErrorStatus(new Error('no status')), undefined);
  });

  it('correctly classifies outage errors', () => {
    assert.equal(isHorizonUnavailable(createHttpError(429)), true);
    assert.equal(isHorizonUnavailable(createHttpError(500)), true);
    assert.equal(isHorizonUnavailable(createHttpError(404)), false);
    assert.equal(isHorizonUnavailable(new HorizonUnavailableError('outage')), true);
    assert.equal(isHorizonUnavailable(new TypeError('fetch failed')), true);
    assert.equal(isHorizonUnavailable(new RangeError('logic error')), false);
    assert.equal(isHorizonUnavailable('invalid type'), false);
  });

  it('parses Retry-After delta seconds and HTTP dates', () => {
    assert.equal(parseRetryAfterMs('4'), 4000);
    const futureDate = new Date(Date.now() + 3000).toUTCString();
    const parsedMs = parseRetryAfterMs(futureDate);
    assert.ok(parsedMs !== undefined && parsedMs > 1000 && parsedMs <= 3000);
    assert.equal(parseRetryAfterMs('invalid-header'), undefined);
    assert.equal(parseRetryAfterMs(undefined), undefined);
    assert.equal(parseRetryAfterMs('-10'), 0);
  });
});

describe('production plaintext Horizon refusal', () => {
  it('allows loopback HTTP and rejects external plaintext HTTP', () => {
    const loopbackRegex = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;
    assert.equal(loopbackRegex.test('http://127.0.0.1:8000'), true);
    assert.equal(loopbackRegex.test('http://localhost:3000'), true);
    assert.equal(loopbackRegex.test('http://[::1]:8000'), true);
    assert.equal(loopbackRegex.test('http://horizon.stellar.org'), false);
    assert.equal(loopbackRegex.test('http://horizon-testnet.stellar.org'), false);
    assert.equal(loopbackRegex.test('http://custom-node.example.com:8000'), false);
  });
});
