/**
 * @file Projects domain: teams, projects, tasks, labels and activity.
 *
 * Status changes and creation of nested tasks are transactional and emit
 * activity entries. List filtering is explicit to keep aggregate/stat queries
 * predictable instead of exposing arbitrary columns.
 */
import type { Router } from '../http/router.js';
import type { Ctx } from '../http/router.js';
import type { RequestContext } from '../http/index.js';
import { readJsonBody, sendJson } from '../http/index.js';
import { conflict, notFound, validationError } from '../core/errors.js';
import { registerResource } from '../http/resource.js';
import { Validator } from '../core/validate.js';
import { escapeLike, paginationMeta, parsePagination } from '../http/query.js';

const now = () => new Date().toISOString();

function dbOf(ctx: Ctx) {
  return (ctx as RequestContext).app.db;
}

function projectOrThrow(ctx: Ctx, id: number) {
  const row = dbOf(ctx).get('SELECT * FROM pr_projects WHERE id = ?', id);
  if (!row) throw notFound('Proyecto no encontrado');
  return row;
}

function resolveStatus(db: ReturnType<typeof dbOf>, rawId: unknown, rawName: unknown, fallback = 2) {
  if (typeof rawId === 'number') {
    const row = db.get<Record<string, unknown>>('SELECT * FROM pr_statuses WHERE id = ?', rawId);
    if (!row) throw notFound('Estado no encontrado');
    return row;
  }
  if (typeof rawName === 'string') {
    const row = db.get<Record<string, unknown>>(
      'SELECT * FROM pr_statuses WHERE name = ? OR category = ? ORDER BY id LIMIT 1',
      rawName,
      rawName,
    );
    if (!row) throw notFound('Estado no encontrado');
    return row;
  }
  const row = db.get<Record<string, unknown>>('SELECT * FROM pr_statuses WHERE id = ?', fallback);
  if (!row) throw notFound('Estado no encontrado');
  return row;
}

function taskDetails(ctx: Ctx, taskId: number) {
  const db = dbOf(ctx);
  const task = db.get<Record<string, unknown>>(
    `SELECT t.*, s.name AS status_name, s.category AS status_category, u.display_name AS assignee_name
     FROM pr_tasks t
     JOIN pr_statuses s ON s.id = t.status_id
     LEFT JOIN id_users u ON u.id = t.assignee_id
     WHERE t.id = ?`,
    taskId,
  );
  if (!task) throw notFound('Tarea no encontrada');
  const labels = db.all(
    `SELECT l.id, l.name, l.color FROM pr_labels l JOIN pr_task_labels tl ON tl.label_id = l.id WHERE tl.task_id = ? ORDER BY l.name`,
    taskId,
  );
  const comments = db.all(
    `SELECT c.*, u.display_name AS author_name FROM pr_comments c LEFT JOIN id_users u ON u.id = c.author_id
     WHERE c.task_id = ? ORDER BY c.created_at ASC`,
    taskId,
  );
  const subtasks = db.all(
    `SELECT t.id, t.title, t.status_id, s.name AS status_name, t.assignee_id, t.priority, t.completed_at
     FROM pr_tasks t JOIN pr_statuses s ON s.id = t.status_id WHERE t.parent_id = ? ORDER BY t.id`,
    taskId,
  );
  const attachments = db.all('SELECT * FROM pr_attachments WHERE task_id = ? ORDER BY id', taskId);
  return { ...task, labels, comments, subtasks, attachments };
}

function logActivity(ctx: Ctx, projectId: number, taskId: number | null, action: string, detail: string, actorId = 1) {
  dbOf(ctx).insert('pr_activities', {
    project_id: projectId,
    task_id: taskId,
    actor_id: actorId,
    action,
    detail,
    created_at: now(),
  });
}

