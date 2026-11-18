/**
 * @file Declarative CRUD resource engine.
 *
 * One `ResourceDef` drives validation, SQL, filtering, pagination, ETags,
 * OpenAPI request schemas and conventional routes. Table/column names come
 * only from the definition; every value is bound. This is a convention for
 * simple entities, not a dynamic endpoint engine: custom transactional routes
 * live in domain modules.
 */
import type { Ctx, Router } from './router.js';
import type { RequestContext } from './index.js';
import { readJsonBody, sendJson } from './index.js';
import { HttpError, conflict, notFound, preconditionFailed, validationError } from '../core/errors.js';
import { escapeLike, paginationMeta, parsePagination } from './query.js';

/** Supported JSON-facing column types. */
export type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'datetime' | 'email' | 'json';

/** Validation, visibility and query capabilities for one column. */
export interface FieldDef {
  type: FieldType;
  required?: boolean;
  nullable?: boolean;
  enum?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: RegExp;
  readOnly?: boolean;
  hidden?: boolean;
  filter?: boolean;
  sortable?: boolean;
  search?: boolean;
  description?: string;
}

/** Complete contract for a conventional CRUD resource. */
export interface ResourceDef {
  table: string;
  path: string;
  tag: string;
  singular: string;
  fields: Record<string, FieldDef>;
  defaultSort?: string;
  search?: string[];
  updatedAt?: string | false;
  allowDelete?: boolean;
  authorize?: (ctx: Ctx, action: 'read' | 'write' | 'delete') => void;
  defaults?: Record<string, () => unknown>;
  afterCreate?: (ctx: Ctx, id: number) => void;
  afterUpdate?: (ctx: Ctx, id: number) => void;
}

type Row = Record<string, unknown>;
type SqlParam = string | number | bigint | null | Uint8Array;

const ID = 'id';

/** English names for generated resource summaries/descriptions. */
export const ENGLISH_RESOURCE_NAMES: Record<string, { one: string; many: string }> = {
  actividad: { one: 'activity', many: 'activities' },
  adjunto: { one: 'attachment', many: 'attachments' },
  almacén: { one: 'warehouse', many: 'warehouses' },
  asignatura: { one: 'subject', many: 'subjects' },
  asistencia: { one: 'attendance record', many: 'attendance records' },
  autor: { one: 'author', many: 'authors' },
  'autor de libro': { one: 'book author', many: 'book authors' },
  calificación: { one: 'grade', many: 'grades' },
  categoría: { one: 'category', many: 'categories' },
  cliente: { one: 'customer', many: 'customers' },
  comentario: { one: 'comment', many: 'comments' },
  contrato: { one: 'contract', many: 'contracts' },
  cuenta: { one: 'account', many: 'accounts' },
  cupón: { one: 'coupon', many: 'coupons' },
  curso: { one: 'course', many: 'courses' },
  departamento: { one: 'department', many: 'departments' },
  dirección: { one: 'address', many: 'addresses' },
  editorial: { one: 'publisher', many: 'publishers' },
  ejemplar: { one: 'copy', many: 'copies' },
  empleado: { one: 'employee', many: 'employees' },
  equipo: { one: 'team', many: 'teams' },
  estado: { one: 'status', many: 'statuses' },
  estudiante: { one: 'student', many: 'students' },
  etiqueta: { one: 'label', many: 'labels' },
  'etiqueta de tarea': { one: 'task label', many: 'task labels' },
  evaluación: { one: 'evaluation', many: 'evaluations' },
  gasto: { one: 'expense', many: 'expenses' },
  género: { one: 'genre', many: 'genres' },
  'género de libro': { one: 'book genre', many: 'book genres' },
  grupo: { one: 'group', many: 'groups' },
  imagen: { one: 'image', many: 'images' },
  inventario: { one: 'inventory record', many: 'inventory records' },
  lector: { one: 'reader', many: 'readers' },
  libro: { one: 'book', many: 'books' },
  marca: { one: 'brand', many: 'brands' },
  material: { one: 'material', many: 'materials' },
  matrícula: { one: 'enrollment', many: 'enrollments' },
  'método de pago': { one: 'payment method', many: 'payment methods' },
  'miembro de equipo': { one: 'team member', many: 'team members' },
  'miembro de proyecto': { one: 'project member', many: 'project members' },
  multa: { one: 'fine', many: 'fines' },
  permiso: { one: 'permission', many: 'permissions' },
  presupuesto: { one: 'budget', many: 'budgets' },
  producto: { one: 'product', many: 'products' },
  profesor: { one: 'teacher', many: 'teachers' },
  proveedor: { one: 'supplier', many: 'suppliers' },
  proyecto: { one: 'project', many: 'projects' },
  puesto: { one: 'position', many: 'positions' },
  reseña: { one: 'review', many: 'reviews' },
  rol: { one: 'role', many: 'roles' },
  salario: { one: 'salary', many: 'salaries' },
  sección: { one: 'section', many: 'sections' },
  tarea: { one: 'task', many: 'tasks' },
  transportista: { one: 'carrier', many: 'carriers' },
  vacación: { one: 'vacation', many: 'vacations' },
  variante: { one: 'variant', many: 'variants' },
};

