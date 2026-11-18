/**
 * @file Global `/api/v1` authorization policy.
 *
 * Public auth endpoints are explicit; every other API call requires a valid
 * principal and `<domain>:read|write`. Route-local guards remain active when
 * global auth is disabled, so identity endpoints are never accidentally open.
 */
import type { Ctx } from './router.js';
import type { RequestContext } from './index.js';
import type { Config } from '../core/config.js';
import { hasPermission, resolveUser, type AuthUser } from './auth.js';
import { forbidden, unauthorized } from '../core/errors.js';

/** Routes that must work without a Bearer token or API key. */
const PUBLIC_API_PATHS = new Set([
  '/api/v1/identity/auth/login',
  '/api/v1/identity/auth/refresh',
  '/api/v1/identity/auth/forgot-password',
  '/api/v1/identity/auth/reset-password',
  '/api/v1/identity/auth/verify',
]);

/** Routes that need a valid identity but no specific domain permission. */
const AUTHENTICATED_ONLY_PATHS = new Set([
  '/api/v1/identity/auth/logout',
  '/api/v1/identity/auth/me',
  '/api/v1/identity/auth/change-password',
]);

const DOMAIN_RESOURCES = new Set(['identity', 'projects', 'shop', 'library', 'education', 'hr', 'finance']);

function normalizedPath(ctx: Ctx): string {
  const path = ctx.url.pathname;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function requiredPermission(pathname: string, method: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const domain = segments[2];
  if (!domain || !DOMAIN_RESOURCES.has(domain)) return null;
  const read = method === 'GET' || method === 'HEAD';
  return `${domain}:${read ? 'read' : 'write'}`;
}

/**
 * Applies the optional global API policy.
 *
 * When `AUTH_REQUIRED` is enabled, every `/api/v1` request except the public
 * authentication endpoints requires a valid Bearer token or API key. Domain
 * reads require `<domain>:read` and mutations `<domain>:write`. Permissions may
 * come from direct roles or group roles. When disabled, individual route guards
 * (notably identity) still apply.
 */
export function enforceApiAccess(ctx: Ctx, config: Config): AuthUser | null {
  if (!config.authRequired) return null;
  const pathname = normalizedPath(ctx);
  if (!pathname.startsWith('/api/v1/')) return null;
  const method = (ctx.req.method ?? 'GET').toUpperCase();
  if (method === 'OPTIONS' || PUBLIC_API_PATHS.has(pathname)) return null;

  const user = resolveUser(ctx);
  if (!user) throw unauthorized('Se requiere autenticación para acceder a la API');
  if (AUTHENTICATED_ONLY_PATHS.has(pathname)) return user;

  const permission = requiredPermission(pathname, method);
  if (!permission) return user;
  if (!hasPermission((ctx as RequestContext).app.db, user, permission)) {
    throw forbidden(`Falta el permiso requerido: ${permission}`);
  }
  return user;
}
