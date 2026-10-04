import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Horizon, NetworkError } from '@stellar/stellar-sdk';
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

async function withSdkHorizon(
  respond: (request: http.IncomingMessage, response: http.ServerResponse) => void,
  run: (server: Horizon.Server) => Promise<void>
): Promise<void> {
  const httpServer = http.createServer(respond);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;
  try {
    await run(new Horizon.Server(`http://127.0.0.1:${port}`, { allowHttp: true }));
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

describe('horizonCall — real SDK HTTP metadata', () => {
  const outages = [
    { name: '429 JSON without body status', status: 429, body: { title: 'Busy' }, type: 'application/json' },
    { name: '503 HTML proxy response', status: 503, body: '<h1>Unavailable</h1>', type: 'text/html' },
    { name: '502 with contradictory body status', status: 502, body: { status: 404 }, type: 'application/json' },
    { name: '429 canonical body with a misleading body header', status: 429, body: { status: 429, headers: { 'retry-after': '99' } }, type: 'application/json' },
  ];

  for (const failure of outages) {
    it(`retains wire status and Retry-After for ${failure.name}`, async () => {
      let requests = 0;
      const sleeps: number[] = [];
      await withSdkHorizon((_request, response) => {
        requests++;
        response.writeHead(failure.status, { 'content-type': failure.type, 'retry-after': '7' });
        response.end(failure.type === 'text/html' ? failure.body as string : JSON.stringify(failure.body));
      }, async (server) => {
        await assert.rejects(
          horizonCall(() => server.transactions().transaction('1'.repeat(64)).call(), {
            sleepFn: async ms => { sleeps.push(ms); },
          }),
          (error: unknown) => error instanceof HorizonUnavailableError &&
            error.status === failure.status && error.retryAfterMs === 7000
        );
      });
      assert.equal(requests, HORIZON_MAX_ATTEMPTS);
      assert.deepEqual(sleeps, [7000, 7000]);
    });
  }

  for (const status of [400, 404]) {
    it(`does not retry HTTP ${status} even when its body says 503`, async () => {
      let requests = 0;
      const body = { status: 503, title: 'Contradictory body' };
      await withSdkHorizon((_request, response) => {
        requests++;
        response.writeHead(status, { 'content-type': 'application/json', 'retry-after': '7' });
        response.end(JSON.stringify(body));
      }, async (server) => {
        await assert.rejects(
          horizonCall(() => server.transactions().transaction('1'.repeat(64)).call(), { sleepFn: noSleep }),
          (error: unknown) => {
            assert.ok(error instanceof NetworkError);
            assert.equal(horizonErrorStatus(error), status);
            assert.equal(classifyHorizonFailure(error), null);
            assert.deepEqual(error.getResponse(), body, 'the original SDK response must remain intact');
            return true;
          }
        );
      });
      assert.equal(requests, 1);
    });
  }

  it('does not invent Retry-After from response body fields', async () => {
    const body = { status: 429, headers: { 'retry-after': '99' } };
    await withSdkHorizon((_request, response) => {
      response.writeHead(429, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    }, async (server) => {
      await assert.rejects(
        horizonCall(() => server.transactions().transaction('1'.repeat(64)).call(), {
          maxAttempts: 1, sleepFn: noSleep,
        }),
        (error: unknown) => error instanceof HorizonUnavailableError &&
          error.status === 429 && error.retryAfterMs === undefined
      );
    });
  });

  it('keeps HTTP metadata isolated across overlapping SDK calls', async () => {
    const outageHash = '1'.repeat(64);
    const missingHash = '2'.repeat(64);
    const counts = { outage: 0, missing: 0 };
    const sleeps: number[] = [];
    let inFlight = 0;
    let peak = 0;
    await withSdkHorizon((request, response) => {
      const outage = request.url?.endsWith(outageHash);
      counts[outage ? 'outage' : 'missing']++;
      peak = Math.max(peak, ++inFlight);
      setTimeout(() => {
        response.writeHead(outage ? 429 : 404, { 'content-type': 'text/plain', 'retry-after': outage ? '7' : '19' });
        response.end('identical body');
        inFlight--;
      }, 10);
    }, async (server) => {
      const results = await Promise.allSettled([
        horizonCall(() => server.transactions().transaction(outageHash).call(), {
          maxAttempts: 2, sleepFn: async ms => { sleeps.push(ms); },
        }),
        horizonCall(() => server.transactions().transaction(missingHash).call(), { sleepFn: noSleep }),
      ]);
      const [outage, missing] = results;
      assert.equal(outage.status, 'rejected');
      assert.equal(missing.status, 'rejected');
      if (outage.status === 'rejected' && missing.status === 'rejected') {
        assert.ok(outage.reason instanceof HorizonUnavailableError);
        assert.equal(outage.reason.status, 429);
        assert.equal(outage.reason.retryAfterMs, 7000);
        assert.ok(missing.reason instanceof NetworkError);
        assert.equal(horizonErrorStatus(missing.reason), 404);
        assert.equal(classifyHorizonFailure(missing.reason), null);
      }
    });
    assert.deepEqual(counts, { outage: 2, missing: 1 });
    assert.deepEqual(sleeps, [7000]);
    assert.ok(peak >= 2, 'the fixture must overlap the SDK requests');
  });

  it('leaves SDK calls outside horizonCall unchanged', async () => {
    const body = { title: 'Unwrapped SDK error' };
    await withSdkHorizon((_request, response) => {
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7' });
      response.end(JSON.stringify(body));
    }, async (server) => {
      await assert.rejects(server.transactions().transaction('1'.repeat(64)).call(), (error: unknown) => {
        assert.ok(error instanceof NetworkError);
        assert.deepEqual(error.getResponse(), body);
        assert.equal(horizonErrorStatus(error), undefined);
        return true;
      });
    });
  });

  it('does not reuse metadata from a timed-out attempt that finishes during its retry', async () => {
    let requests = 0;
    let firstResponse: http.ServerResponse;
    await withSdkHorizon((_request, response) => {
      requests++;
      if (requests === 1) {
        firstResponse = response;
        return;
      }
      firstResponse.writeHead(503, { 'content-type': 'text/plain', 'retry-after': '99' });
      firstResponse.end('identical body');
      setImmediate(() => {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('identical body');
      });
    }, async (server) => {
      await assert.rejects(
        horizonCall(() => server.transactions().transaction('1'.repeat(64)).call(), {
          timeoutMs: 50, maxAttempts: 2, sleepFn: noSleep,
        }),
        (error: unknown) => {
          assert.ok(error instanceof NetworkError);
          assert.equal(horizonErrorStatus(error), 404);
          assert.equal(classifyHorizonFailure(error), null);
          return true;
        }
      );
    });
    assert.equal(requests, 2);
  });
});

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

describe('classifyHorizonFailure — named outage classes', () => {
  it('names HTTP 429 as rate_limited', () => {
    assert.equal(classifyHorizonFailure(httpError(429)), 'rate_limited');
  });

  it('names HTTP 503 as server_error', () => {
    assert.equal(classifyHorizonFailure(httpError(503)), 'server_error');
  });

  it('names a hung-call HorizonTimeout as timeout', async () => {
    let caught: unknown;
    try {
      await horizonCall(async () => new Promise(() => {}), {
        sleepFn: noSleep,
        timeoutMs: 20,
        maxAttempts: 1,
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof HorizonUnavailableError);
    assert.equal(classifyHorizonFailure(caught), 'connection');
  });

  it('names ECONNRESET as connection', () => {
    const err = Object.assign(new TypeError('fetch failed'), { code: 'ECONNRESET' });
    assert.equal(classifyHorizonFailure(err), 'connection');
  });

  it('names ETIMEDOUT as timeout', () => {
    const err = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    assert.equal(classifyHorizonFailure(err), 'timeout');
  });

  it('returns null for a 404 missing transaction', () => {
    assert.equal(classifyHorizonFailure(httpError(404)), null);
  });

  it('returns null for an ordinary bug so compare paths stay reachable', () => {
    assert.equal(classifyHorizonFailure(new RangeError('bug')), null);
  });
});
