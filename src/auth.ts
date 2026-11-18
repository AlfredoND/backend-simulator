import type { IncomingMessage } from 'node:http';
import type { Db } from './db.js';
import { hashToken } from './seed.js';
import { forbidden, unauthorized } from './errors.js';
import type { Ctx } from './router.js';
import type { RequestContext } from './http.js';

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

export function resolveUser(ctx: Ctx): AuthUser | null {
  const app = (ctx as RequestContext).app;
  const db = app.db;
  const auth = ctx.req.headers.authorization;

  if (auth !== undefined) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (!match) {
      throw unauthorized('Esquema de autenticación no soportado; use Bearer', {
        'WWW-Authenticate': 'Bearer realm="mafetch-simulator"',
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

export function requireUser(ctx: Ctx): AuthUser {
  const user = resolveUser(ctx);
  if (!user) throw unauthorized('Se requiere autenticación');
  return user;
}

export function effectivePermissionCodes(db: Db, userId: number, isAdmin: number): string[] {
  if (isAdmin) return ['*'];
  const rows = db.all<{ code: string }>(
    `SELECT DISTINCT p.code
     FROM id_permissions p
     JOIN id_role_permissions rp ON rp.permission_id = p.id
     JOIN id_user_roles ur ON ur.role_id = rp.role_id
     WHERE ur.user_id = ?
     ORDER BY p.code`,
    userId,
  );
  return rows.map((r) => r.code);
}

export function hasPermission(db: Db, user: AuthUser, code: string): boolean {
  if (user.is_admin) return true;
  return effectivePermissionCodes(db, user.id, user.is_admin).includes(code);
}

export function requirePermission(ctx: Ctx, code: string): AuthUser {
  const user = requireUser(ctx);
  const app = (ctx as RequestContext).app;
  if (!hasPermission(app.db, user, code)) {
    throw forbidden(`Falta el permiso requerido: ${code}`);
  }
  return user;
}

export function bearerFromRequest(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : undefined;
}

export function userRoles(db: Db, userId: number): Array<{ id: number; name: string }> {
  return db.all<{ id: number; name: string }>(
    `SELECT r.id, r.name FROM id_roles r
     JOIN id_user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ? ORDER BY r.name`,
    userId,
  );
}
