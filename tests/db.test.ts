/** Relational integrity, constraints, rollback and aggregate verification. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestServer } from './helpers.js';

let server: TestServer;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

test('el esquema contiene tablas y datos semilla en todos los dominios', () => {
  const db = server.app.db;
  for (const table of [
    'id_users',
    'pr_tasks',
    'shop_orders',
    'lib_loans',
    'edu_grades',
    'hr_salaries',
    'fin_invoices',
  ]) {
    assert.ok(db.count(table) > 0, `${table} debe tener datos`);
  }
  const fk = db.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
  assert.equal(fk?.foreign_keys, 1);
});

test('las claves foráneas y restricciones CHECK se aplican', () => {
  const db = server.app.db;
  assert.throws(
    () =>
      db.insert('shop_products', {
        sku: `BAD-FK-${Date.now()}`,
        name: 'Producto inválido',
        slug: `bad-fk-${Date.now()}`,
        category_id: 999_999,
        price_cents: 100,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    /FOREIGN KEY/i,
  );
  assert.throws(
    () =>
      db.insert('shop_products', {
        sku: `BAD-CHECK-${Date.now()}`,
        name: 'Producto inválido',
        slug: `bad-check-${Date.now()}`,
        category_id: 1,
        price_cents: -1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    /CHECK/i,
  );
});

test('UNIQUE, NOT NULL y relaciones uno-a-uno se aplican', () => {
  const db = server.app.db;
  const admin = db.get<{ email: string }>('SELECT email FROM id_users WHERE id = 1')!;
  assert.throws(
    () =>
      db.insert('id_users', {
        email: admin.email,
        password_hash: 'x',
        display_name: 'Duplicado',
        status: 'active',
        is_admin: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    /UNIQUE/i,
  );
  assert.throws(
    () =>
      db.insert('id_profiles', {
        user_id: 1,
        first_name: 'Duplicado',
        last_name: 'Perfil',
        updated_at: new Date().toISOString(),
      }),
    /UNIQUE/i,
  );
  assert.throws(() => db.run('UPDATE id_profiles SET first_name = NULL WHERE id = 1'), /NOT NULL/i);
});

test('una transacción revierte todos sus cambios al fallar', () => {
  const db = server.app.db;
  const before = db.count('id_users');
  const email = `rollback-${Date.now()}@example.test`;
  assert.throws(() => {
    db.transaction(() => {
      db.insert('id_users', {
        email,
        password_hash: 'x',
        display_name: 'Rollback',
        status: 'active',
        is_admin: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      throw new Error('fallo intencional');
    });
  }, /fallo intencional/);
  assert.equal(db.count('id_users'), before);
  assert.equal(db.get('SELECT id FROM id_users WHERE email = ?', email), undefined);
});

test('las relaciones M:N y los JOIN producen agregados coherentes', () => {
  const db = server.app.db;
  const order = db.get<{ id: number; total_cents: number }>(
    'SELECT id, total_cents FROM shop_orders ORDER BY id LIMIT 1',
  );
  assert.ok(order);
  const items = db.get<{ subtotal: number }>(
    'SELECT COALESCE(SUM(line_total_cents),0) AS subtotal FROM shop_order_items WHERE order_id = ?',
    order.id,
  );
  assert.ok(Number(items?.subtotal) > 0);
  const authorBooks = db.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM lib_book_authors WHERE author_id = (SELECT author_id FROM lib_book_authors LIMIT 1)',
  );
  assert.ok(Number(authorBooks?.n) >= 1);
});

test('las consultas parametrizadas no interpretan SQL en los valores', () => {
  const db = server.app.db;
  const payload = "x'; DROP TABLE id_users;--@example.test";
  const before = db.count('id_users');
  const id = db.insert('id_users', {
    email: payload,
    password_hash: 'x',
    display_name: 'Inyección',
    status: 'active',
    is_admin: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  assert.equal(db.count('id_users'), before + 1);
  assert.ok(db.get('SELECT id FROM id_users WHERE id = ?', id));
  db.run('DELETE FROM id_users WHERE id = ?', id);
  assert.equal(db.count('id_users'), before);
});

test('los campos nullable aceptan NULL y los agregados funcionan', () => {
  const db = server.app.db;
  db.run('UPDATE id_profiles SET phone = NULL, bio = NULL WHERE id = 1');
  const profile = db.get<{ phone: null }>('SELECT phone FROM id_profiles WHERE id = 1');
  assert.equal(profile?.phone, null);
  const stats = db.get<{ avg: number }>('SELECT ROUND(AVG(price_cents),2) AS avg FROM shop_products');
  assert.ok(Number(stats?.avg) > 0);
  const counts = db.all<{ status: string; n: number }>(
    'SELECT status, COUNT(*) AS n FROM shop_orders GROUP BY status ORDER BY n DESC LIMIT 3',
  );
  assert.ok(counts.length >= 2);
});