function visibleFields(def: ResourceDef): string[] {
  return Object.entries(def.fields)
    .filter(([, f]) => !f.hidden)
    .map(([name]) => name);
}

function shapeRow(row: Row, def: ResourceDef): Row {
  const shaped: Row = { ...row };
  for (const [name, field] of Object.entries(def.fields)) {
    if (field.type === 'json' && typeof shaped[name] === 'string') {
      try {
        shaped[name] = JSON.parse(shaped[name] as string);
      } catch {
        // Se conserva el valor original si no es JSON válido.
      }
    }
  }
  return shaped;
}

function validateValue(field: FieldDef, value: unknown): SqlParam {
  if (value === null) {
    if (!field.nullable) throw new Error('no admite null');
    return null;
  }
  switch (field.type) {
    case 'string':
    case 'email': {
      if (typeof value !== 'string') throw new Error('debe ser texto');
      const max = field.maxLength ?? (field.type === 'email' ? 254 : 10_000);
      if (value.length > max) throw new Error(`supera el máximo de ${max} caracteres`);
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new Error('email inválido');
      }
      if (field.enum && !field.enum.includes(value)) throw new Error(`valor no permitido (${field.enum.join(', ')})`);
      if (field.pattern && !field.pattern.test(value)) throw new Error('formato inválido');
      return value;
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('debe ser un entero');
      if (field.min !== undefined && value < field.min) throw new Error(`debe ser >= ${field.min}`);
      if (field.max !== undefined && value > field.max) throw new Error(`debe ser <= ${field.max}`);
      return value;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('debe ser un número');
      if (field.min !== undefined && value < field.min) throw new Error(`debe ser >= ${field.min}`);
      if (field.max !== undefined && value > field.max) throw new Error(`debe ser <= ${field.max}`);
      return value;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') throw new Error('debe ser booleano');
      return value ? 1 : 0;
    }
    case 'date': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
        throw new Error('fecha inválida; formato YYYY-MM-DD');
      }
      return value;
    }
    case 'datetime': {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        throw new Error('fecha/hora inválida; use ISO-8601');
      }
      return value;
    }
    case 'json': {
      if (typeof value === 'string') return value;
      return JSON.stringify(value);
    }
    default:
      return value as SqlParam;
  }
}

