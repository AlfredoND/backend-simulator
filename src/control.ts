import { timingSafeEqual } from 'node:crypto';
import type { Router } from './router.js';
import type { Ctx } from './router.js';
import type { RequestContext } from './http.js';
import { readJsonBody, sendJson } from './http.js';
import { HttpError, badRequest, notFound } from './errors.js';
import { DOMAINS, DOMAIN_TABLES } from './domain-tables.js';
import { resetAll, resetDomain, hashPassword } from './seed.js';
import { Validator } from './validate.js';

const now = () => new Date().toISOString();

function dbOf(ctx: Ctx) {
  return (ctx as RequestContext).app.db;
}

function controlToken(ctx: Ctx): string {
  const header = ctx.req.headers['x-control-token'];
  if (typeof header === 'string') return header;
  const auth = ctx.req.headers.authorization;
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    if (match) return match[1].trim();
  }
  return '';
}

function requireControl(ctx: Ctx): void {
  const expected = (ctx as RequestContext).app.config.controlToken;
  const provided = controlToken(ctx);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Token de control ausente o inválido', {
      headers: { 'WWW-Authenticate': 'Bearer realm="mafetch-control"' },
    });
  }
}

function stats(ctx: Ctx) {
  const db = dbOf(ctx);
  const domains: Record<string, { tables: Record<string, number>; total: number }> = {};
  let total = 0;
  for (const domain of DOMAINS) {
    const tables = db.domainCounts(domain);
    const domainTotal = Object.values(tables).reduce((a, b) => a + b, 0);
    domains[domain] = { tables, total: domainTotal };
    total += domainTotal;
  }
  return {
    database: (ctx as RequestContext).app.config.dbPath,
    domains,
    total_records: total,
    schema_version: db.get<{ value: string }>("SELECT value FROM _meta WHERE key = 'schema_version'")?.value ?? null,
    seeded_at: db.get<{ value: string }>("SELECT value FROM _meta WHERE key = 'seeded'")?.value ?? null,
    uptime_seconds: Math.round(process.uptime()),
  };
}

function appendDemo(ctx: Ctx, entity: string, count: number): Record<string, unknown> {
  const db = dbOf(ctx);
  const app = (ctx as RequestContext).app;
  const config = app.config;
  const passwordHash = hashPassword(config.seedPassword);
  return db.transaction(() => {
    let created = 0;
    if (entity === 'users') {
      let max = Number(db.get<{ n: number }>('SELECT COALESCE(MAX(id),0) AS n FROM id_users')?.n ?? 0);
      for (let i = 0; i < count; i++) {
        const id = ++max;
        db.insert('id_users', {
          email: `extra.user.${id}@example.test`,
          password_hash: passwordHash,
          display_name: `Extra Usuario ${id}`,
          status: 'active',
          is_admin: 0,
          created_at: now(),
          updated_at: now(),
        });
        db.insert('id_profiles', {
          user_id: id, first_name: 'Extra', last_name: `Usuario ${id}`, phone: null,
          bio: 'Registro adicional generado por el endpoint de control.', avatar_url: null,
          birth_date: null, locale: 'es-ES', timezone: 'Europe/Madrid', updated_at: now(),
        });
        db.insert('id_preferences', {
          user_id: id, theme: 'system', language: 'es', notifications: 1, newsletter: 0,
          timezone: 'Europe/Madrid', updated_at: now(),
        });
        created++;
      }
    } else if (entity === 'tasks') {
      const max = Number(db.get<{ n: number }>('SELECT COALESCE(MAX(id),0) AS n FROM pr_tasks')?.n ?? 0);
      for (let i = 1; i <= count; i++) {
        db.insert('pr_tasks', {
          project_id: 1, parent_id: null, title: `Tarea extra ${max + i}`,
          description: 'Tarea creada mediante /_control/seed', status_id: 2, assignee_id: 1,
          priority: 'medium', due_date: null, estimate_minutes: 60, position: 0,
          created_at: now(), updated_at: now(), completed_at: null,
        });
        created++;
      }
    } else if (entity === 'products') {
      let max = Number(db.get<{ n: number }>('SELECT COALESCE(MAX(id),0) AS n FROM shop_products')?.n ?? 0);
      for (let i = 0; i < count; i++) {
        const id = ++max;
        db.insert('shop_products', {
          sku: `EXTRA-SKU-${id}`, name: `Producto extra ${id}`, slug: `extra-producto-${id}`,
          brand_id: null, category_id: 1, description: 'Producto generado por control',
          price_cents: 1999, currency: 'EUR', status: 'active', rating: null,
          created_at: now(), updated_at: now(),
        });
        db.insert('shop_variants', {
          product_id: id, sku: `EXTRA-SKU-${id}-V1`, name: 'Estándar', price_cents: 1999,
          attributes: JSON.stringify({ source: 'control' }), is_active: 1,
        });
        created++;
      }
    } else if (entity === 'books') {
      let max = Number(db.get<{ n: number }>('SELECT COALESCE(MAX(id),0) AS n FROM lib_books')?.n ?? 0);
      for (let i = 0; i < count; i++) {
        const id = ++max;
        db.insert('lib_books', {
          isbn: `978-99-${10_000 + id}`, title: `Libro extra ${id}`, subtitle: null,
          publisher_id: 1, published_year: 2026, language: 'es', pages: 200,
          description: 'Libro generado por control', cover_url: null, created_at: now(),
        });
        created++;
      }
    } else if (entity === 'students') {
      let max = Number(db.get<{ n: number }>('SELECT COALESCE(MAX(id),0) AS n FROM edu_students')?.n ?? 0);
      for (let i = 0; i < count; i++) {
        const id = ++max;
        db.insert('edu_students', {
          student_code: `EXTRA-STU-${id}`, full_name: `Estudiante Extra ${id}`,
          email: `extra.student.${id}@education.test`, birth_date: null, status: 'active',
          enrolled_at: now().slice(0, 10),
        });
        created++;
      }
    } else if (entity === 'employees') {
      let max = Number(db.get<{ n: number }>('SELECT COALESCE(MAX(id),0) AS n FROM hr_employees')?.n ?? 0);
      for (let i = 0; i < count; i++) {
        const id = ++max;
        db.insert('hr_employees', {
          employee_code: `EXTRA-EMP-${id}`, full_name: `Empleado Extra ${id}`,
          email: `extra.employee.${id}@corp.example.test`, department_id: 1, position_id: 1,
          manager_id: null, hire_date: now().slice(0, 10), termination_date: null, status: 'active',
        });
        created++;
      }
    } else if (entity === 'transactions') {
      for (let i = 0; i < count; i++) {
        const reference = `EXTRA-TX-${Date.now()}-${i}`;
        const amount = 1000 + i * 100;
        db.run('UPDATE fin_accounts SET balance_cents = balance_cents + ? WHERE id = 2', amount);
        db.insert('fin_transactions', {
          account_id: 2, kind: 'credit', amount_cents: amount,
          description: `Transacción extra ${i + 1}`, category: 'extra',
          reference, occurred_at: now(), created_at: now(),
        });
        created++;
      }
    } else {
      throw badRequest(`Entidad no soportada: ${entity}. Use users, tasks, products, books, students, employees o transactions`);
    }
    return { entity, created };
  });
}

