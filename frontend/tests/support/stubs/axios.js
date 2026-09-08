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

/** Registers the payload `lib/api.ts` should see for a path suffix. */
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

  return Promise.resolve({ data: routes.get(matches[0]) });
}

function createInstance() {
  return {
    interceptors: {
      request: { use() {} },
      response: { use() {} },
    },
    get: (url) => resolve(url),
    post: (url) => resolve(url),
  };
}

const axios = {
  create: createInstance,
  setResponse,
  resetResponses,
};

export default axios;
export { setResponse, resetResponses };