function validateBody(body: unknown, def: ResourceDef, mode: 'create' | 'put' | 'patch'): Row {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError([{ field: '$', message: 'El cuerpo debe ser un objeto JSON' }]);
  }
  const input = body as Row;
  const errors: Array<{ field: string; message: string }> = [];
  const output: Row = {};
  for (const key of Object.keys(input)) {
    const field = def.fields[key];
    if (!field) {
      errors.push({ field: key, message: 'campo desconocido' });
    } else if (field.readOnly || field.hidden) {
      errors.push({ field: key, message: 'campo de solo lectura' });
    }
  }
  for (const [name, field] of Object.entries(def.fields)) {
    if (field.readOnly || field.hidden) continue;
    const present = Object.hasOwn(input, name);
    if (!present) {
      if ((mode === 'create' || mode === 'put') && field.required) {
        errors.push({ field: name, message: 'es obligatorio' });
      }
      if (mode === 'put' && field.nullable) output[name] = null;
      continue;
    }
    try {
      output[name] = validateValue(field, input[name]);
    } catch (error) {
      errors.push({ field: name, message: error instanceof Error ? error.message : 'valor inválido' });
    }
  }
  if (errors.length) throw validationError(errors);
  return output;
}

function parseId(ctx: Ctx): number {
  const raw = ctx.params.id ?? '';
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw validationError([{ field: 'id', message: 'debe ser un entero positivo' }]);
  }
  return Number(raw);
}

function dbError(error: unknown): never {
  const code = (error as { code?: string }).code ?? '';
  if (code === 'ERR_SQLITE_ERROR') {
    const message = (error as Error).message;
    if (message.includes('UNIQUE')) throw conflict('Ya existe un registro con esos valores');
    if (message.includes('FOREIGN KEY')) throw conflict('Referencia inexistente o recurso todavía en uso');
    if (message.includes('CHECK'))
      throw validationError([{ field: '$', message: 'Restricción de integridad incumplida' }]);
    throw conflict('Operación rechazada por una restricción de la base de datos');
  }
  throw error;
}

function parseSort(ctx: Ctx, def: ResourceDef): { column: string; direction: 'asc' | 'desc' } {
  const raw = ctx.query.get('sort');
  const orderParam = ctx.query.get('order');
  let column = def.defaultSort ?? ID;
  let direction: 'asc' | 'desc' = 'asc';
  if (raw) {
    if (raw.startsWith('-')) {
      direction = 'desc';
      column = raw.slice(1);
    } else {
      column = raw;
    }
  }
  if (orderParam) {
    if (!['asc', 'desc'].includes(orderParam)) {
      throw validationError([{ field: 'order', message: 'debe ser asc o desc' }]);
    }
    direction = orderParam as 'asc' | 'desc';
  }
  const field = def.fields[column];
  if (!field || field.hidden || field.sortable === false) {
    throw validationError([{ field: 'sort', message: `campo no ordenable: ${column}` }]);
  }
  return { column, direction };
}

function parseSelected(ctx: Ctx, def: ResourceDef): string[] {
  const raw = ctx.query.get('fields');
  const visible = visibleFields(def);
  if (!raw) return visible;
  const selected = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (selected.length === 0) throw validationError([{ field: 'fields', message: 'selección vacía' }]);
  for (const col of selected) {
    if (!visible.includes(col)) throw validationError([{ field: 'fields', message: `campo desconocido: ${col}` }]);
  }
  return [...new Set(selected)];
}

interface WhereBuild {
  sql: string;
  params: SqlParam[];
}

function filterValue(name: string, field: FieldDef, raw: string): SqlParam {
  if (field.type === 'boolean') {
    if (raw === 'true' || raw === '1') return 1;
    if (raw === 'false' || raw === '0') return 0;
    throw validationError([{ field: name, message: 'booleano inválido' }]);
  }
  if (field.type === 'integer') {
    if (!/^-?\d+$/.test(raw)) throw validationError([{ field: name, message: 'entero inválido' }]);
    return Number(raw);
  }
  if (field.type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw validationError([{ field: name, message: 'número inválido' }]);
    return n;
  }
  if (field.type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
      throw validationError([{ field: name, message: 'fecha inválida' }]);
    }
    return raw;
  }
  if (field.enum && !field.enum.includes(raw)) {
    throw validationError([{ field: name, message: `valor no permitido (${field.enum.join(', ')})` }]);
  }
  return raw;
}