/** Registers `/api/v1/projects` CRUD plus task/member/activity operations. */
export function registerProjectRoutes(router: Router, base: string): void {
  const root = `${base}/projects`;

  registerResource(router, root, {
    table: 'pr_teams',
    path: 'teams',
    tag: 'Projects · Teams',
    singular: 'equipo',
    fields: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', required: true, maxLength: 120 },
      description: { type: 'string', nullable: true, maxLength: 4000 },
      created_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    search: ['name', 'description'],
    updatedAt: false,
    defaults: { created_at: now },
  });

  registerResource(router, root, {
    table: 'pr_team_members',
    path: 'team-members',
    tag: 'Projects · Teams',
    singular: 'miembro de equipo',
    fields: {
      id: { type: 'integer', readOnly: true },
      team_id: { type: 'integer', required: true, min: 1 },
      user_id: { type: 'integer', required: true, min: 1 },
      member_role: { type: 'string', enum: ['lead', 'member'] },
      joined_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    updatedAt: false,
    defaults: { joined_at: now },
  });

  registerResource(router, root, {
    table: 'pr_projects',
    path: 'projects',
    tag: 'Projects · Projects',
    singular: 'proyecto',
    fields: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', required: true, maxLength: 200 },
      project_key: { type: 'string', required: true, maxLength: 30 },
      description: { type: 'string', nullable: true, maxLength: 20_000 },
      status: { type: 'string', enum: ['planning', 'active', 'on_hold', 'completed', 'archived'] },
      owner_id: { type: 'integer', nullable: true, min: 1 },
      team_id: { type: 'integer', nullable: true, min: 1 },
      start_date: { type: 'date', nullable: true },
      due_date: { type: 'date', nullable: true },
      budget_cents: { type: 'integer', min: 0 },
      created_at: { type: 'datetime', readOnly: true },
      updated_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    search: ['name', 'description', 'project_key'],
    defaults: { created_at: now, updated_at: now },
  });

  registerResource(router, root, {
    table: 'pr_project_members',
    path: 'project-members',
    tag: 'Projects · Projects',
    singular: 'miembro de proyecto',
    fields: {
      id: { type: 'integer', readOnly: true },
      project_id: { type: 'integer', required: true, min: 1 },
      user_id: { type: 'integer', required: true, min: 1 },
      member_role: { type: 'string', enum: ['owner', 'manager', 'member', 'viewer'] },
      added_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    updatedAt: false,
    defaults: { added_at: now },
  });

  registerResource(router, root, {
    table: 'pr_statuses',
    path: 'statuses',
    tag: 'Projects · Tasks',
    singular: 'estado',
    fields: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', required: true, maxLength: 60 },
      category: { type: 'string', required: true, enum: ['todo', 'in_progress', 'done', 'blocked'] },
      sort_order: { type: 'integer' },
    },
    defaultSort: 'sort_order',
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'pr_tasks',
    path: 'tasks',
    tag: 'Projects · Tasks',
    singular: 'tarea',
    fields: {
      id: { type: 'integer', readOnly: true },
      project_id: { type: 'integer', required: true, min: 1 },
      parent_id: { type: 'integer', nullable: true, min: 1 },
      title: { type: 'string', required: true, maxLength: 300 },
      description: { type: 'string', nullable: true, maxLength: 30_000 },
      status_id: { type: 'integer', required: true, min: 1 },
      assignee_id: { type: 'integer', nullable: true, min: 1 },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      due_date: { type: 'date', nullable: true },
      estimate_minutes: { type: 'integer', nullable: true, min: 0 },
      position: { type: 'integer' },
      created_at: { type: 'datetime', readOnly: true },
      updated_at: { type: 'datetime', readOnly: true },
      completed_at: { type: 'datetime', nullable: true },
    },
    defaultSort: 'id',
    search: ['title', 'description'],
    defaults: { created_at: now, updated_at: now },
  });

  registerResource(router, root, {
    table: 'pr_comments',
    path: 'comments',
    tag: 'Projects · Tasks',
    singular: 'comentario',
    fields: {
      id: { type: 'integer', readOnly: true },
      task_id: { type: 'integer', required: true, min: 1 },
      author_id: { type: 'integer', required: true, min: 1 },
      body: { type: 'string', required: true, maxLength: 20_000 },
      created_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    updatedAt: false,
    defaults: { created_at: now },
  });

  registerResource(router, root, {
    table: 'pr_labels',
    path: 'labels',
    tag: 'Projects · Tasks',
    singular: 'etiqueta',
    fields: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', required: true, maxLength: 60 },
      color: { type: 'string', maxLength: 7, pattern: /^#[0-9a-fA-F]{6}$/ },
    },
    defaultSort: 'id',
    search: ['name'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'pr_task_labels',
    path: 'task-labels',
    tag: 'Projects · Tasks',
    singular: 'etiqueta de tarea',
    fields: {
      id: { type: 'integer', readOnly: true },
      task_id: { type: 'integer', required: true, min: 1 },
      label_id: { type: 'integer', required: true, min: 1 },
    },
    defaultSort: 'id',
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'pr_attachments',
    path: 'attachments',
    tag: 'Projects · Tasks',
    singular: 'adjunto',
    fields: {
      id: { type: 'integer', readOnly: true },
      task_id: { type: 'integer', required: true, min: 1 },
      filename: { type: 'string', required: true, maxLength: 300 },
      mime_type: { type: 'string', required: true, maxLength: 120 },
      size_bytes: { type: 'integer', required: true, min: 0 },
      storage_path: { type: 'string', required: true, maxLength: 500 },
      uploaded_by: { type: 'integer', nullable: true, min: 1 },
      created_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    updatedAt: false,
    defaults: { created_at: now },
  });

  registerResource(router, root, {
    table: 'pr_activities',
    path: 'activities',
    tag: 'Projects · Activity',
    singular: 'actividad',
    fields: {
      id: { type: 'integer', readOnly: true },
      project_id: { type: 'integer', required: true, min: 1 },
      task_id: { type: 'integer', nullable: true, min: 1 },
      actor_id: { type: 'integer', nullable: true, min: 1 },
      action: { type: 'string', required: true, maxLength: 60 },
      detail: { type: 'string', nullable: true, maxLength: 4000 },
      created_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    updatedAt: false,
    defaults: { created_at: now },
    allowDelete: false,
  });

  // ---------- Tareas por proyecto ----------
  router.add(
    'GET',
    `${root}/projects/:id/tasks`,
    (ctx) => {
      const projectId = Number(ctx.params.id);
      projectOrThrow(ctx, projectId);
      const db = dbOf(ctx);
      const app = (ctx as RequestContext).app;
      const allowed = new Set([
        'page',
        'per_page',
        'limit',
        'offset',
        'sort',
        'order',
        'q',
        'status',
        'status_id',
        'assignee_id',
        'priority',
        'due_before',
        'due_after',
      ]);
      for (const key of ctx.query.keys())
        if (!allowed.has(key)) throw validationError([{ field: key, message: 'parámetro desconocido' }]);
      const pagination = parsePagination(ctx, app.config.maxPageSize);
      const clauses = ['t.project_id = ?'];
      const params: Array<string | number> = [projectId];
      const status = ctx.query.get('status');
      if (status) {
        clauses.push('(s.name = ? OR s.category = ?)');
        params.push(status, status);
      }
      const statusId = ctx.query.get('status_id');
      if (statusId) {
        clauses.push('t.status_id = ?');
        params.push(Number(statusId));
      }
      const assignee = ctx.query.get('assignee_id');
      if (assignee) {
        clauses.push('t.assignee_id = ?');
        params.push(Number(assignee));
      }
      const priority = ctx.query.get('priority');
      if (priority) {
        if (!['low', 'medium', 'high', 'critical'].includes(priority))
          throw validationError([{ field: 'priority', message: 'valor inválido' }]);
        clauses.push('t.priority = ?');
        params.push(priority);
      }
      const dueBefore = ctx.query.get('due_before');
      if (dueBefore) {
        clauses.push('t.due_date <= ?');
        params.push(dueBefore);
      }
      const dueAfter = ctx.query.get('due_after');
      if (dueAfter) {
        clauses.push('t.due_date >= ?');
        params.push(dueAfter);
      }
      const q = ctx.query.get('q');
      if (q) {
        clauses.push(
          "(LOWER(t.title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(COALESCE(t.description,'')) LIKE LOWER(?) ESCAPE '\\')",
        );
        const like = `%${escapeLike(q)}%`;
        params.push(like, like);
      }
      const sortRaw = ctx.query.get('sort') ?? 'id';
      const sort = sortRaw.startsWith('-') ? sortRaw.slice(1) : sortRaw;
      if (!['id', 'title', 'priority', 'due_date', 'created_at', 'position'].includes(sort))
        throw validationError([{ field: 'sort', message: 'campo no ordenable' }]);
      const orderRaw = ctx.query.get('order');
      if (orderRaw && !['asc', 'desc'].includes(orderRaw))
        throw validationError([{ field: 'order', message: 'use asc o desc' }]);
      const direction = (orderRaw ?? (sortRaw.startsWith('-') ? 'desc' : 'asc')).toUpperCase();
      const where = ` WHERE ${clauses.join(' AND ')}`;
      const total = Number(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM pr_tasks t JOIN pr_statuses s ON s.id = t.status_id${where}`,
          ...params,
        )?.n ?? 0,
      );
      const rows = db.all<Record<string, unknown>>(
        `SELECT t.*, s.name AS status_name, s.category AS status_category, u.display_name AS assignee_name
       FROM pr_tasks t JOIN pr_statuses s ON s.id = t.status_id LEFT JOIN id_users u ON u.id = t.assignee_id
       ${where} ORDER BY t.${sort} ${direction}, t.id ASC LIMIT ? OFFSET ?`,
        ...params,
        pagination.perPage,
        pagination.offset,
      );
      sendJson(ctx, 200, { data: rows, meta: paginationMeta(pagination, total) });
    },
    { summary: 'Tareas de un proyecto con filtros combinados', tag: 'Projects · Tasks' },
  );

  router.add(
    'POST',
    `${root}/projects/:id/tasks`,
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      projectOrThrow(ctx, projectId);
      const db = dbOf(ctx);
      const body = await readJsonBody(ctx);
      const input = new Validator(body, [
        'title',
        'description',
        'status_id',
        'status',
        'assignee_id',
        'priority',
        'due_date',
        'estimate_minutes',
        'parent_id',
        'position',
      ]);
      const title = input.string('title', { required: true, maxLength: 300 })!;
      const description = input.string('description', { nullable: true, maxLength: 30_000 }) ?? null;
      const statusId = input.integer('status_id', { min: 1 });
      const statusName = input.string('status', { maxLength: 60 });
      const assigneeId = input.integer('assignee_id', { nullable: true, min: 1 }) ?? null;
      const priority =
        input.string('priority', { enum: ['low', 'medium', 'high', 'critical'], default: 'medium' }) ?? 'medium';
      const dueDate = input.date('due_date', { nullable: true }) ?? null;
      const estimate = input.integer('estimate_minutes', { nullable: true, min: 0 }) ?? null;
      const parentId = input.integer('parent_id', { nullable: true, min: 1 }) ?? null;
      const position = input.integer('position', { default: 0 }) ?? 0;
      input.done();
      if (parentId) {
        const parent = db.get<{ project_id: number }>('SELECT project_id FROM pr_tasks WHERE id = ?', parentId);
        if (!parent) throw notFound('Tarea padre no encontrada');
        if (parent.project_id !== projectId) throw conflict('La tarea padre pertenece a otro proyecto');
      }
      const status = resolveStatus(db, statusId, statusName);
      try {
        const id = db.transaction(() => {
          const newId = db.insert('pr_tasks', {
            project_id: projectId,
            parent_id: parentId,
            title,
            description,
            status_id: Number(status.id),
            assignee_id: assigneeId,
            priority,
            due_date: dueDate,
            estimate_minutes: estimate,
            position,
            created_at: now(),
            updated_at: now(),
          });
          logActivity(ctx, projectId, newId, 'created', `Tarea creada: ${title}`);
          return newId;
        });
        sendJson(ctx, 201, { data: taskDetails(ctx, id) }, { Location: `${root}/tasks/${id}` });
      } catch (error) {
        if (error instanceof Error && error.message.includes('FOREIGN KEY'))
          throw conflict('Usuario o referencia inexistente');
        throw error;
      }
    },
    { summary: 'Crea una tarea dentro de un proyecto', tag: 'Projects · Tasks' },
  );

  router.add(
    'GET',
    `${root}/tasks/:id/details`,
    (ctx) => {
      const id = Number(ctx.params.id);
      sendJson(ctx, 200, { data: taskDetails(ctx, id) });
    },
    { summary: 'Tarea con etiquetas, comentarios, adjuntos y subtareas', tag: 'Projects · Tasks' },
  );

  router.add(
    'GET',
    `${root}/tasks/:id/subtasks`,
    (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      if (!db.get('SELECT 1 AS x FROM pr_tasks WHERE id = ?', id)) throw notFound('Tarea no encontrada');
      const rows = db.all(
        `SELECT t.*, s.name AS status_name FROM pr_tasks t JOIN pr_statuses s ON s.id = t.status_id
       WHERE t.parent_id = ? ORDER BY t.position, t.id`,
        id,
      );
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Lista subtareas de una tarea', tag: 'Projects · Tasks' },
  );

  router.add(
    'POST',
    `${root}/tasks/:id/subtasks`,
    async (ctx) => {
      const parentId = Number(ctx.params.id);
      const db = dbOf(ctx);
      const parent = db.get<{ project_id: number }>('SELECT project_id FROM pr_tasks WHERE id = ?', parentId);
      if (!parent) throw notFound('Tarea padre no encontrada');
      const body = await readJsonBody(ctx);
      const input = new Validator(body, [
        'title',
        'description',
        'status_id',
        'status',
        'assignee_id',
        'priority',
        'due_date',
        'estimate_minutes',
      ]);
      const title = input.string('title', { required: true, maxLength: 300 })!;
      const description = input.string('description', { nullable: true, maxLength: 30_000 }) ?? null;
      const statusId = input.integer('status_id', { min: 1 });
      const statusName = input.string('status', { maxLength: 60 });
      const assigneeId = input.integer('assignee_id', { nullable: true, min: 1 }) ?? null;
      const priority =
        input.string('priority', { enum: ['low', 'medium', 'high', 'critical'], default: 'medium' }) ?? 'medium';
      const dueDate = input.date('due_date', { nullable: true }) ?? null;
      const estimate = input.integer('estimate_minutes', { nullable: true, min: 0 }) ?? null;
      input.done();
      const status = resolveStatus(db, statusId, statusName);
      const id = db.transaction(() => {
        const newId = db.insert('pr_tasks', {
          project_id: parent.project_id,
          parent_id: parentId,
          title,
          description,
          status_id: Number(status.id),
          assignee_id: assigneeId,
          priority,
          due_date: dueDate,
          estimate_minutes: estimate,
          position: 0,
          created_at: now(),
          updated_at: now(),
        });
        logActivity(ctx, parent.project_id, newId, 'created', `Subtarea creada: ${title}`);
        return newId;
      });
      sendJson(ctx, 201, { data: taskDetails(ctx, id) }, { Location: `${root}/tasks/${id}` });
    },
    { summary: 'Crea una subtarea', tag: 'Projects · Tasks' },
  );

  router.add(
    'PATCH',
    `${root}/tasks/:id/status`,
    async (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const task = db.get<{ project_id: number; title: string; status_id: number }>(
        'SELECT project_id, title, status_id FROM pr_tasks WHERE id = ?',
        id,
      );
      if (!task) throw notFound('Tarea no encontrada');
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['status_id', 'status']);
      const statusId = input.integer('status_id', { min: 1 });
      const statusName = input.string('status', { maxLength: 60 });
      input.done();
      const status = resolveStatus(db, statusId, statusName);
      const completedAt = status.category === 'done' ? now() : null;
      db.transaction(() => {
        db.run(
          'UPDATE pr_tasks SET status_id = ?, completed_at = ?, updated_at = ? WHERE id = ?',
          Number(status.id),
          completedAt,
          now(),
          id,
        );
        logActivity(ctx, task.project_id, id, 'status_changed', `Estado cambiado a ${String(status.name)}`);
      });
      sendJson(ctx, 200, { data: taskDetails(ctx, id) });
    },
    { summary: 'Cambia el estado de una tarea', tag: 'Projects · Tasks' },
  );

  // ---------- Relaciones ----------
  router.add(
    'GET',
    `${root}/projects/:id/members`,
    (ctx) => {
      const projectId = Number(ctx.params.id);
      projectOrThrow(ctx, projectId);
      const rows = dbOf(ctx).all(
        `SELECT pm.*, u.email, u.display_name FROM pr_project_members pm
       JOIN id_users u ON u.id = pm.user_id WHERE pm.project_id = ? ORDER BY pm.id`,
        projectId,
      );
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Miembros de un proyecto', tag: 'Projects · Projects' },
  );

  router.add(
    'POST',
    `${root}/projects/:id/members`,
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      projectOrThrow(ctx, projectId);
      const db = dbOf(ctx);
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['user_id', 'member_role']);
      const userId = input.integer('user_id', { required: true, min: 1 })!;
      const role =
        input.string('member_role', { enum: ['owner', 'manager', 'member', 'viewer'], default: 'member' }) ?? 'member';
      input.done();
      if (!db.get('SELECT 1 AS x FROM id_users WHERE id = ?', userId)) throw notFound('Usuario no encontrado');
      try {
        const id = db.insert('pr_project_members', {
          project_id: projectId,
          user_id: userId,
          member_role: role,
          added_at: now(),
        });
        sendJson(ctx, 201, { data: { id, project_id: projectId, user_id: userId, member_role: role } });
      } catch {
        throw conflict('El usuario ya es miembro del proyecto');
      }
    },
    { summary: 'Añade un miembro a un proyecto', tag: 'Projects · Projects' },
  );

  router.add(
    'DELETE',
    `${root}/projects/:id/members/:userId`,
    (ctx) => {
      const result = dbOf(ctx).run(
        'DELETE FROM pr_project_members WHERE project_id = ? AND user_id = ?',
        Number(ctx.params.id),
        Number(ctx.params.userId),
      );
      if (result.changes === 0) throw notFound('Miembro no encontrado');
      ctx.res.statusCode = 204;
      ctx.res.end();
    },
    { summary: 'Quita un miembro de un proyecto', tag: 'Projects · Projects' },
  );

  router.add(
    'GET',
    `${root}/teams/:id/members`,
    (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      if (!db.get('SELECT 1 AS x FROM pr_teams WHERE id = ?', id)) throw notFound('Equipo no encontrado');
      const rows = db.all(
        `SELECT tm.*, u.email, u.display_name FROM pr_team_members tm JOIN id_users u ON u.id = tm.user_id
       WHERE tm.team_id = ? ORDER BY tm.id`,
        id,
      );
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Miembros de un equipo', tag: 'Projects · Teams' },
  );

  router.add(
    'POST',
    `${root}/tasks/:id/comments`,
    async (ctx) => {
      const taskId = Number(ctx.params.id);
      const db = dbOf(ctx);
      const task = db.get<{ project_id: number }>('SELECT project_id FROM pr_tasks WHERE id = ?', taskId);
      if (!task) throw notFound('Tarea no encontrada');
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['author_id', 'body']);
      const authorId = input.integer('author_id', { required: true, min: 1 })!;
      const text = input.string('body', { required: true, maxLength: 20_000 })!;
      input.done();
      if (!db.get('SELECT 1 AS x FROM id_users WHERE id = ?', authorId)) throw notFound('Autor no encontrado');
      const id = db.transaction(() => {
        const newId = db.insert('pr_comments', { task_id: taskId, author_id: authorId, body: text, created_at: now() });
        logActivity(ctx, task.project_id, taskId, 'commented', 'Comentario añadido', authorId);
        return newId;
      });
      sendJson(ctx, 201, { data: db.get('SELECT * FROM pr_comments WHERE id = ?', id) });
    },
    { summary: 'Añade un comentario a una tarea', tag: 'Projects · Tasks' },
  );

  router.add(
    'GET',
    `${root}/tasks/:id/comments`,
    (ctx) => {
      const taskId = Number(ctx.params.id);
      const db = dbOf(ctx);
      if (!db.get('SELECT 1 AS x FROM pr_tasks WHERE id = ?', taskId)) throw notFound('Tarea no encontrada');
      const rows = db.all(
        `SELECT c.*, u.display_name AS author_name FROM pr_comments c LEFT JOIN id_users u ON u.id = c.author_id
       WHERE c.task_id = ? ORDER BY c.created_at ASC`,
        taskId,
      );
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Comentarios de una tarea', tag: 'Projects · Tasks' },
  );

  // ---------- Resúmenes ----------
  router.add(
    'GET',
    `${root}/projects/:id/stats`,
    (ctx) => {
      const id = Number(ctx.params.id);
      projectOrThrow(ctx, id);
      const db = dbOf(ctx);
      const byStatus = db.all(
        `SELECT s.id, s.name, s.category, COUNT(t.id) AS total FROM pr_statuses s
       LEFT JOIN pr_tasks t ON t.status_id = s.id AND t.project_id = ? GROUP BY s.id ORDER BY s.sort_order`,
        id,
      );
      const byPriority = db.all(
        'SELECT priority, COUNT(*) AS total FROM pr_tasks WHERE project_id = ? GROUP BY priority ORDER BY priority',
        id,
      );
      const total = Number(
        db.get<{ n: number }>('SELECT COUNT(*) AS n FROM pr_tasks WHERE project_id = ?', id)?.n ?? 0,
      );
      const done = Number(
        db.get<{ n: number }>(
          'SELECT COUNT(*) AS n FROM pr_tasks t JOIN pr_statuses s ON s.id = t.status_id WHERE t.project_id = ? AND s.category = ?',
          id,
          'done',
        )?.n ?? 0,
      );
      const members = Number(
        db.get<{ n: number }>('SELECT COUNT(*) AS n FROM pr_project_members WHERE project_id = ?', id)?.n ?? 0,
      );
      sendJson(ctx, 200, {
        data: {
          project_id: id,
          total_tasks: total,
          done_tasks: done,
          completion_percent: total ? Math.round((done / total) * 100) : 0,
          members,
          by_status: byStatus,
          by_priority: byPriority,
        },
      });
    },
    { summary: 'Estadísticas de tareas de un proyecto', tag: 'Projects · Reports' },
  );

  router.add(
    'GET',
    `${root}/projects/:id/activity`,
    (ctx) => {
      const id = Number(ctx.params.id);
      projectOrThrow(ctx, id);
      const db = dbOf(ctx);
      const app = (ctx as RequestContext).app;
      const pagination = parsePagination(ctx, app.config.maxPageSize);
      const total = Number(
        db.get<{ n: number }>('SELECT COUNT(*) AS n FROM pr_activities WHERE project_id = ?', id)?.n ?? 0,
      );
      const rows = db.all(
        `SELECT a.*, u.display_name AS actor_name FROM pr_activities a LEFT JOIN id_users u ON u.id = a.actor_id
       WHERE a.project_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
        id,
        pagination.perPage,
        pagination.offset,
      );
      sendJson(ctx, 200, { data: rows, meta: paginationMeta(pagination, total) });
    },
    { summary: 'Historial de actividad de un proyecto', tag: 'Projects · Activity' },
  );

  router.add(
    'GET',
    `${root}/tasks/:id/activity`,
    (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      if (!db.get('SELECT 1 AS x FROM pr_tasks WHERE id = ?', id)) throw notFound('Tarea no encontrada');
      const rows = db.all(
        `SELECT a.*, u.display_name AS actor_name FROM pr_activities a LEFT JOIN id_users u ON u.id = a.actor_id
       WHERE a.task_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 100`,
        id,
      );
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Historial de una tarea', tag: 'Projects · Activity' },
  );
}
