/**
 * @file Cross-cutting API fault injection and in-memory rate limiting.
 *
 * Scenarios run after authorization so 401/403 semantics stay intact. The
 * limiter is per process and intentionally simple; it is a simulator feature,
 * not a distributed gateway.
 */
import type { Ctx } from './router.js';
import type { Config } from '../core/config.js';
import type { AuthUser } from './auth.js';
import { HttpError, validationError } from '../core/errors.js';

const windows = new Map<string, { count: number; resetAt: number }>();

interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
}

function requestKey(ctx: Ctx, user: AuthUser | null): string {
  if (user) return `user:${user.id}`;
  return `ip:${ctx.req.socket.remoteAddress ?? 'unknown'}`;
}

function rateHeaders(limit: number, remaining: number, resetAt: number): RateLimitHeaders {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
  };
}

function simulatedStatus(ctx: Ctx): number | null {
  const header = ctx.req.headers['x-simulate-error'];
  const raw = (Array.isArray(header) ? header[0] : header) ?? ctx.query.get('simulate_error');
  if (!raw) return null;
  const code = Number(raw);
  if (![429, 500, 503].includes(code)) {
    throw validationError([{ field: 'X-Simulate-Error', message: 'use 429, 500 o 503' }]);
  }
  return code;
}

/**
 * Applies cross-cutting API testing scenarios.
 *
 * `X-Simulate-Error` (or `?simulate_error=`) forces 429/500/503 before routing.
 * The optional in-memory rate limiter applies to every `/api/v1` request after
 * authentication, keyed by user id or client IP. It is disabled when
 * `API_RATE_LIMIT_MAX=0`. Fault injection can be disabled independently.
 */
export function applyApiScenarios(ctx: Ctx, config: Config, user: AuthUser | null): void {
  if (!ctx.url.pathname.startsWith('/api/v1/')) return;

  const forced = simulatedStatus(ctx);
  if (forced !== null) {
    if (!config.faultInjectionEnabled) {
      throw new HttpError(403, 'FAULT_INJECTION_DISABLED', 'La inyección de errores está deshabilitada');
    }
    if (forced === 429) {
      throw new HttpError(429, 'SIMULATED_RATE_LIMIT', 'Límite de solicitudes simulado', {
        details: { simulated: true },
        headers: { 'Retry-After': '1' },
      });
    }
    if (forced === 503) {
      throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'Servicio temporalmente no disponible', {
        details: { simulated: true },
        headers: { 'Retry-After': '5' },
      });
    }
    throw new HttpError(500, 'SIMULATED_INTERNAL_ERROR', 'Error interno simulado', {
      details: { simulated: true },
    });
  }

  if (config.apiRateLimitMax <= 0) return;
  const now = Date.now();
  const key = requestKey(ctx, user);
  let bucket = windows.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + config.apiRateLimitWindowMs };
    windows.set(key, bucket);
  }
  bucket.count += 1;
  const remaining = config.apiRateLimitMax - bucket.count;
  const headers = rateHeaders(config.apiRateLimitMax, remaining, bucket.resetAt);
  for (const [name, value] of Object.entries(headers)) ctx.res.setHeader(name, value);

  if (bucket.count > config.apiRateLimitMax) {
    throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Límite global de solicitudes excedido', {
      headers: {
        ...headers,
        'Retry-After': String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
      },
    });
  }

  if (windows.size > 10_000) {
    for (const [candidate, state] of windows) {
      if (state.resetAt <= now) windows.delete(candidate);
    }
  }
}
