/** Integration coverage for auth, CRUD, business flows, ETags and control endpoints. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_TOKEN, CONTROL_TOKEN, TEST_API_KEY, VIEWER_TOKEN, startTestServer, type TestServer } from './helpers.js';

let server: TestServer;

before(async () => {
  server = await startTestServer({ maxBodyBytes: 512_000 });
});

after(async () => {
  await server.close();
});

function variantWithStock(min = 2): { id: number; available: number } {
  const row = server.app.db.get<{ id: number; available: number }>(
    `SELECT v.id, COALESCE(SUM(i.quantity - i.reserved),0) AS available
     FROM shop_variants v LEFT JOIN shop_inventory i ON i.variant_id = v.id
     WHERE v.is_active = 1 GROUP BY v.id HAVING available >= ? ORDER BY v.id LIMIT 1`,
    min,
  );
  assert.ok(row, 'debe existir una variante con stock');
  return row;
}

function stockOf(variantId: number): number {
  return Number(server.app.db.get<{ n: number }>(
    'SELECT COALESCE(SUM(quantity - reserved),0) AS n FROM shop_inventory WHERE variant_id = ?',
    variantId,
  )?.n ?? 0);
}

test('autenticación: 401, login, me, API key y 403 por permisos', async () => {
  let res = await server.json('GET', '/api/v1/identity/users');
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate') ?? '', /Bearer/);

  res = await server.json('GET', '/api/v1/identity/users', { token: VIEWER_TOKEN });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length > 0);

  res = await server.json('POST', '/api/v1/identity/users', {
    token: VIEWER_TOKEN,
    body: { email: 'viewer-cannot@example.test', password: 'Password123!', display_name: 'No' },
  });
  assert.equal(res.status, 403);

  const login = await server.json('POST', '/api/v1/identity/auth/login', {
    body: { email: 'admin@simulator.local', password: 'Admin123!' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.token_type, 'Bearer');
  assert.ok(login.body.data.access_token.length > 20);

  res = await server.json('GET', '/api/v1/identity/auth/me', { token: login.body.data.access_token });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.email, 'admin@simulator.local');
  assert.ok(Array.isArray(res.body.data.permissions));

  const refreshed = await server.json('POST', '/api/v1/identity/auth/refresh', {
    body: { refresh_token: login.body.data.refresh_token },
  });
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.data.access_token);
  assert.equal((await server.json('GET', '/api/v1/identity/auth/me', { token: login.body.data.access_token })).status, 401);
  assert.equal((await server.json('GET', '/api/v1/identity/auth/me', { token: refreshed.body.data.access_token })).status, 200);

  res = await server.json('GET', '/api/v1/identity/users', { headers: { 'X-API-Key': TEST_API_KEY } });
  assert.equal(res.status, 200);

  const bad = await server.json('POST', '/api/v1/identity/auth/login', {
    body: { email: 'admin@simulator.local', password: 'incorrecta' },
  });
  assert.equal(bad.status, 401);

  const wrongType = await server.json('POST', '/api/v1/identity/auth/login', {
    rawBody: 'email=admin@simulator.local',
    headers: { 'Content-Type': 'text/plain' },
  });
  assert.equal(wrongType.status, 415);

  const invalidJson = await server.json('POST', '/api/v1/identity/auth/login', { rawBody: '{"email":' });
  assert.equal(invalidJson.status, 400);
});

test('usuarios: validación 422, conflicto 409, creación y métodos HEAD/OPTIONS', async () => {
  const unique = `api-test-${Date.now()}`;
  let res = await server.json('POST', '/api/v1/identity/users', {
    token: ADMIN_TOKEN,
    body: { email: `${unique}@example.test`, password: 'Password123!', display_name: 'Usuario API' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.email, `${unique}@example.test`);
  assert.equal(res.body.data.password_hash, undefined);

  res = await server.json('POST', '/api/v1/identity/users', {
    token: ADMIN_TOKEN,
    body: { email: `${unique}@example.test`, password: 'Password123!', display_name: 'Duplicado' },
  });
  assert.equal(res.status, 409);

  res = await server.json('POST', '/api/v1/identity/users', {
    token: ADMIN_TOKEN,
    body: { email: 'invalido', password: '123', unknown_field: true },
  });
  assert.equal(res.status, 422);
  assert.ok(Array.isArray(res.body.error.details));

  const head = await server.request('HEAD', '/api/v1/identity/users', { token: ADMIN_TOKEN });
  assert.equal(head.status, 200);
  assert.ok(Number(head.headers.get('content-length')) > 0);
  assert.equal((await head.arrayBuffer()).byteLength, 0);

  const options = await server.request('OPTIONS', '/api/v1/identity/users');
  assert.equal(options.status, 204);
  assert.match(options.headers.get('allow') ?? '', /GET/);
  assert.match(options.headers.get('allow') ?? '', /POST/);
});

test('paginación, orden, selección de campos, filtros y búsqueda', async () => {
  let res = await server.json('GET', '/api/v1/shop/products?per_page=5&sort=-price_cents&fields=id,name,price_cents&status=active');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 5);
  assert.ok(res.body.meta.total > 5);
  assert.deepEqual(Object.keys(res.body.data[0]).sort(), ['id', 'name', 'price_cents']);
  assert.ok(Number(res.body.data[0].price_cents) >= Number(res.body.data[1].price_cents));

  res = await server.json('GET', '/api/v1/shop/products?price_cents_gte=1000&price_cents_lte=100000&q=portátil&per_page=10');
  assert.equal(res.status, 200);
  for (const row of res.body.data) {
    assert.ok(Number(row.price_cents) >= 1000);
    assert.ok(Number(row.price_cents) <= 100_000);
  }

  assert.equal((await server.json('GET', '/api/v1/shop/products?sort=no_existe')).status, 422);
  assert.equal((await server.json('GET', '/api/v1/shop/products?parametro_raro=1')).status, 422);
  assert.equal((await server.json('GET', '/api/v1/shop/products/999999')).status, 404);
});

test('CRUD, ETag, If-None-Match, If-Match y 412', async () => {
  const unique = Date.now();
  let res = await server.json('POST', '/api/v1/shop/products', {
    body: {
      sku: `API-${unique}`,
      name: `Producto API ${unique}`,
      slug: `producto-api-${unique}`,
      category_id: 1,
      price_cents: 2500,
    },
  });
  assert.equal(res.status, 201);
  const id = res.body.data.id;

  res = await server.json('GET', `/api/v1/shop/products/${id}`);
  assert.equal(res.status, 200);
  const etag = res.headers.get('etag');
  assert.ok(etag?.startsWith('"'));

  res = await server.json('GET', `/api/v1/shop/products/${id}`, {
    headers: { 'If-None-Match': etag! },
  });
  assert.equal(res.status, 304);

  res = await server.json('PATCH', `/api/v1/shop/products/${id}`, {
    headers: { 'If-Match': '"incorrecto"' },
    body: { description: 'cambio' },
  });
  assert.equal(res.status, 412);

  res = await server.json('PATCH', `/api/v1/shop/products/${id}`, {
    headers: { 'If-Match': etag! },
    body: { description: 'cambio aceptado' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.description, 'cambio aceptado');
  const newEtag = res.headers.get('etag');
  assert.notEqual(newEtag, etag);

  assert.equal((await server.json('DELETE', `/api/v1/shop/products/${id}`)).status, 204);
  assert.equal((await server.json('GET', `/api/v1/shop/products/${id}`)).status, 404);
});

test('proyectos: tareas, subtareas, cambio de estado y estadísticas', async () => {
  let res = await server.json('POST', '/api/v1/projects/projects/1/tasks', {
    body: { title: 'Tarea de prueba API', priority: 'high', estimate_minutes: 90 },
  });
  assert.equal(res.status, 201);
  const taskId = res.body.data.id;
  assert.equal(res.body.data.project_id, 1);

  res = await server.json('POST', `/api/v1/projects/tasks/${taskId}/subtasks`, {
    body: { title: 'Subtarea de prueba', assignee_id: 3 },
  });
  assert.equal(res.status, 201);

  res = await server.json('PATCH', `/api/v1/projects/tasks/${taskId}/status`, { body: { status: 'done' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status_category, 'done');

  res = await server.json('GET', '/api/v1/projects/projects/1/stats');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.total_tasks >= 4);
  assert.ok(res.body.data.done_tasks >= 1);

  res = await server.json('GET', '/api/v1/projects/projects/1/tasks?priority=high&per_page=5');
  assert.equal(res.status, 200);
  for (const task of res.body.data) assert.equal(task.priority, 'high');
});

test('e-commerce: checkout atómico, stock, cancelación y cupones', async () => {
  const variant = variantWithStock(3);
  const before = stockOf(variant.id);

  let res = await server.json('POST', '/api/v1/shop/carts', { body: { customer_id: 1 } });
  assert.equal(res.status, 201);
  const cartId = res.body.data.id;

  res = await server.json('POST', `/api/v1/shop/carts/${cartId}/items`, {
    body: { variant_id: variant.id, quantity: 2 },
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.data.total_cents > 0);

  res = await server.json('POST', `/api/v1/shop/carts/${cartId}/checkout`, {
    body: { shipping_address_id: 1, payment_method_id: 1, coupon_code: 'SAVE10' },
  });
  assert.equal(res.status, 201);
  const orderId = res.body.data.id;
  assert.equal(res.body.data.status, 'paid');
  assert.ok(res.body.data.items.length >= 1);
  assert.ok(res.body.data.payments.length >= 1);
  assert.equal(stockOf(variant.id), before - 2);

  res = await server.json('POST', `/api/v1/shop/orders/${orderId}/cancel`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'cancelled');
  assert.equal(stockOf(variant.id), before);

  res = await server.json('POST', '/api/v1/shop/carts', { body: { customer_id: 1 } });
  const emptyCart = res.body.data.id;
  res = await server.json('POST', `/api/v1/shop/carts/${emptyCart}/checkout`, { body: {} });
  assert.equal(res.status, 409);

  res = await server.json('POST', `/api/v1/shop/carts/${emptyCart}/items`, {
    body: { variant_id: variant.id, quantity: 1000 },
  });
  assert.equal(res.status, 409);

  res = await server.json('GET', '/api/v1/shop/coupons/validate?code=SAVE10&subtotal_cents=10000');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.discount_cents, 1000);
});

test('biblioteca: búsqueda, préstamo y devolución', async () => {
  let res = await server.json('GET', '/api/v1/library/books/search?q=Cien&per_page=5');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length >= 1);

  const copy = server.app.db.get<{ id: number }>("SELECT id FROM lib_copies WHERE status = 'available' ORDER BY id LIMIT 1");
  assert.ok(copy);
  res = await server.json('POST', '/api/v1/library/loans', { body: { copy_id: copy.id, reader_id: 1, days: 14 } });
  assert.equal(res.status, 201);
  const loanId = res.body.data.id;

  res = await server.json('POST', `/api/v1/library/loans/${loanId}/return`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'returned');
  assert.ok(res.body.meta.days_late >= 0);

  res = await server.json('GET', '/api/v1/library/books/1/availability');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.total_copies > 0);

  res = await server.json('GET', '/api/v1/library/readers/1/summary');
  assert.equal(res.status, 200);
  assert.ok('active_loans' in res.body.data);
});

test('educación: matrícula por sección, asistencia en lote e historial', async () => {
  const unique = Date.now();
  let res = await server.json('POST', '/api/v1/education/students', {
    body: {
      student_code: `API-STU-${unique}`,
      full_name: 'Estudiante API',
      email: `api-student-${unique}@education.test`,
      enrolled_at: '2026-09-01',
    },
  });
  assert.equal(res.status, 201);
  const studentId = res.body.data.id;

  res = await server.json('POST', '/api/v1/education/sections/1/enroll', { body: { student_id: studentId } });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.section_id, 1);

  res = await server.json('POST', '/api/v1/education/attendance/bulk', {
    body: {
      records: [
        { student_id: studentId, section_id: 1, attendance_date: '2026-11-11', status: 'present' },
        { student_id: studentId, section_id: 1, attendance_date: '2026-11-12', status: 'late', notes: '10 minutos' },
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.saved, 2);

  res = await server.json('GET', `/api/v1/education/students/${studentId}/transcript`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.enrollments));
  assert.ok(res.body.data.attendance_summary.present >= 1);
});

test('RRHH: vacaciones con saldo y nóminas agregadas', async () => {
  let res = await server.json('POST', '/api/v1/hr/vacations/request', {
    body: { employee_id: 1, start_date: '2027-03-01', end_date: '2027-03-03', days: 3, reason: 'Prueba' },
  });
  assert.equal(res.status, 201);
  const vacationId = res.body.data.id;
  res = await server.json('PATCH', `/api/v1/hr/vacations/${vacationId}/decision`, { body: { status: 'approved' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'approved');

  res = await server.json('GET', '/api/v1/hr/vacations/balance/1?year=2027');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.used, 3);
  assert.equal(res.body.data.remaining, 27);

  res = await server.json('GET', '/api/v1/hr/reports/payroll');
  assert.equal(res.status, 200);
  assert.ok(Number(res.body.data.totals.net) > 0);

  res = await server.json('GET', '/api/v1/hr/departments/1/summary');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.headcount.total >= 1);
});

test('finanzas: factura, pago, movimiento y reportes', async () => {
  const before = Number(server.app.db.get<{ balance_cents: number }>('SELECT balance_cents FROM fin_accounts WHERE id = 2')?.balance_cents ?? 0);
  const unique = Date.now();
  let res = await server.json('POST', '/api/v1/finance/invoices', {
    body: {
      invoice_number: `API-INV-${unique}`,
      customer_name: 'Cliente API',
      items: [{ description: 'Servicio API', quantity: 2, unit_price_cents: 5000 }],
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.subtotal_cents, 10_000);
  assert.equal(res.body.data.tax_cents, 2100);
  assert.equal(res.body.data.total_cents, 12_100);
  const invoiceId = res.body.data.id;

  res = await server.json('POST', `/api/v1/finance/invoices/${invoiceId}/pay`, {
    body: { account_id: 2, method: 'transfer', reference: `API-PAY-${unique}` },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.status, 'paid');
  assert.equal(res.body.data.balance_cents, 0);
  const after = Number(server.app.db.get<{ balance_cents: number }>('SELECT balance_cents FROM fin_accounts WHERE id = 2')?.balance_cents ?? 0);
  assert.equal(after, before - 12_100);

  res = await server.json('POST', '/api/v1/finance/transactions', {
    body: {
      account_id: 2, kind: 'credit', amount_cents: 1000,
      description: 'Ingreso API', reference: `API-TX-${unique}`,
    },
  });
  assert.equal(res.status, 201);

  res = await server.json('GET', '/api/v1/finance/reports/balance');
  assert.equal(res.status, 200);
  assert.ok('assets_cents' in res.body.data);

  res = await server.json('GET', '/api/v1/finance/reports/expenses?group_by=category');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));

  res = await server.json('GET', '/api/v1/finance/budgets/utilization?year=2026');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length >= 1);
});

test('control: estadísticas públicas y reseteo protegido por token', async () => {
  let res = await server.json('GET', '/_control/stats');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.total_records > 1000);
  assert.ok(res.body.data.domains.shop.total > 100);

  res = await server.json('POST', '/_control/reset/shop');
  assert.equal(res.status, 401);

  res = await server.json('POST', '/_control/reset/shop', { headers: { 'X-Control-Token': CONTROL_TOKEN } });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.reset, 'shop');

  const before = Number(server.app.db.count('id_users'));
  res = await server.json('POST', '/_control/seed', {
    headers: { 'X-Control-Token': CONTROL_TOKEN },
    body: { entity: 'users', count: 2 },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.created, 2);
  assert.equal(server.app.db.count('id_users'), before + 2);
});

test('OpenAPI, docs, health y errores de ruta', async () => {
  let res = await server.json('GET', '/openapi.json');
  assert.equal(res.status, 200);
  assert.equal(res.body.openapi, '3.0.3');
  assert.ok(res.body.paths['/api/v1/shop/products']);
  assert.ok(res.body.paths['/test/echo']);
  assert.ok(res.body.components.securitySchemes.bearerAuth);
  assert.ok(res.body.components.securitySchemes.controlToken);

  res = await server.json('GET', '/docs');
  assert.equal(res.status, 200);
  assert.match(String(res.body), /openapi\.json/);

  res = await server.json('GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'ok');

  assert.equal((await server.json('GET', '/api/v1/no-existe')).status, 404);
  const wrongMethod = await server.request('DELETE', '/api/v1/projects/projects');
  assert.equal(wrongMethod.status, 405);
  assert.match(wrongMethod.headers.get('allow') ?? '', /GET/);
});
