/**
 * @file Identity resolution and permission checks.
 *
 * Bearer sessions/tokens and API keys are hashed before lookup. Effective
 * permissions are the union of direct user roles and roles granted to the
 * user's groups; group policy is evaluated per request so changes propagate
 * without reissuing tokens. Raw credentials never leave the request.
 */
import type { IncomingMessage } from 'node:http';
import type { Db } from '../db/index.js';
import { hashToken } from '../db/seed.js';
import { forbidden, unauthorized } from '../core/errors.js';
import type { Ctx } from './router.js';
import type { RequestContext } from './index.js';

/** Minimal authenticated principal stored in request scope. */
export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  status: string;
  is_admin: number;
}

interface UserRow extends AuthUser {
  created_at: string;
  updated_at: string;
}

function activeUser(db: Db, userId: number): UserRow | undefined {
  return db.get<UserRow>(
    'SELECT id, email, display_name, status, is_admin, created_at, updated_at FROM id_users WHERE id = ?',
    userId,
  );
}

function ensureActive(user: UserRow): AuthUser {
  if (user.status !== 'active') throw forbidden('La cuenta no está activa');
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    status: user.status,
    is_admin: user.is_admin,
  };
}

/**
 * Resolves Bearer sessions, API tokens or `X-API-Key`.
 * Missing credentials return null; invalid/expired credentials throw 401.
 */
export function resolveUser(ctx: Ctx): AuthUser | null {
  const app = (ctx as RequestContext).app;
  const db = app.db;
  const auth = ctx.req.headers.authorization;

  if (auth !== undefined) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (!match) {
      throw unauthorized('Esquema de autenticación no soportado; use Bearer', {
        'WWW-Authenticate': 'Bearer realm="backend-simulator"',
      });
    }
    const hash = hashToken(match[1].trim());
    const now = new Date().toISOString();
    const session = db.get<UserRow>(
      `SELECT u.id, u.email, u.display_name, u.status, u.is_admin, u.created_at, u.updated_at
       FROM id_sessions s JOIN id_users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
      hash,
      now,
    );
    if (session) return ensureActive(session);
    const token = db.get<UserRow>(
      `SELECT u.id, u.email, u.display_name, u.status, u.is_admin, u.created_at, u.updated_at
       FROM id_tokens t JOIN id_users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.kind = 'api' AND t.revoked_at IS NULL
         AND (t.expires_at IS NULL OR t.expires_at > ?)`,
      hash,
      now,
    );
    if (token) {
      db.run('UPDATE id_tokens SET last_used_at = ? WHERE token_hash = ?', now, hash);
      return ensureActive(token);
    }
    throw unauthorized('Token inválido, revocado o expirado');
  }

  const apiKey = ctx.req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    const hash = hashToken(apiKey);
    const now = new Date().toISOString();
    const row = db.get<UserRow & { key_id: number }>(
      `SELECT u.id, u.email, u.display_name, u.status, u.is_admin, u.created_at, u.updated_at, k.id AS key_id
       FROM id_api_keys k JOIN id_users u ON u.id = k.user_id
       WHERE k.key_hash = ? AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > ?)`,
      hash,
      now,
    );
    if (!row) throw unauthorized('API key inválida, revocada o expirada');
    db.run('UPDATE id_api_keys SET last_used_at = ? WHERE id = ?', now, row.key_id);
    return ensureActive(row);
  }

  return null;
}

/** Requires an active authenticated principal. */
export function requireUser(ctx: Ctx): AuthUser {
  const user = resolveUser(ctx);
  if (!user) throw unauthorized('Se requiere autenticación');
  return user;
}

/** Union of direct and group-derived permission codes; admins receive `*`. */
export function effectivePermissionCodes(db: Db, userId: number, isAdmin: number): string[] {
  if (isAdmin) return ['*'];
  const rows = db.all<{ code: string }>(
    `SELECT DISTINCT p.code
     FROM id_permissions p
     JOIN id_role_permissions rp ON rp.permission_id = p.id
     WHERE rp.role_id IN (
       SELECT role_id FROM id_user_roles WHERE user_id = ?
       UNION
       SELECT gr.role_id
       FROM id_group_roles gr
       JOIN id_group_members gm ON gm.group_id = gr.group_id
       WHERE gm.user_id = ?
     )
     ORDER BY p.code`,
    userId,
    userId,
  );
  return rows.map((r) => r.code);
}

/** Tests one permission for a resolved principal. */
export function hasPermission(db: Db, user: AuthUser, code: string): boolean {
  if (user.is_admin) return true;
  return effectivePermissionCodes(db, user.id, user.is_admin).includes(code);
}

/** Requires authentication and one permission, producing 401/403. */
export function requirePermission(ctx: Ctx, code: string): AuthUser {
  const user = requireUser(ctx);
  const app = (ctx as RequestContext).app;
  if (!hasPermission(app.db, user, code)) {
    throw forbidden(`Falta el permiso requerido: ${code}`);
  }
  return user;
}

/** Reads a Bearer credential without throwing. */
export function bearerFromRequest(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : undefined;
}

/** Direct roles assigned to a user. */
export function userRoles(db: Db, userId: number): Array<{ id: number; name: string }> {
  return db.all<{ id: number; name: string }>(
    `SELECT r.id, r.name FROM id_roles r
     JOIN id_user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ? ORDER BY r.name`,
    userId,
  );
}

/** Direct and group-derived roles. */
export function effectiveRoles(db: Db, userId: number): Array<{ id: number; name: string }> {
  return db.all<{ id: number; name: string }>(
    `SELECT r.id, r.name
     FROM id_roles r
     WHERE r.id IN (
       SELECT role_id FROM id_user_roles WHERE user_id = ?
       UNION
       SELECT gr.role_id
       FROM id_group_roles gr
       JOIN id_group_members gm ON gm.group_id = gr.group_id
       WHERE gm.user_id = ?
     )
     ORDER BY r.name`,
    userId,
    userId,
  );
}

/** Group memberships with the roles each group grants. */
export function userGroups(
  db: Db,
  userId: number,
): Array<{ id: number; name: string; member_role: string; roles: string[] }> {
  const rows = db.all<{ id: number; name: string; member_role: string; roles: string | null }>(
    `SELECT g.id, g.name, gm.member_role,
       (SELECT GROUP_CONCAT(r.name, ', ')
        FROM id_group_roles gr JOIN id_roles r ON r.id = gr.role_id
        WHERE gr.group_id = g.id) AS roles
     FROM id_groups g
     JOIN id_group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = ?
     ORDER BY g.name`,
    userId,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    member_role: row.member_role,
    roles: row.roles ? row.roles.split(', ') : [],
  }));
}