function buildWhere(ctx: Ctx, def: ResourceDef): WhereBuild {
  const clauses: string[] = [];
  const params: SqlParam[] = [];
  const known = new Set(['page', 'per_page', 'limit', 'offset', 'sort', 'order', 'fields', 'q']);

  for (const [key] of ctx.query.entries()) {
    if (known.has(key)) continue;
    let column = key;
    let op: '=' | '>=' | '<=' | '>' | '<' | 'LIKE' = '=';
    let baseField = def.fields[key];
    if (!baseField) {
      const match = /^(.+?)(_gte|_lte|_gt|_lt|_like)$/.exec(key);
      if (match) {
        column = match[1];
        baseField = def.fields[column];
        const suffix = match[2];
        op =
          suffix === '_gte'
            ? '>='
            : suffix === '_lte'
              ? '<='
              : suffix === '_gt'
                ? '>'
                : suffix === '_lt'
                  ? '<'
                  : 'LIKE';
      }
    }
    if (!baseField || baseField.hidden || baseField.filter === false) {
      throw validationError([{ field: key, message: 'parámetro de filtro desconocido' }]);
    }
    if (op !== '=' && !['number', 'integer', 'date', 'datetime', 'string', 'email'].includes(baseField.type)) {
      throw validationError([{ field: key, message: 'operador no soportado para este campo' }]);
    }
    if (op === 'LIKE' && !['string', 'email'].includes(baseField.type)) {
      throw validationError([{ field: key, message: 'LIKE solo aplica a texto' }]);
    }
    const values = ctx.query.getAll(key);
    if (op === '=' && values.length > 1) {
      clauses.push(`${column} IN (${values.map(() => '?').join(', ')})`);
      for (const v of values) params.push(filterValue(key, baseField, v));
    } else {
      const value = values[0];
      if (op === 'LIKE') {
        clauses.push(`${column} LIKE ? ESCAPE '\\'`);
        params.push(`%${escapeLike(value)}%`);
      } else {
        clauses.push(`${column} ${op} ?`);
        params.push(filterValue(key, baseField, value));
      }
    }
  }
  const q = ctx.query.get('q');
  if (q !== null && q !== '') {
    const columns = def.search?.length
      ? def.search
      : Object.entries(def.fields)
          .filter(([, f]) => f.search)
          .map(([name]) => name);
    const safeColumns = columns.filter((c) => def.fields[c] && !def.fields[c].hidden);
    if (safeColumns.length === 0) throw validationError([{ field: 'q', message: 'búsqueda no disponible' }]);
    if (q.length > 200) throw validationError([{ field: 'q', message: 'máximo 200 caracteres' }]);
    clauses.push(`(${safeColumns.map((c) => `LOWER(${c}) LIKE LOWER(?) ESCAPE '\\'`).join(' OR ')})`);
    for (let i = 0; i < safeColumns.length; i++) params.push(`%${escapeLike(q)}%`);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

function selectClause(selected: string[]): string {
  return selected.join(', ');
}

function exampleFor(field: FieldDef): unknown {
  if (field.enum?.length) return field.enum[0];
  if (field.type === 'email') return 'usuario@example.test';
  if (field.type === 'date') return '2026-01-31';
  if (field.type === 'datetime') return '2026-01-31T12:00:00Z';
  if (field.type === 'integer') return field.min ?? 1;
  if (field.type === 'number') return field.min ?? 1.5;
  if (field.type === 'boolean') return true;
  if (field.type === 'json') return { ejemplo: true };
  return 'texto de ejemplo';
}

function fieldSchema(field: FieldDef): Record<string, unknown> {
  const typeMap: Record<FieldType, string> = {
    string: 'string',
    email: 'string',
    date: 'string',
    datetime: 'string',
    integer: 'integer',
    number: 'number',
    boolean: 'boolean',
    json: 'object',
  };
  return {
    type: typeMap[field.type],
    ...(field.type === 'date' ? { format: 'date' } : {}),
    ...(field.type === 'datetime' ? { format: 'date-time' } : {}),
    ...(field.type === 'email' ? { format: 'email' } : {}),
    ...(field.enum ? { enum: [...field.enum] } : {}),
    ...(field.min !== undefined ? { minimum: field.min } : {}),
    ...(field.max !== undefined ? { maximum: field.max } : {}),
    ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
    ...(field.nullable ? { nullable: true } : {}),
    ...(field.description ? { description: field.description } : {}),
    example: exampleFor(field),
  };
}

function requestBodySchema(def: ResourceDef, partial: boolean): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, field] of Object.entries(def.fields)) {
    if (field.readOnly || field.hidden) continue;
    properties[name] = fieldSchema(field);
    if (field.required && !partial) required.push(name);
  }
  return {
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object', properties, ...(required.length ? { required } : {}) },
      },
    },
  };
}

