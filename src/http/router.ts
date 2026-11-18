/**
 * @file Framework-free HTTP router.
 *
 * Routes are registered explicitly; matching prefers static segments over
 * parameters. HEAD falls back to GET, OPTIONS derives `Allow`, and route
 * metadata feeds OpenAPI generation without a second declaration source.
 */
/** Minimal request context shared by handlers and helpers. */
export interface Ctx {
  req: import('node:http').IncomingMessage;
  res: import('node:http').ServerResponse;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  requestId: string;
  isHead: boolean;
}

/** Async or synchronous request handler. */
export type Handler = (ctx: Ctx) => Promise<void> | void;

/** Optional OpenAPI metadata attached to a route. */
export interface RouteDoc {
  summary?: string;
  summaryEn?: string;
  tag?: string;
  requestBody?: Record<string, unknown>;
  responses?: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
  parameters?: Array<Record<string, unknown>>;
}

interface RouteRecord {
  method: string;
  path: string;
  segments: string[];
  handler: Handler;
  doc: RouteDoc;
}

/** Result of resolving a method + path, including decoded params. */
export interface RouteMatch {
  route: RouteRecord;
  params: Record<string, string>;
  headFallback: boolean;
}

const normalize = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
};

/** Ordered route table with static-over-dynamic matching. */
export class Router {
  readonly routes: RouteRecord[] = [];

  /** Registers a method/path pair and its optional documentation. */
  add(method: string, path: string, handler: Handler, doc: RouteDoc = {}): void {
    const norm = normalize(path);
    this.routes.push({
      method: method.toUpperCase(),
      path: norm,
      segments: norm === '/' ? [] : norm.slice(1).split('/'),
      handler,
      doc,
    });
  }

  /** Finds the best route; HEAD may reuse a GET route. */
  match(method: string, pathname: string): RouteMatch | undefined {
    const methodUpper = method.toUpperCase();
    const normalized = normalize(pathname);
    const pathSegments = normalized === '/' ? [] : normalized.slice(1).split('/');
    const candidates: RouteMatch[] = [];

    for (const route of this.routes) {
      if (route.segments.length !== pathSegments.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(pathSegments[i]);
        } else if (seg !== pathSegments[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (route.method === methodUpper) {
        candidates.push({ route, params, headFallback: false });
      } else if (methodUpper === 'HEAD' && route.method === 'GET') {
        candidates.push({ route, params, headFallback: true });
      }
    }
    if (candidates.length === 0) return undefined;
    candidates.sort((a, b) => {
      const staticA = a.route.segments.filter((s) => !s.startsWith(':')).length;
      const staticB = b.route.segments.filter((s) => !s.startsWith(':')).length;
      if (staticA !== staticB) return staticB - staticA;
      return b.route.segments.length - a.route.segments.length;
    });
    return candidates[0];
  }

  /** Lists methods valid for a path, including automatic HEAD/OPTIONS. */
  allowedMethods(pathname: string): string[] {
    const normalized = normalize(pathname);
    const pathSegments = normalized === '/' ? [] : normalized.slice(1).split('/');
    const methods = new Set<string>();
    for (const route of this.routes) {
      if (route.segments.length !== pathSegments.length) continue;
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(':')) continue;
        if (seg !== pathSegments[i]) {
          ok = false;
          break;
        }
      }
      if (ok) methods.add(route.method);
    }
    if (methods.has('GET') && !methods.has('HEAD')) methods.add('HEAD');
    methods.add('OPTIONS');
    return [...methods].sort();
  }
}