export function registerControlRoutes(router: Router): void {
  router.add('GET', '/_control/stats', (ctx) => {
    sendJson(ctx, 200, { data: stats(ctx) });
  }, { summary: 'Estadísticas de registros por tabla y dominio', tag: 'Control' });

  router.add('POST', '/_control/reset/:domain', (ctx) => {
    requireControl(ctx);
    const domain = String(ctx.params.domain);
    if (!DOMAINS.includes(domain)) throw notFound(`Dominio desconocido: ${domain}`);
    const db = dbOf(ctx);
    resetDomain(db, domain, (ctx as RequestContext).app.config);
    sendJson(ctx, 200, { data: { reset: domain, tables: DOMAIN_TABLES[domain].length, stats: stats(ctx) } });
  }, { summary: 'Restaura un dominio a sus datos semilla', tag: 'Control', security: [{ controlToken: [] }] });

  router.add('POST', '/_control/reset', async (ctx) => {
    requireControl(ctx);
    const contentType = String(ctx.req.headers['content-type'] ?? '');
    let domain: string | undefined;
    if (contentType.includes('application/json') && Number(ctx.req.headers['content-length'] ?? 0) > 0) {
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['domain']);
      domain = input.string('domain', { maxLength: 40 }) ?? undefined;
      input.done();
    }
    const db = dbOf(ctx);
    const config = (ctx as RequestContext).app.config;
    if (domain) {
      if (!DOMAINS.includes(domain)) throw notFound(`Dominio desconocido: ${domain}`);
      resetDomain(db, domain, config);
      sendJson(ctx, 200, { data: { reset: domain, stats: stats(ctx) } });
      return;
    }
    resetAll(db, config);
    sendJson(ctx, 200, { data: { reset: 'all', stats: stats(ctx) } });
  }, { summary: 'Restaura todos los datos o un dominio concreto', tag: 'Control', security: [{ controlToken: [] }] });

  router.add('POST', '/_control/seed', async (ctx) => {
    requireControl(ctx);
    const body = await readJsonBody(ctx);
    const input = new Validator(body, ['entity', 'count']);
    const entity = input.string('entity', { required: true, maxLength: 40 })!;
    const count = input.integer('count', { min: 1, max: 100, default: 1 }) ?? 1;
    input.done();
    const result = appendDemo(ctx, entity, count);
    sendJson(ctx, 201, { data: result });
  }, { summary: 'Añade datos demo adicionales', tag: 'Control', security: [{ controlToken: [] }] });

  router.add('GET', '/_control/config', (ctx) => {
    const app = (ctx as RequestContext).app;
    sendJson(ctx, 200, {
      data: {
        host: app.config.host,
        http_port: app.config.port,
        https_enabled: app.config.httpsEnabled,
        https_port: app.config.httpsPort,
        http2_enabled: app.config.http2Enabled,
        http2_port: app.config.http2Port,
        max_body_bytes: app.config.maxBodyBytes,
        max_response_bytes: app.config.maxResponseBytes,
        max_page_size: app.config.maxPageSize,
        max_delay_ms: app.config.maxDelayMs,
        seed_scale: app.config.seedScale,
      },
    });
  }, { summary: 'Configuración pública no sensible', tag: 'Control' });

  router.add('GET', '/_control/domains', (ctx) => {
    sendJson(ctx, 200, { data: DOMAINS.map((domain) => ({ domain, tables: DOMAIN_TABLES[domain] })) });
  }, { summary: 'Lista dominios y tablas', tag: 'Control' });
}