function listParameters(def: ResourceDef): Array<Record<string, unknown>> {
  const base: Array<Record<string, unknown>> = [
    { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
    { name: 'per_page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
    { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
    { name: 'sort', in: 'query', schema: { type: 'string' } },
    { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
    { name: 'fields', in: 'query', schema: { type: 'string' } },
  ];
  if (def.search?.length) base.push({ name: 'q', in: 'query', schema: { type: 'string', maxLength: 200 } });
  for (const [name, field] of Object.entries(def.fields)) {
    if (field.hidden || field.filter === false) continue;
    base.push({
      name,
      in: 'query',
      schema: fieldSchema(field),
      description: `Filtro exacto por ${name}. Repetible para IN.`,
    });
    if (['integer', 'number', 'date', 'datetime'].includes(field.type)) {
      for (const suffix of ['_gte', '_lte', '_gt', '_lt']) {
        base.push({ name: `${name}${suffix}`, in: 'query', schema: fieldSchema(field) });
      }
    }
    if (['string', 'email'].includes(field.type)) {
      base.push({ name: `${name}_like`, in: 'query', schema: { type: 'string' } });
    }
  }
  return base;
}

const listResponseSchema = {
  type: 'object',
  properties: {
    data: { type: 'array', items: { type: 'object', additionalProperties: true } },
    meta: { $ref: '#/components/schemas/PaginationMeta' },
  },
};

const itemResponseSchema = {
  type: 'object',
  properties: { data: { type: 'object', additionalProperties: true } },
};

function updatedAtColumn(def: ResourceDef): string | null {
  if (def.updatedAt === false) return null;
  if (def.updatedAt) return def.updatedAt;
  return def.fields.updated_at ? 'updated_at' : null;
}

function etagFor(def: ResourceDef, row: Row): string {
  const version = typeof row.updated_at === 'string' ? row.updated_at : 'static';
  return `"sim-${def.table}-${String(row.id)}-${version}"`;
}

function currentEtag(app: RequestContext['app'], def: ResourceDef, id: number): string | null {
  const column = updatedAtColumn(def);
  const row = app.db.get<Row>(
    `SELECT id, ${column ? `${column} AS updated_at` : 'id AS updated_at'} FROM ${def.table} WHERE id = ?`,
    id,
  );
  if (!row) return null;
  return etagFor(def, row);
}

function checkIfMatch(ctx: Ctx, def: ResourceDef, id: number): void {
  const header = ctx.req.headers['if-match'];
  if (!header) return;
  const current = currentEtag((ctx as RequestContext).app, def, id);
  const expected = String(header).trim();
  if (expected !== '*' && expected !== current) {
    throw preconditionFailed('La precondición If-Match no coincide con la versión actual');
  }
}

function getById(ctx: Ctx, def: ResourceDef, id: number): Row {
  const selected = parseSelected(ctx, def);
  const row = (ctx as RequestContext).app.db.get<Row>(
    `SELECT ${selectClause(selected)} FROM ${def.table} WHERE ${ID} = ?`,
    id,
  );
  if (!row) throw notFound(`${def.singular} no encontrado`);
  return shapeRow(row, def);
}

/**
 * Registers list/read/create/put/patch/delete routes.
 *
 * ETags are derived from `updated_at` when configured (or present in fields).
 * PUT requires configured required fields; PATCH is partial. Deletes translate
 * FK restrictions into 409 instead of leaking SQLite errors.
 */
export function registerResource(router: Router, basePath: string, def: ResourceDef): void {
  const collection = `${basePath}/${def.path.replace(/^\/+|\/+$/g, '')}`;
  const item = `${collection}/:id`;
  const tag = def.tag;
  const names = ENGLISH_RESOURCE_NAMES[def.singular] ?? { one: def.singular, many: `${def.singular}s` };

  router.add(
    'GET',
    collection,
    (ctx) => {
      def.authorize?.(ctx, 'read');
      const app = (ctx as RequestContext).app;
      const selected = parseSelected(ctx, def);
      const sort = parseSort(ctx, def);
      const pagination = parsePagination(ctx, app.config.maxPageSize);
      const where = buildWhere(ctx, def);
      const total = Number(
        app.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${def.table}${where.sql}`, ...where.params)?.n ?? 0,
      );
      const rows = app.db.all<Row>(
        `SELECT ${selectClause(selected)} FROM ${def.table}${where.sql} ORDER BY ${sort.column} ${sort.direction.toUpperCase()}, ${ID} ASC LIMIT ? OFFSET ?`,
        ...where.params,
        pagination.perPage,
        pagination.offset,
      );
      sendJson(ctx, 200, { data: rows.map((r) => shapeRow(r, def)), meta: paginationMeta(pagination, total) });
    },
    {
      summary: `Lista ${def.singular}`,
      summaryEn: `List ${names.many}`,
      tag,
      parameters: listParameters(def),
      responses: {
        '200': {
          description: `Lista paginada de ${def.singular}`,
          content: { 'application/json': { schema: listResponseSchema } },
        },
        '422': { $ref: '#/components/responses/ValidationError' },
      },
    },
  );

  router.add(
    'GET',
    item,
    (ctx) => {
      def.authorize?.(ctx, 'read');
      const id = parseId(ctx);
      const row = getById(ctx, def, id);
      const etag = currentEtag((ctx as RequestContext).app, def, id) ?? etagFor(def, row);
      if (ctx.req.headers['if-none-match'] === etag || ctx.req.headers['if-none-match'] === '*') {
        ctx.res.statusCode = 304;
        ctx.res.setHeader('ETag', etag);
        ctx.res.end();
        return;
      }
      sendJson(ctx, 200, { data: row }, { ETag: etag });
    },
    {
      summary: `Obtiene ${def.singular} por id`,
      summaryEn: `Get ${names.one} by ID`,
      tag,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      responses: {
        '200': { description: def.singular, content: { 'application/json': { schema: itemResponseSchema } } },
        '404': { $ref: '#/components/responses/NotFound' },
      },
    },
  );

  router.add(
    'POST',
    collection,
    async (ctx) => {
      def.authorize?.(ctx, 'write');
      const app = (ctx as RequestContext).app;
      const body = await readJsonBody(ctx);
      const data = validateBody(body, def, 'create');
      for (const [key, produce] of Object.entries(def.defaults ?? {})) {
        if (data[key] === undefined) data[key] = produce();
      }
      try {
        const id = app.db.transaction(() => {
          const newId = app.db.insert(def.table, data as Record<string, SqlParam>);
          def.afterCreate?.(ctx, newId);
          return newId;
        });
        const row = getById(ctx, def, id);
        sendJson(ctx, 201, { data: row }, { Location: `${collection}/${id}` });
      } catch (error) {
        dbError(error);
      }
    },
    {
      summary: `Crea ${def.singular}`,
      summaryEn: `Create ${names.one}`,
      tag,
      requestBody: requestBodySchema(def, false),
      responses: {
        '201': { description: 'Creado', content: { 'application/json': { schema: itemResponseSchema } } },
        '409': { $ref: '#/components/responses/ConflictError' },
        '422': { $ref: '#/components/responses/ValidationError' },
      },
    },
  );

  const updateHandler = (patch: boolean) => async (ctx: Ctx) => {
    def.authorize?.(ctx, 'write');
    const app = (ctx as RequestContext).app;
    const id = parseId(ctx);
    getById(ctx, def, id);
    checkIfMatch(ctx, def, id);
    const body = await readJsonBody(ctx);
    const data = validateBody(body, def, patch ? 'patch' : 'put');
    const entries = Object.entries(data);
    if (entries.length === 0) {
      sendJson(ctx, 200, { data: getById(ctx, def, id) });
      return;
    }
    const timestampColumn = updatedAtColumn(def);
    if (timestampColumn && !entries.some(([k]) => k === timestampColumn)) {
      entries.push([timestampColumn, new Date().toISOString()]);
    }
    try {
      app.db.transaction(() => {
        app.db.run(
          `UPDATE ${def.table} SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE ${ID} = ?`,
          ...entries.map(([, v]) => v as SqlParam),
          id,
        );
        def.afterUpdate?.(ctx, id);
      });
      const updated = getById(ctx, def, id);
      sendJson(ctx, 200, { data: updated }, { ETag: currentEtag(app, def, id) ?? etagFor(def, updated) });
    } catch (error) {
      dbError(error);
    }
  };
  router.add('PUT', item, updateHandler(false), {
    summary: `Reemplaza ${def.singular}`,
    summaryEn: `Replace ${names.one}`,
    tag,
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    requestBody: requestBodySchema(def, false),
  });
  router.add('PATCH', item, updateHandler(true), {
    summary: `Actualiza parcialmente ${def.singular}`,
    summaryEn: `Partially update ${names.one}`,
    tag,
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    requestBody: requestBodySchema(def, true),
  });

  if (def.allowDelete !== false) {
    router.add(
      'DELETE',
      item,
      (ctx) => {
        def.authorize?.(ctx, 'delete');
        const app = (ctx as RequestContext).app;
        const id = parseId(ctx);
        try {
          const result = app.db.run(`DELETE FROM ${def.table} WHERE ${ID} = ?`, id);
          if (result.changes === 0) throw notFound(`${def.singular} no encontrado`);
          ctx.res.statusCode = 204;
          ctx.res.end();
        } catch (error) {
          if (error instanceof HttpError) throw error;
          dbError(error);
        }
      },
      {
        summary: `Elimina ${def.singular}`,
        summaryEn: `Delete ${names.one}`,
        tag,
        responses: { '204': { description: 'Eliminado' }, '409': { $ref: '#/components/responses/ConflictError' } },
      },
    );
  }
}

/** Parses a positive integer route/query id with a field-scoped 422. */
export function idOrThrow(raw: string | undefined, field = 'id'): number {
  if (!raw || !/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw validationError([{ field, message: 'debe ser un entero positivo' }]);
  }
  return Number(raw);
}

/** Reads a finite numeric query parameter, optionally required. */
export function numberQuery(ctx: Ctx, name: string, fallback?: number): number {
  const raw = ctx.query.get(name);
  if (raw === null || raw === '') {
    if (fallback !== undefined) return fallback;
    throw validationError([{ field: name, message: 'es obligatorio' }]);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw validationError([{ field: name, message: 'número inválido' }]);
  return value;
}
