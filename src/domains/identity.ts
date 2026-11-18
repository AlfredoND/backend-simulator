import { randomBytes } from 'node:crypto';
import type { Router } from '../http/router.js';
import type { Ctx } from '../http/router.js';
import type { RequestContext } from '../http/index.js';
import { readJsonBody, sendJson } from '../http/index.js';
import { badRequest, conflict, forbidden, notFound, unauthorized, validationError } from '../core/errors.js';
import { registerResource } from '../http/resource.js';
import type { ResourceDef } from '../http/resource.js';
import { Validator } from '../core/validate.js';
import { hashPassword, hashToken, verifyPassword } from '../db/seed.js';
import { effectivePermissionCodes, requirePermission, requireUser, resolveUser, userRoles } from '../http/auth.js';
import { escapeLike, paginationMeta, parsePagination } from '../http/query.js';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const USER_COLUMNS = 'id, email, display_name, status, is_admin, created_at, updated_at';

function dbOf(ctx: Ctx) {
  return (ctx as RequestContext).app.db;
}

function publicUser(db: ReturnType<typeof dbOf>, id: number): Row {
  const user = db.get<Row>(`SELECT ${USER_COLUMNS} FROM id_users WHERE id = ?`, id);
  if (!user) throw notFound('Usuario no encontrado');
  return user;
}

function profileOf(db: ReturnType<typeof dbOf>, userId: number): Row | null {
  return db.get<Row>('SELECT * FROM id_profiles WHERE user_id = ?', userId) ?? null;
}

function permissionsForUser(db: ReturnType<typeof dbOf>, userId: number, isAdmin: number): string[] {
  return effectivePermissionCodes(db, userId, isAdmin);
}

function mePayload(ctx: Ctx, userId: number) {
  const db = dbOf(ctx);
  const user = publicUser(db, userId);
  return {
    user,
    profile: profileOf(db, userId),
    roles: userRoles(db, userId),
    permissions: permissionsForUser(db, userId, Number(user.is_admin)),
  };
}

function constraintError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('UNIQUE')) throw conflict('Ya existe un recurso con esos valores');
  if (message.includes('FOREIGN KEY')) throw conflict('Referencia inexistente o recurso en uso');
  if (message.includes('CHECK')) throw validationError([{ field: '$', message: 'Restricción de integridad incumplida' }]);
  throw error;
}

