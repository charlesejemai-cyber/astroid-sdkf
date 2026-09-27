/**
 * A routing `fetch` double for the integration suite.
 *
 * The suite deliberately mocks at the network boundary rather than stubbing
 * individual resource methods: the point of these tests is to exercise the real
 * `HttpClient` request pipeline (URL building, auth headers, envelope
 * unwrapping, error mapping) with every package wired together behind a single
 * `fetch`. Stubbing resources would bypass exactly the seams under test.
 *
 * Routes are registered as `"METHOD /path"` strings, with `:name` segments
 * captured into {@link MockRequest.params}. Every request is recorded so tests
 * can assert the call *sequence* across package boundaries.
 *
 * @module
 */

/** A request as observed by the mock, after the API version prefix is stripped. */
export interface MockRequest {
  method: string;
  /** Path with the API version prefix removed, e.g. `/agents/agt_1`. */
  path: string;
  /** Full request URL, including origin and query string. */
  url: string;
  /** Query parameters parsed from the request URL. */
  query: Record<string, string>;
  /** Request headers, lower-cased. */
  headers: Record<string, string>;
  /** Parsed JSON body, or `undefined` when the request had no body. */
  body: unknown;
  /** Values captured by `:name` segments in the matched route. */
  params: Record<string, string>;
}

/** What a route handler returns; the body is sent verbatim. */
export interface MockReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type RouteHandler = (req: MockRequest) => MockReply | Promise<MockReply>;

export interface MockApi {
  /** Pass this to `new Astroid({ fetch })`. */
  readonly fetch: typeof fetch;
  /** Every request received, in order. */
  readonly requests: MockRequest[];
  /** Register a handler with full control over the raw response envelope. */
  on(route: string, handler: RouteHandler): MockApi;
  /** Register a handler replying `200 { success: true, data }`. */
  json(route: string, data: unknown, init?: { status?: number; headers?: Record<string, string> }): MockApi;
  /** Register a handler replying with an error envelope. */
  fail(
    route: string,
    status: number,
    code: string,
    message: string,
    init?: { details?: Record<string, unknown>; headers?: Record<string, string> },
  ): MockApi;
  /** `METHOD /path` for each recorded request, in order — handy for assertions. */
  calls(): string[];
  /** Forget recorded requests and registered routes. */
  reset(): void;
}

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

export interface MockApiOptions {
  /**
   * Path prefix the `HttpClient` prepends via `apiVersion` (default `v1`).
   * Stripped before route matching so routes read as `/agents`, not `/v1/agents`.
   */
  versionPrefix?: string;
  /** Origin the mock pretends to serve. Requests to other origins still match. */
  origin?: string;
}

/** Wrap a payload in the success envelope the `HttpClient` unwraps. */
export function successEnvelope(data: unknown): { success: true; data: unknown } {
  return { success: true, data };
}

/** Wrap a failure in the error envelope the `HttpClient` maps to a typed error. */
export function errorEnvelope(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): { success: false; error: { code: string; message: string; details?: Record<string, unknown> } } {
  return { success: false, error: details ? { code, message, details } : { code, message } };
}

/** Build an in-memory routing `fetch` double. */
export function createMockApi(options: MockApiOptions = {}): MockApi {
  const versionPrefix = options.versionPrefix ?? '/v1';
  const routes: Route[] = [];
  const requests: MockRequest[] = [];

  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, options.origin ?? 'https://api.astroid.test');

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }

    let body: unknown;
    if (typeof init?.body === 'string' && init.body.length > 0) {
      body = JSON.parse(init.body);
    }

    const request: MockRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: stripVersionPrefix(url.pathname, versionPrefix),
      url: url.toString(),
      query: Object.fromEntries(url.searchParams),
      headers,
      body,
      params: {},
    };

    const match = matchRoute(routes, request);
    if (match) {
      request.params = match.params;
    }
    requests.push(request);

    if (!match) {
      return jsonResponse(404, {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `No mock route for ${request.method} ${request.path}`,
        },
      });
    }

    const reply = await match.route.handler(request);
    return jsonResponse(reply.status ?? 200, reply.body, reply.headers);
  };

  const api: MockApi = {
    fetch: fetchMock as unknown as typeof fetch,
    requests,
    on(route, handler) {
      const [method, path] = splitRoute(route);
      routes.push({ method: method.toUpperCase(), segments: splitPath(path), handler });
      return api;
    },
    json(route, data, init) {
      return api.on(route, () => ({
        status: init?.status ?? 200,
        body: successEnvelope(data),
        ...(init?.headers ? { headers: init.headers } : {}),
      }));
    },
    fail(route, status, code, message, init) {
      return api.on(route, () => ({
        status,
        body: errorEnvelope(code, message, init?.details),
        ...(init?.headers ? { headers: init.headers } : {}),
      }));
    },
    calls() {
      return requests.map((request) => `${request.method} ${request.path}`);
    },
    reset() {
      requests.length = 0;
      routes.length = 0;
    },
  };

  return api;
}

/** Remove the leading `/v1` (or configured) segment added by `buildUrl`. */
function stripVersionPrefix(pathname: string, prefix: string): string {
  if (prefix && pathname.startsWith(`${prefix}/`)) {
    return pathname.slice(prefix.length);
  }
  return pathname === prefix ? '/' : pathname;
}

function splitRoute(route: string): [string, string] {
  const index = route.indexOf(' ');
  if (index === -1) {
    return ['GET', route];
  }
  return [route.slice(0, index), route.slice(index + 1)];
}

function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

/** Find the most recently registered matching route (later `on()` calls win). */
function matchRoute(routes: Route[], request: MockRequest): RouteMatch | undefined {
  const segments = splitPath(request.path);
  for (let i = routes.length - 1; i >= 0; i--) {
    const route = routes[i]!;
    if (route.method !== request.method) continue;
    if (route.segments.length !== segments.length) continue;

    const params: Record<string, string> = {};
    let matched = true;
    for (let s = 0; s < route.segments.length; s++) {
      const pattern = route.segments[s]!;
      const actual = segments[s]!;
      if (pattern.startsWith(':')) {
        params[pattern.slice(1)] = decodeURIComponent(actual);
      } else if (pattern !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { route, params };
    }
  }
  return undefined;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  // 204 must not carry a body; Response throws otherwise.
  const payload = status === 204 || body === undefined ? null : JSON.stringify(body);
  return new Response(payload, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
