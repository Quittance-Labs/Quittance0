/**
 * A transport stub, so `lib/api.ts` itself stays real.
 *
 * Aliasing `@/lib/api` would have replaced `describeApiError` too — the very
 * function the pages use to build their error announcements — with a copy that
 * could drift. Replacing axios instead leaves every line of `lib/api.ts` under
 * audit and only removes the socket.
 *
 * Responses are matched by the longest registered path that the request URL
 * ends with, which is enough for the four endpoints the audited pages call.
 */

const routes = new Map();

/** Registers a payload or deferred payload for `lib/api.ts` to receive. */
function setResponse(pathSuffix, payload) {
  routes.set(pathSuffix, payload);
}

/** Clears every registered response. */
function resetResponses() {
  routes.clear();
}

function resolve(url) {
  const matches = [...routes.keys()]
    .filter((key) => url.endsWith(key) || url.startsWith(key))
    .sort((a, b) => b.length - a.length);

  if (matches.length === 0) {
    const error = new Error(`No a11y fixture registered for ${url}`);
    error.response = { status: 404, data: { error: 'Not found' } };
    return Promise.reject(error);
  }

  return Promise.resolve(routes.get(matches[0])).then((data) => ({ data }));
}

/** Request log so a test can assert a call happened, not just its result. */
const calls = [];

function createInstance() {
  return {
    interceptors: {
      request: { use() {} },
      response: { use() {} },
    },
    get: (url) => {
      calls.push(`GET ${url}`);
      return resolve(url);
    },
    post: (url) => {
      calls.push(`POST ${url}`);
      return resolve(url);
    },
  };
}

function getCalls() {
  return [...calls];
}

function resetCalls() {
  calls.length = 0;
}

const axios = {
  create: createInstance,
  setResponse,
  resetResponses,
  getCalls,
  resetCalls,
};

export default axios;
export { setResponse, resetResponses, getCalls, resetCalls };