function opaque(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`;
}

function authz(readPerm = 'identity:read', writePerm = 'identity:write') {
  return (ctx: Ctx, action: 'read' | 'write' | 'delete') => {
    requirePermission(ctx, action === 'read' ? readPerm : writePerm);
  };
}

function requestBody(ctx: Ctx): Promise<unknown> {
  return readJsonBody(ctx);
}

export function registerIdentityRoutes(router: Router, base: string): void {
  const root = `${base}/identity`;

  // ---------- Autenticación ----------
  router.add('POST', `${root}/auth/login`, async (ctx) => {
    const body = await requestBody(ctx);
    const input = new Validator(body, ['email', 'password']);
    const email = input.string('email', { required: true, email: true, maxLength: 254 })!;
    const password = input.string('password', { required: true, min: 1, maxLength: 200 })!;
    input.done();
    const db = dbOf(ctx);
    const user = db.get<Row & { password_hash: string }>('SELECT * FROM id_users WHERE LOWER(email) = LOWER(?)', email);
    if (!user || !verifyPassword(password, String(user.password_hash))) {
      throw unauthorized('Credenciales inválidas');
    }
    if (user.status !== 'active') throw forbidden('La cuenta no está activa');
    const accessToken = opaque('msim');
    const refreshToken = opaque('msimr');
    const expiresAt = new Date(Date.now() + 8 * 3_600_000).toISOString();
    db.insert('id_sessions', {
      user_id: Number(user.id),
      token_hash: hashToken(accessToken),
      refresh_hash: hashToken(refreshToken),
      user_agent: String(ctx.req.headers['user-agent'] ?? ''),
      ip: ctx.req.socket.remoteAddress ?? null,
      created_at: now(),
      expires_at: expiresAt,
      revoked_at: null,
    });
    sendJson(ctx, 200, {
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: 28_800,
        user: publicUser(db, Number(user.id)),
      },
    }, { 'Cache-Control': 'no-store' });
  }, { summary: 'Inicia sesión y emite tokens Bearer', tag: 'Identity · Auth' });

  router.add('POST', `${root}/auth/refresh`, async (ctx) => {
    const body = await requestBody(ctx);
    const input = new Validator(body, ['refresh_token']);
    const refreshToken = input.string('refresh_token', { required: true, maxLength: 300 })!;
    input.done();
    const db = dbOf(ctx);
    const session = db.get<Row>(
      `SELECT * FROM id_sessions WHERE refresh_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
      hashToken(refreshToken),
      now(),
    );
    if (!session) throw unauthorized('Refresh token inválido o expirado');
    const accessToken = opaque('msim');
    const newRefresh = opaque('msimr');
    db.run(
      `UPDATE id_sessions SET token_hash = ?, refresh_hash = ?, expires_at = ? WHERE id = ?`,
      hashToken(accessToken),
      hashToken(newRefresh),
      new Date(Date.now() + 8 * 3_600_000).toISOString(),
      Number(session.id),
    );
    sendJson(ctx, 200, {
      data: { access_token: accessToken, refresh_token: newRefresh, token_type: 'Bearer', expires_in: 28_800 },
    }, { 'Cache-Control': 'no-store' });
  }, { summary: 'Renueva un par de tokens', tag: 'Identity · Auth' });

  router.add('POST', `${root}/auth/logout`, (ctx) => {
    requireUser(ctx);
    const db = dbOf(ctx);
    const header = ctx.req.headers.authorization;
    if (header) {
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (match) {
        const hash = hashToken(match[1].trim());
        db.run('UPDATE id_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', now(), hash);
        db.run('UPDATE id_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', now(), hash);
      }
    }
    ctx.res.statusCode = 204;
    ctx.res.end();
  }, { summary: 'Cierra la sesión actual', tag: 'Identity · Auth' });

  router.add('GET', `${root}/auth/me`, (ctx) => {
    const user = requireUser(ctx);
    sendJson(ctx, 200, { data: mePayload(ctx, user.id) });
  }, { summary: 'Devuelve el usuario autenticado, roles y permisos', tag: 'Identity · Auth', security: [{ bearerAuth: [] }] });

  router.add('GET', `${root}/auth/protected`, (ctx) => {
    const user = requirePermission(ctx, 'identity:read');
    sendJson(ctx, 200, { data: { message: 'Acceso concedido', required_permission: 'identity:read', user: publicUser(dbOf(ctx), user.id) } });
  }, { summary: 'Recurso protegido de lectura (401/403)', tag: 'Identity · Auth', security: [{ bearerAuth: [] }] });

  router.add('GET', `${root}/auth/protected-write`, (ctx) => {
    const user = requirePermission(ctx, 'identity:write');
    sendJson(ctx, 200, { data: { message: 'Acceso de escritura concedido', required_permission: 'identity:write', user: publicUser(dbOf(ctx), user.id) } });
  }, { summary: 'Recurso protegido de escritura (403 con rol viewer)', tag: 'Identity · Auth', security: [{ bearerAuth: [] }] });

  router.add('POST', `${root}/auth/forgot-password`, async (ctx) => {
    const body = await requestBody(ctx);
    const input = new Validator(body, ['email']);
    const email = input.string('email', { required: true, email: true })!;
    input.done();
    const db = dbOf(ctx);
    const user = db.get<Row>('SELECT * FROM id_users WHERE LOWER(email) = LOWER(?)', email);
    const data: Record<string, unknown> = {
      message: 'Si el correo existe, se ha generado un token de recuperación válido durante 15 minutos.',
    };
    if (user) {
      const token = opaque('rst');
      db.insert('id_tokens', {
        user_id: Number(user.id),
        kind: 'reset',
        token_hash: hashToken(token),
        label: 'password-reset',
        scopes: null,
        created_at: now(),
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        revoked_at: null,
        last_used_at: null,
      });
      data.reset_token = token;
      data.note = 'Token expuesto solo para simulación local.';
    }
    sendJson(ctx, 202, { data });
  }, { summary: 'Simula la recuperación de contraseña', tag: 'Identity · Auth' });

  router.add('POST', `${root}/auth/reset-password`, async (ctx) => {
    const body = await requestBody(ctx);
    const input = new Validator(body, ['token', 'password']);
    const token = input.string('token', { required: true, maxLength: 300 })!;
    const password = input.string('password', { required: true, min: 8, maxLength: 200 })!;
    input.done();
    const db = dbOf(ctx);
    const row = db.get<Row>(
      `SELECT * FROM id_tokens WHERE token_hash = ? AND kind = 'reset' AND revoked_at IS NULL
       AND expires_at > ?`,
      hashToken(token),
      now(),
    );
    if (!row) throw badRequest('Token de recuperación inválido o expirado');
    db.transaction(() => {
      db.run('UPDATE id_users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(password), now(), Number(row.user_id));
      db.run('UPDATE id_tokens SET revoked_at = ? WHERE id = ?', now(), Number(row.id));
      db.run('UPDATE id_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', now(), Number(row.user_id));
    });
    sendJson(ctx, 200, { data: { message: 'Contraseña restablecida; las sesiones previas fueron revocadas.' } });
  }, { summary: 'Restablece la contraseña con un token de recuperación', tag: 'Identity · Auth' });

  router.add('POST', `${root}/auth/change-password`, async (ctx) => {
    const user = requireUser(ctx);
    const body = await requestBody(ctx);
    const input = new Validator(body, ['current_password', 'new_password']);
    const current = input.string('current_password', { required: true, maxLength: 200 })!;
    const next = input.string('new_password', { required: true, min: 8, maxLength: 200 })!;
    input.done();
    const db = dbOf(ctx);
    const row = db.get<{ password_hash: string }>('SELECT password_hash FROM id_users WHERE id = ?', user.id)!;
    if (!verifyPassword(current, row.password_hash)) throw unauthorized('Contraseña actual incorrecta');
    db.run('UPDATE id_users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(next), now(), user.id);
    sendJson(ctx, 200, { data: { message: 'Contraseña actualizada.' } });
  }, { summary: 'Cambia la contraseña del usuario autenticado', tag: 'Identity · Auth', security: [{ bearerAuth: [] }] });

  // ---------- Usuarios ----------
  router.add('GET', `${root}/users`, (ctx) => {
    requirePermission(ctx, 'identity:read');
    const db = dbOf(ctx);
    const app = (ctx as RequestContext).app;
    const allowed = new Set(['page', 'per_page', 'limit', 'offset', 'sort', 'order', 'q', 'status', 'is_admin']);
    for (const key of ctx.query.keys()) {
      if (!allowed.has(key)) throw validationError([{ field: key, message: 'parámetro desconocido' }]);
    }
    const pagination = parsePagination(ctx, app.config.maxPageSize);
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    const status = ctx.query.get('status');
    if (status) {
      if (!['active', 'inactive', 'suspended', 'pending'].includes(status)) throw validationError([{ field: 'status', message: 'valor inválido' }]);
      clauses.push('status = ?');
      params.push(status);
    }
    const isAdmin = ctx.query.get('is_admin');
    if (isAdmin !== null) {
      if (!['true', 'false', '1', '0'].includes(isAdmin)) throw validationError([{ field: 'is_admin', message: 'booleano inválido' }]);
      clauses.push('is_admin = ?');
      params.push(isAdmin === 'true' || isAdmin === '1' ? 1 : 0);
    }
    const q = ctx.query.get('q');
    if (q) {
      clauses.push("(LOWER(email) LIKE LOWER(?) ESCAPE '\\' OR LOWER(display_name) LIKE LOWER(?) ESCAPE '\\')");
      const like = `%${escapeLike(q)}%`;
      params.push(like, like);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const sortParam = ctx.query.get('sort') ?? 'id';
    const sort = sortParam.startsWith('-') ? sortParam.slice(1) : sortParam;
    if (!['id', 'email', 'display_name', 'status', 'created_at'].includes(sort)) {
      throw validationError([{ field: 'sort', message: 'campo no ordenable' }]);
    }
    const orderRaw = ctx.query.get('order');
    if (orderRaw && !['asc', 'desc'].includes(orderRaw)) throw validationError([{ field: 'order', message: 'use asc o desc' }]);
    const direction = (orderRaw ?? (sortParam.startsWith('-') ? 'desc' : 'asc')).toUpperCase();
    const total = Number(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM id_users${where}`, ...params)?.n ?? 0);
    const rows = db.all<Row>(
      `SELECT ${USER_COLUMNS} FROM id_users${where} ORDER BY ${sort} ${direction}, id ASC LIMIT ? OFFSET ?`,
      ...params,
      pagination.perPage,
      pagination.offset,
    );
    sendJson(ctx, 200, { data: rows, meta: paginationMeta(pagination, total) });
  }, { summary: 'Lista usuarios con filtros y paginación', tag: 'Identity · Users', security: [{ bearerAuth: [] }] });

  router.add('GET', `${root}/users/stats`, (ctx) => {
    requirePermission(ctx, 'identity:read');
    const db = dbOf(ctx);
    const byStatus = db.all<{ status: string; total: number }>('SELECT status, COUNT(*) AS total FROM id_users GROUP BY status ORDER BY status');
    sendJson(ctx, 200, { data: { total: db.count('id_users'), by_status: byStatus, admins: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM id_users WHERE is_admin = 1')?.n ?? 0 } });
  }, { summary: 'Estadísticas agregadas de usuarios', tag: 'Identity · Users', security: [{ bearerAuth: [] }] });

  router.add('GET', `${root}/users/:id`, (ctx) => {
    requirePermission(ctx, 'identity:read');
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id) || id <= 0) throw validationError([{ field: 'id', message: 'entero positivo' }]);
    const db = dbOf(ctx);
    const user = publicUser(db, id);
    sendJson(ctx, 200, { data: { ...user, profile: profileOf(db, id), roles: userRoles(db, id) } });
  }, { summary: 'Obtiene un usuario con perfil y roles', tag: 'Identity · Users', security: [{ bearerAuth: [] }] });

  router.add('POST', `${root}/users`, async (ctx) => {
    const actor = requirePermission(ctx, 'identity:write');
    const body = await requestBody(ctx);
    const input = new Validator(body, ['email', 'password', 'display_name', 'status', 'is_admin', 'first_name', 'last_name', 'phone', 'locale', 'timezone']);
    const email = input.string('email', { required: true, email: true, maxLength: 254 })!;
    const password = input.string('password', { required: true, min: 8, maxLength: 200 })!;
    const displayName = input.string('display_name', { required: true, maxLength: 120 })!;
    const status = (input.string('status', { enum: ['active', 'inactive', 'suspended', 'pending'], default: 'active' }) ?? 'active');
    const isAdmin = input.boolean('is_admin', { default: false }) ?? false;
    const firstName = input.string('first_name', { maxLength: 120, default: displayName }) ?? displayName;
    const lastName = input.string('last_name', { maxLength: 120, default: '' }) ?? '';
    const phone = input.string('phone', { nullable: true, maxLength: 40 }) ?? null;
    const locale = input.string('locale', { default: 'es-ES', maxLength: 20 }) ?? 'es-ES';
    const timezone = input.string('timezone', { default: 'Europe/Madrid', maxLength: 60 }) ?? 'Europe/Madrid';
    input.done();
    if (isAdmin && !actor.is_admin) throw forbidden('Solo un administrador puede crear otro administrador');
    const db = dbOf(ctx);
    try {
      const id = db.transaction(() => {
        const userId = db.insert('id_users', {
          email,
          password_hash: hashPassword(password),
          display_name: displayName,
          status,
          is_admin: isAdmin ? 1 : 0,
          created_at: now(),
          updated_at: now(),
        });
        db.insert('id_profiles', {
          user_id: userId,
          first_name: firstName,
          last_name: lastName,
          phone,
          bio: null,
          avatar_url: null,
          birth_date: null,
          locale,
          timezone,
          updated_at: now(),
        });
        db.insert('id_preferences', {
          user_id: userId,
          theme: 'system',
          language: locale.startsWith('es') ? 'es' : 'en',
          notifications: 1,
          newsletter: 0,
          timezone,
          updated_at: now(),
        });
        return userId;
      });
      sendJson(ctx, 201, { data: { ...publicUser(db, id), profile: profileOf(db, id) } }, { Location: `${root}/users/${id}` });
    } catch (error) {
      constraintError(error);
    }
  }, { summary: 'Crea un usuario', tag: 'Identity · Users', security: [{ bearerAuth: [] }] });

  const updateUser = async (ctx: Ctx) => {
    const actor = requirePermission(ctx, 'identity:write');
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id) || id <= 0) throw validationError([{ field: 'id', message: 'entero positivo' }]);
    const db = dbOf(ctx);
    publicUser(db, id);
    const body = await requestBody(ctx);
    const input = new Validator(body, ['email', 'password', 'display_name', 'status', 'is_admin', 'first_name', 'last_name', 'phone', 'locale', 'timezone']);
    const email = input.string('email', { email: true, maxLength: 254 });
    const password = input.string('password', { min: 8, maxLength: 200 });
    const displayName = input.string('display_name', { maxLength: 120, min: 1 });
    const status = input.string('status', { enum: ['active', 'inactive', 'suspended', 'pending'] });
    const isAdmin = input.boolean('is_admin');
    const firstName = input.string('first_name', { maxLength: 120 });
    const lastName = input.string('last_name', { maxLength: 120 });
    const phone = input.string('phone', { nullable: true, maxLength: 40 });
    const locale = input.string('locale', { maxLength: 20 });
    const timezone = input.string('timezone', { maxLength: 60 });
    input.done();
    if (isAdmin !== undefined && !actor.is_admin) throw forbidden('Solo un administrador puede cambiar is_admin');
    const fields: string[] = [];
    const params: Array<string | number | null> = [];
    if (email !== undefined) { fields.push('email = ?'); params.push(email); }
    if (password !== undefined) { fields.push('password_hash = ?'); params.push(hashPassword(password)); }
    if (displayName !== undefined) { fields.push('display_name = ?'); params.push(displayName); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }
    if (isAdmin !== undefined) { fields.push('is_admin = ?'); params.push(isAdmin ? 1 : 0); }
    fields.push('updated_at = ?'); params.push(now());
    try {
      db.run(`UPDATE id_users SET ${fields.join(', ')} WHERE id = ?`, ...params, id);
      const profileFields: string[] = [];
      const profileParams: Array<string | number | null> = [];
      if (firstName !== undefined) { profileFields.push('first_name = ?'); profileParams.push(firstName); }
      if (lastName !== undefined) { profileFields.push('last_name = ?'); profileParams.push(lastName); }
      if (phone !== undefined) { profileFields.push('phone = ?'); profileParams.push(phone); }
      if (locale !== undefined) { profileFields.push('locale = ?'); profileParams.push(locale); }
      if (timezone !== undefined) { profileFields.push('timezone = ?'); profileParams.push(timezone); }
      if (profileFields.length) {
        profileFields.push('updated_at = ?'); profileParams.push(now());
        db.run(`UPDATE id_profiles SET ${profileFields.join(', ')} WHERE user_id = ?`, ...profileParams, id);
      }
      const created = publicUser(db, id);
      sendJson(ctx, 200, { data: { ...created, profile: profileOf(db, id) } });
    } catch (error) {
      constraintError(error);
    }
  };
  router.add('PUT', `${root}/users/:id`, updateUser, { summary: 'Actualiza un usuario', tag: 'Identity · Users', security: [{ bearerAuth: [] }] });
  router.add('PATCH', `${root}/users/:id`, updateUser, { summary: 'Actualiza parcialmente un usuario', tag: 'Identity · Users', security: [{ bearerAuth: [] }] });

  router.add('DELETE', `${root}/users/:id`, (ctx) => {
    const actor = requirePermission(ctx, 'identity:write');
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id) || id <= 0) throw validationError([{ field: 'id', message: 'entero positivo' }]);
    if (id === actor.id) throw conflict('No se puede eliminar el usuario autenticado');
    const db = dbOf(ctx);
    try {
      const result = db.run('DELETE FROM id_users WHERE id = ?', id);
      if (result.changes === 0) throw notFound('Usuario no encontrado');
      ctx.res.statusCode = 204;
      ctx.res.end();
    } catch (error) {
      constraintError(error);
    }
  }, { summary: 'Elimina un usuario', tag: 'Identity · Users', security: [{ bearerAuth: [] }] });

  // ---------- Perfil ----------
  router.add('GET', `${root}/users/:id/profile`, (ctx) => {
    requirePermission(ctx, 'identity:read');
    const id = Number(ctx.params.id);
    const db = dbOf(ctx);
    publicUser(db, id);
    const profile = profileOf(db, id);
    if (!profile) throw notFound('Perfil no encontrado');
    sendJson(ctx, 200, { data: profile });
  }, { summary: 'Obtiene el perfil de un usuario', tag: 'Identity · Profiles', security: [{ bearerAuth: [] }] });

  const saveProfile = async (ctx: Ctx) => {
    const actor = requireUser(ctx);
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id) || id <= 0) throw validationError([{ field: 'id', message: 'entero positivo' }]);
    if (actor.id !== id && !actor.is_admin) {
      const db = dbOf(ctx);
      const canWrite = effectivePermissionCodes(db, actor.id, actor.is_admin).includes('identity:write');
      if (!canWrite) throw forbidden('No puede editar el perfil de otro usuario');
    }
    const db = dbOf(ctx);
    publicUser(db, id);
    const body = await requestBody(ctx);
    const input = new Validator(body, ['first_name', 'last_name', 'phone', 'bio', 'avatar_url', 'birth_date', 'locale', 'timezone']);
    const firstName = input.string('first_name', { maxLength: 120 });
    const lastName = input.string('last_name', { maxLength: 120 });
    const phone = input.string('phone', { nullable: true, maxLength: 40 });
    const bio = input.string('bio', { nullable: true, maxLength: 20_000 });
    const avatarUrl = input.string('avatar_url', { nullable: true, maxLength: 2000 });
    const birthDate = input.date('birth_date', { nullable: true });
    const locale = input.string('locale', { maxLength: 20 });
    const timezone = input.string('timezone', { maxLength: 60 });
    input.done();
    const existing = profileOf(db, id);
    if (!existing) {
      if (!firstName || !lastName) throw validationError([{ field: 'first_name', message: 'obligatorio al crear el perfil' }]);
      db.insert('id_profiles', {
        user_id: id,
        first_name: firstName,
        last_name: lastName,
        phone: phone ?? null,
        bio: bio ?? null,
        avatar_url: avatarUrl ?? null,
        birth_date: birthDate ?? null,
        locale: locale ?? 'es-ES',
        timezone: timezone ?? 'Europe/Madrid',
        updated_at: now(),
      });
    } else {
      const fields: string[] = [];
      const params: Array<string | number | null> = [];
      if (firstName !== undefined) { fields.push('first_name = ?'); params.push(firstName); }
      if (lastName !== undefined) { fields.push('last_name = ?'); params.push(lastName); }
      if (phone !== undefined) { fields.push('phone = ?'); params.push(phone); }
      if (bio !== undefined) { fields.push('bio = ?'); params.push(bio); }
      if (avatarUrl !== undefined) { fields.push('avatar_url = ?'); params.push(avatarUrl); }
      if (birthDate !== undefined) { fields.push('birth_date = ?'); params.push(birthDate); }
      if (locale !== undefined) { fields.push('locale = ?'); params.push(locale); }
      if (timezone !== undefined) { fields.push('timezone = ?'); params.push(timezone); }
      if (fields.length === 0) {
        sendJson(ctx, 200, { data: existing });
        return;
      }
      fields.push('updated_at = ?'); params.push(now());
      db.run(`UPDATE id_profiles SET ${fields.join(', ')} WHERE user_id = ?`, ...params, id);
    }
    sendJson(ctx, 200, { data: profileOf(db, id) });
  };
  router.add('PUT', `${root}/users/:id/profile`, saveProfile, { summary: 'Crea o reemplaza el perfil', tag: 'Identity · Profiles' });
  router.add('PATCH', `${root}/users/:id/profile`, saveProfile, { summary: 'Actualiza el perfil', tag: 'Identity · Profiles' });

  // ---------- Preferencias ----------
  router.add('GET', `${root}/users/:id/preferences`, (ctx) => {
    requirePermission(ctx, 'identity:read');
    const id = Number(ctx.params.id);
    const db = dbOf(ctx);
    publicUser(db, id);
    const row = db.get<Row>('SELECT * FROM id_preferences WHERE user_id = ?', id);
    if (!row) throw notFound('Preferencias no encontradas');
    sendJson(ctx, 200, { data: row });
  }, { summary: 'Obtiene preferencias de usuario', tag: 'Identity · Preferences', security: [{ bearerAuth: [] }] });

  router.add('PUT', `${root}/users/:id/preferences`, async (ctx) => {
    requirePermission(ctx, 'identity:write');
    const id = Number(ctx.params.id);
    const db = dbOf(ctx);
    publicUser(db, id);
    const body = await requestBody(ctx);
    const input = new Validator(body, ['theme', 'language', 'notifications', 'newsletter', 'timezone']);
    const theme = input.string('theme', { enum: ['light', 'dark', 'system'] });
    const language = input.string('language', { maxLength: 10 });
    const notifications = input.boolean('notifications');
    const newsletter = input.boolean('newsletter');
    const timezone = input.string('timezone', { maxLength: 60 });
    input.done();
    const existing = db.get<{ theme: string; language: string; notifications: number; newsletter: number; timezone: string }>(
      'SELECT theme, language, notifications, newsletter, timezone FROM id_preferences WHERE user_id = ?',
      id,
    );
    if (!existing) {
      db.insert('id_preferences', {
        user_id: id,
        theme: theme ?? 'system',
        language: language ?? 'es',
        notifications: notifications === false ? 0 : 1,
        newsletter: newsletter === true ? 1 : 0,
        timezone: timezone ?? 'Europe/Madrid',
        updated_at: now(),
      });
    } else {
      db.run(
        `UPDATE id_preferences SET theme = ?, language = ?, notifications = ?, newsletter = ?, timezone = ?, updated_at = ? WHERE user_id = ?`,
        theme ?? existing.theme,
        language ?? existing.language,
        notifications === undefined ? existing.notifications : notifications ? 1 : 0,
        newsletter === undefined ? existing.newsletter : newsletter ? 1 : 0,
        timezone ?? existing.timezone,
        now(),
        id,
      );
    }
    sendJson(ctx, 200, { data: db.get<Row>('SELECT * FROM id_preferences WHERE user_id = ?', id) });
  }, { summary: 'Actualiza preferencias de usuario', tag: 'Identity · Preferences', security: [{ bearerAuth: [] }] });

  // ---------- Roles de usuario ----------
  router.add('GET', `${root}/users/:id/roles`, (ctx) => {
    requirePermission(ctx, 'identity:read');
    const id = Number(ctx.params.id);
    const db = dbOf(ctx);
    publicUser(db, id);
    sendJson(ctx, 200, { data: userRoles(db, id) });
  }, { summary: 'Lista roles de un usuario', tag: 'Identity · RBAC', security: [{ bearerAuth: [] }] });

  router.add('POST', `${root}/users/:id/roles`, async (ctx) => {
    requirePermission(ctx, 'identity:write');
    const id = Number(ctx.params.id);
    const db = dbOf(ctx);
    publicUser(db, id);
    const body = await requestBody(ctx);
    const input = new Validator(body, ['role_id', 'role']);
    const roleId = input.integer('role_id', { min: 1 });
    const roleName = input.string('role', { maxLength: 60 });
    input.done();
    if (!roleId && !roleName) throw validationError([{ field: 'role_id', message: 'role_id o role es obligatorio' }]);
    const role = roleId
      ? db.get<Row>('SELECT * FROM id_roles WHERE id = ?', roleId)
      : db.get<Row>('SELECT * FROM id_roles WHERE name = ?', roleName!);
    if (!role) throw notFound('Rol no encontrado');
    try {
      db.insert('id_user_roles', { user_id: id, role_id: Number(role.id), assigned_at: now() });
    } catch (error) {
      constraintError(error);
    }
    sendJson(ctx, 201, { data: { user_id: id, role: { id: role.id, name: role.name } } });
  }, { summary: 'Asigna un rol a un usuario', tag: 'Identity · RBAC', security: [{ bearerAuth: [] }] });

  router.add('DELETE', `${root}/users/:id/roles/:roleId`, (ctx) => {
    requirePermission(ctx, 'identity:write');
    const db = dbOf(ctx);
    const result = db.run('DELETE FROM id_user_roles WHERE user_id = ? AND role_id = ?', Number(ctx.params.id), Number(ctx.params.roleId));
    if (result.changes === 0) throw notFound('Asignación de rol no encontrada');
    ctx.res.statusCode = 204;
    ctx.res.end();
  }, { summary: 'Quita un rol a un usuario', tag: 'Identity · RBAC', security: [{ bearerAuth: [] }] });

  router.add('GET', `${root}/users/:id/permissions`, (ctx) => {
    requirePermission(ctx, 'identity:read');
    const id = Number(ctx.params.id);
    const db = dbOf(ctx);
    const user = publicUser(db, id);
    sendJson(ctx, 200, {
      data: {
        user_id: id,
        is_admin: Boolean(user.is_admin),
        roles: userRoles(db, id),
        permissions: permissionsForUser(db, id, Number(user.is_admin)),
      },
    });
  }, { summary: 'Consulta permisos efectivos de un usuario', tag: 'Identity · RBAC', security: [{ bearerAuth: [] }] });

  // ---------- Roles / permisos (CRUD) ----------
  const rolesResource: ResourceDef = {
    table: 'id_roles',
    path: 'roles',
    tag: 'Identity · RBAC',
    singular: 'rol',
    fields: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', required: true, maxLength: 60 },
      description: { type: 'string', nullable: true, maxLength: 2000 },
      created_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    search: ['name', 'description'],
    updatedAt: false,
    defaults: { created_at: now },
    authorize: authz(),
  };
  registerResource(router, root, rolesResource);

  registerResource(router, root, {
    table: 'id_permissions',
    path: 'permissions',
    tag: 'Identity · RBAC',
    singular: 'permiso',
    fields: {
      id: { type: 'integer', readOnly: true },
      code: { type: 'string', required: true, maxLength: 80 },
      description: { type: 'string', nullable: true, maxLength: 1000 },
      resource: { type: 'string', required: true, maxLength: 60 },
      action: { type: 'string', required: true, enum: ['read', 'write', 'delete', 'admin'] },
    },
    defaultSort: 'code',
    search: ['code', 'description'],
    updatedAt: false,
    authorize: authz(),
  });

  router.add('GET', `${root}/roles/:id/permissions`, (ctx) => {
    requirePermission(ctx, 'identity:read');
    const id = Number(ctx.params.id);
    const db = dbOf(ctx);
    if (!db.get('SELECT 1 AS x FROM id_roles WHERE id = ?', id)) throw notFound('Rol no encontrado');
    const rows = db.all<Row>(
      `SELECT p.* FROM id_permissions p JOIN id_role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = ? ORDER BY p.code`,
      id,
    );
    sendJson(ctx, 200, { data: rows });
  }, { summary: 'Lista permisos de un rol', tag: 'Identity · RBAC', security: [{ bearerAuth: [] }] });

  router.add('POST', `${root}/roles/:id/permissions`, async (ctx) => {
    requirePermission(ctx, 'identity:write');
    const roleId = Number(ctx.params.id);
    const db = dbOf(ctx);
    if (!db.get('SELECT 1 AS x FROM id_roles WHERE id = ?', roleId)) throw notFound('Rol no encontrado');
    const body = await requestBody(ctx);
    const input = new Validator(body, ['permission_id', 'code']);
    const permissionId = input.integer('permission_id', { min: 1 });
    const code = input.string('code', { maxLength: 80 });
    input.done();
    const permission = permissionId
      ? db.get<Row>('SELECT * FROM id_permissions WHERE id = ?', permissionId)
      : code ? db.get<Row>('SELECT * FROM id_permissions WHERE code = ?', code) : undefined;
    if (!permission) throw notFound('Permiso no encontrado');
    try {
      db.insert('id_role_permissions', { role_id: roleId, permission_id: Number(permission.id) });
    } catch (error) {
      constraintError(error);
    }
    sendJson(ctx, 201, { data: { role_id: roleId, permission } });
  }, { summary: 'Añade un permiso a un rol', tag: 'Identity · RBAC', security: [{ bearerAuth: [] }] });

  router.add('DELETE', `${root}/roles/:id/permissions/:permissionId`, (ctx) => {
    requirePermission(ctx, 'identity:write');
    const db = dbOf(ctx);
    const result = db.run('DELETE FROM id_role_permissions WHERE role_id = ? AND permission_id = ?', Number(ctx.params.id), Number(ctx.params.permissionId));
    if (result.changes === 0) throw notFound('Permiso del rol no encontrado');
    ctx.res.statusCode = 204;
    ctx.res.end();
  }, { summary: 'Quita un permiso a un rol', tag: 'Identity · RBAC', security: [{ bearerAuth: [] }] });

  // ---------- Grupos ----------
  registerResource(router, root, {
    table: 'id_groups',
    path: 'groups',
    tag: 'Identity · Groups',
    singular: 'grupo',
    fields: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', required: true, maxLength: 100 },
      description: { type: 'string', nullable: true, maxLength: 2000 },
      created_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    search: ['name', 'description'],
    updatedAt: false,
    defaults: { created_at: now },
    authorize: authz(),
  });

  router.add('GET', `${root}/groups/:id/members`, (ctx) => {
    requirePermission(ctx, 'identity:read');
    const id = Number(ctx.params.id);
    const db = dbOf(ctx);
    if (!db.get('SELECT 1 AS x FROM id_groups WHERE id = ?', id)) throw notFound('Grupo no encontrado');
    const rows = db.all<Row>(
      `SELECT gm.id, gm.group_id, gm.user_id, gm.member_role, gm.joined_at,
              u.email, u.display_name, u.status
       FROM id_group_members gm JOIN id_users u ON u.id = gm.user_id
       WHERE gm.group_id = ? ORDER BY gm.id`,
      id,
    );
    sendJson(ctx, 200, { data: rows });
  }, { summary: 'Lista miembros de un grupo', tag: 'Identity · Groups', security: [{ bearerAuth: [] }] });

  router.add('POST', `${root}/groups/:id/members`, async (ctx) => {
    requirePermission(ctx, 'identity:write');
    const groupId = Number(ctx.params.id);
    const db = dbOf(ctx);
    if (!db.get('SELECT 1 AS x FROM id_groups WHERE id = ?', groupId)) throw notFound('Grupo no encontrado');
    const body = await requestBody(ctx);
    const input = new Validator(body, ['user_id', 'member_role']);
    const userId = input.integer('user_id', { required: true, min: 1 })!;
    const role = (input.string('member_role', { enum: ['owner', 'member'], default: 'member' }) ?? 'member');
    input.done();
    if (!db.get('SELECT 1 AS x FROM id_users WHERE id = ?', userId)) throw notFound('Usuario no encontrado');
    try {
      const id = db.insert('id_group_members', { group_id: groupId, user_id: userId, member_role: role, joined_at: now() });
      sendJson(ctx, 201, { data: { id, group_id: groupId, user_id: userId, member_role: role } });
    } catch (error) {
      constraintError(error);
    }
  }, { summary: 'Añade un miembro a un grupo', tag: 'Identity · Groups', security: [{ bearerAuth: [] }] });

  router.add('DELETE', `${root}/groups/:id/members/:userId`, (ctx) => {
    requirePermission(ctx, 'identity:write');
    const db = dbOf(ctx);
    const result = db.run('DELETE FROM id_group_members WHERE group_id = ? AND user_id = ?', Number(ctx.params.id), Number(ctx.params.userId));
    if (result.changes === 0) throw notFound('Miembro no encontrado');
    ctx.res.statusCode = 204;
    ctx.res.end();
  }, { summary: 'Quita un miembro de un grupo', tag: 'Identity · Groups', security: [{ bearerAuth: [] }] });

  // ---------- Direcciones ----------
  router.add('GET', `${root}/users/:id/addresses`, (ctx) => {
    requirePermission(ctx, 'identity:read');
    const userId = Number(ctx.params.id);
    const db = dbOf(ctx);
    publicUser(db, userId);
    const rows = db.all<Row>('SELECT * FROM id_addresses WHERE user_id = ? ORDER BY is_default DESC, id ASC', userId);
    sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
  }, { summary: 'Lista direcciones de un usuario', tag: 'Identity · Addresses', security: [{ bearerAuth: [] }] });

  router.add('POST', `${root}/users/:id/addresses`, async (ctx) => {
    requirePermission(ctx, 'identity:write');
    const userId = Number(ctx.params.id);
    const db = dbOf(ctx);
    publicUser(db, userId);
    const body = await requestBody(ctx);
    const input = new Validator(body, ['label', 'line1', 'line2', 'city', 'region', 'postal_code', 'country', 'is_default']);
    const label = input.string('label', { required: true, maxLength: 60 })!;
    const line1 = input.string('line1', { required: true, maxLength: 200 })!;
    const line2 = input.string('line2', { nullable: true, maxLength: 200 }) ?? null;
    const city = input.string('city', { required: true, maxLength: 100 })!;
    const region = input.string('region', { nullable: true, maxLength: 100 }) ?? null;
    const postalCode = input.string('postal_code', { required: true, maxLength: 20 })!;
    const country = input.string('country', { maxLength: 2, default: 'ES' }) ?? 'ES';
    const isDefault = input.boolean('is_default', { default: false }) ?? false;
    input.done();
    try {
      const id = db.transaction(() => {
        if (isDefault) db.run('UPDATE id_addresses SET is_default = 0 WHERE user_id = ?', userId);
        return db.insert('id_addresses', {
          user_id: userId, label, line1, line2, city, region, postal_code: postalCode,
          country, is_default: isDefault ? 1 : 0, created_at: now(),
        });
      });
      sendJson(ctx, 201, { data: db.get<Row>('SELECT * FROM id_addresses WHERE id = ?', id) });
    } catch (error) {
      constraintError(error);
    }
  }, { summary: 'Añade una dirección a un usuario', tag: 'Identity · Addresses', security: [{ bearerAuth: [] }] });

  registerResource(router, root, {
    table: 'id_addresses',
    path: 'addresses',
    tag: 'Identity · Addresses',
    singular: 'dirección',
    fields: {
      id: { type: 'integer', readOnly: true },
      user_id: { type: 'integer', required: true, min: 1 },
      label: { type: 'string', required: true, maxLength: 60 },
      line1: { type: 'string', required: true, maxLength: 200 },
      line2: { type: 'string', nullable: true, maxLength: 200 },
      city: { type: 'string', required: true, maxLength: 100 },
      region: { type: 'string', nullable: true, maxLength: 100 },
      postal_code: { type: 'string', required: true, maxLength: 20 },
      country: { type: 'string', maxLength: 2 },
      is_default: { type: 'boolean' },
      created_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    updatedAt: false,
    defaults: { created_at: now },
    authorize: authz(),
  });

  // ---------- Sesiones ----------
  router.add('GET', `${root}/sessions`, (ctx) => {
    requirePermission(ctx, 'identity:write');
    const db = dbOf(ctx);
    const userId = ctx.query.get('user_id');
    const rows = userId
      ? db.all<Row>('SELECT id, user_id, user_agent, ip, created_at, expires_at, revoked_at FROM id_sessions WHERE user_id = ? ORDER BY id DESC', Number(userId))
      : db.all<Row>('SELECT id, user_id, user_agent, ip, created_at, expires_at, revoked_at FROM id_sessions ORDER BY id DESC LIMIT 200');
    sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
  }, { summary: 'Lista sesiones (sin hashes)', tag: 'Identity · Sessions', security: [{ bearerAuth: [] }] });

  router.add('DELETE', `${root}/sessions/:id`, (ctx) => {
    const actor = requireUser(ctx);
    const db = dbOf(ctx);
    const session = db.get<Row>('SELECT * FROM id_sessions WHERE id = ?', Number(ctx.params.id));
    if (!session) throw notFound('Sesión no encontrada');
    if (Number(session.user_id) !== actor.id && !actor.is_admin) throw forbidden('No puede revocar sesiones de otro usuario');
    db.run('UPDATE id_sessions SET revoked_at = ? WHERE id = ?', now(), Number(session.id));
    ctx.res.statusCode = 204;
    ctx.res.end();
  }, { summary: 'Revoca una sesión', tag: 'Identity · Sessions', security: [{ bearerAuth: [] }] });

  // ---------- Tokens ----------
  router.add('GET', `${root}/tokens`, (ctx) => {
    requirePermission(ctx, 'identity:write');
    const db = dbOf(ctx);
    const rows = db.all<Row>('SELECT id, user_id, kind, label, scopes, created_at, expires_at, revoked_at, last_used_at FROM id_tokens ORDER BY id DESC LIMIT 200');
    sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
  }, { summary: 'Lista tokens emitidos (sin hashes)', tag: 'Identity · Tokens', security: [{ bearerAuth: [] }] });

  router.add('POST', `${root}/tokens`, async (ctx) => {
    const user = requireUser(ctx);
    const body = await requestBody(ctx);
    const input = new Validator(body, ['label', 'expires_in_days', 'scopes']);
    const label = input.string('label', { maxLength: 120, default: 'api-token' }) ?? 'api-token';
    const days = input.integer('expires_in_days', { min: 1, max: 3650, default: 30 }) ?? 30;
    const scopes = input.array('scopes');
    input.done();
    const token = opaque('mtok');
    const db = dbOf(ctx);
    const id = db.insert('id_tokens', {
      user_id: user.id,
      kind: 'api',
      token_hash: hashToken(token),
      label,
      scopes: scopes ? JSON.stringify(scopes) : null,
      created_at: now(),
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      revoked_at: null,
      last_used_at: null,
    });
    sendJson(ctx, 201, {
      data: {
        id,
        token,
        token_type: 'Bearer',
        note: 'El token en claro solo se devuelve en esta respuesta.',
        expires_in_days: days,
      },
    });
  }, { summary: 'Emite un token API para el usuario autenticado', tag: 'Identity · Tokens', security: [{ bearerAuth: [] }] });

  router.add('DELETE', `${root}/tokens/:id`, (ctx) => {
    const actor = requireUser(ctx);
    const db = dbOf(ctx);
    const token = db.get<Row>('SELECT * FROM id_tokens WHERE id = ?', Number(ctx.params.id));
    if (!token) throw notFound('Token no encontrado');
    if (Number(token.user_id) !== actor.id && !actor.is_admin) throw forbidden('No puede revocar tokens de otro usuario');
    db.run('UPDATE id_tokens SET revoked_at = ? WHERE id = ?', now(), Number(token.id));
    ctx.res.statusCode = 204;
    ctx.res.end();
  }, { summary: 'Revoca un token', tag: 'Identity · Tokens', security: [{ bearerAuth: [] }] });

  // ---------- API keys ----------
  router.add('GET', `${root}/api-keys`, (ctx) => {
    requirePermission(ctx, 'identity:write');
    const db = dbOf(ctx);
    const rows = db.all<Row>('SELECT id, user_id, name, prefix, scopes, created_at, expires_at, last_used_at, revoked_at FROM id_api_keys ORDER BY id DESC LIMIT 200');
    sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
  }, { summary: 'Lista API keys (sin hash)', tag: 'Identity · API Keys', security: [{ bearerAuth: [] }] });

  router.add('POST', `${root}/api-keys`, async (ctx) => {
    const user = requireUser(ctx);
    const body = await requestBody(ctx);
    const input = new Validator(body, ['name', 'scopes', 'expires_in_days']);
    const name = input.string('name', { required: true, maxLength: 120 })!;
    const days = input.integer('expires_in_days', { min: 1, max: 3650, default: 90 }) ?? 90;
    const scopes = input.array('scopes');
    input.done();
    const prefix = `msim_${randomBytes(4).toString('hex')}`;
    const raw = `${prefix}.${randomBytes(24).toString('base64url')}`;
    const db = dbOf(ctx);
    const id = db.insert('id_api_keys', {
      user_id: user.id,
      name,
      prefix,
      key_hash: hashToken(raw),
      scopes: scopes ? JSON.stringify(scopes) : null,
      created_at: now(),
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      last_used_at: null,
      revoked_at: null,
    });
    sendJson(ctx, 201, {
      data: { id, name, prefix, api_key: raw, note: 'La API key en claro solo se devuelve una vez.', expires_in_days: days },
    }, { 'Cache-Control': 'no-store' });
  }, { summary: 'Crea una API key para el usuario autenticado', tag: 'Identity · API Keys', security: [{ bearerAuth: [] }] });

  router.add('DELETE', `${root}/api-keys/:id`, (ctx) => {
    const actor = requireUser(ctx);
    const db = dbOf(ctx);
    const key = db.get<Row>('SELECT * FROM id_api_keys WHERE id = ?', Number(ctx.params.id));
    if (!key) throw notFound('API key no encontrada');
    if (Number(key.user_id) !== actor.id && !actor.is_admin) throw forbidden('No puede revocar API keys de otro usuario');
    db.run('UPDATE id_api_keys SET revoked_at = ? WHERE id = ?', now(), Number(key.id));
    ctx.res.statusCode = 204;
    ctx.res.end();
  }, { summary: 'Revoca una API key', tag: 'Identity · API Keys', security: [{ bearerAuth: [] }] });

  // Endpoint de diagnóstico de autenticación con API key / Bearer para pruebas explícitas.
  router.add('GET', `${root}/auth/verify`, (ctx) => {
    const user = resolveUser(ctx);
    if (!user) throw unauthorized('No se presentaron credenciales');
    sendJson(ctx, 200, { data: { authenticated: true, user: publicUser(dbOf(ctx), user.id) } });
  }, { summary: 'Verifica credenciales Bearer o X-API-Key', tag: 'Identity · Auth' });
}
