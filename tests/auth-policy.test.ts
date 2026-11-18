/** Global auth policy, group-derived permissions and scoped users. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestServer } from './helpers.js';

let server: TestServer;

before(async () => {
  server = await startTestServer({ authRequired: true });
});

after(async () => {
  await server.close();
});

const READ_ENDPOINTS = [
  '/api/v1/identity/users?per_page=1',
  '/api/v1/projects/projects?per_page=1',
  '/api/v1/shop/products?per_page=1',
  '/api/v1/library/books?per_page=1',
  '/api/v1/education/students?per_page=1',
  '/api/v1/hr/employees?per_page=1',
  '/api/v1/finance/accounts?per_page=1',
];

async function login(email: string, password: string): Promise<string> {
  const response = await server.json('POST', '/api/v1/identity/auth/login', {
    body: { email, password },
  });
  assert.equal(response.status, 200);
  return response.body.data.access_token;
}

test('la política global exige autenticación en todos los dominios', async () => {
  for (const endpoint of READ_ENDPOINTS) {
    const response = await server.json('GET', endpoint);
    assert.equal(response.status, 401, endpoint);
    assert.match(response.headers.get('www-authenticate') ?? '', /Bearer/);
  }
  assert.equal((await server.json('GET', '/health')).status, 200);
  assert.equal((await server.json('GET', '/_control/stats')).status, 200);
});

test('los usuarios y grupos semilla ampliados están disponibles', async () => {
  const token = await login('admin@simulator.local', 'Admin123!');
  let response = await server.json('GET', '/api/v1/identity/users?per_page=1', { token });
  assert.equal(response.status, 200);
  assert.equal(response.body.meta.total, 80);

  response = await server.json('GET', '/api/v1/identity/groups?per_page=1', { token });
  assert.equal(response.status, 200);
  assert.equal(response.body.meta.total, 12);

  response = await server.json('GET', '/api/v1/identity/groups/9/roles', { token });
  assert.equal(response.status, 200);
  assert.equal(response.body.data[0].name, 'viewer');
});

test('un usuario sin rol directo recibe permisos de solo lectura desde su grupo', async () => {
  const token = await login('groupviewer@simulator.local', 'Password123!');
  const me = await server.json('GET', '/api/v1/identity/auth/me', { token });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.data.direct_roles, []);
  assert.deepEqual(me.body.data.roles.map((role: { name: string }) => role.name), ['viewer']);
  assert.ok(me.body.data.groups.some((group: { name: string }) => group.name === 'Observadores'));
  assert.ok(me.body.data.permissions.includes('shop:read'));
  assert.ok(!me.body.data.permissions.includes('shop:write'));

  for (const endpoint of READ_ENDPOINTS) {
    const response = await server.json('GET', endpoint, { token });
    assert.equal(response.status, 200, endpoint);
  }

  const denied = await server.json('POST', '/api/v1/shop/products', {
    token,
    body: {
      sku: `GROUP-DENIED-${Date.now()}`,
      name: 'Denied',
      slug: `group-denied-${Date.now()}`,
      category_id: 1,
      price_cents: 100,
    },
  });
  assert.equal(denied.status, 403);
});

test('conceder un rol a un grupo actualiza los permisos efectivos', async () => {
  const admin = await login('admin@simulator.local', 'Admin123!');
  const groupUser = await login('groupviewer@simulator.local', 'Password123!');

  let response = await server.json('POST', '/api/v1/identity/groups/9/roles', {
    token: admin,
    body: { role: 'developer' },
  });
  assert.equal(response.status, 201);

  response = await server.json('GET', '/api/v1/identity/auth/me', { token: groupUser });
  assert.ok(response.body.data.permissions.includes('projects:write'));

  const task = await server.json('POST', '/api/v1/projects/projects/1/tasks', {
    token: groupUser,
    body: { title: 'Tarea autorizada por grupo' },
  });
  assert.equal(task.status, 201);

  response = await server.json('DELETE', '/api/v1/identity/groups/9/roles/3', { token: admin });
  assert.equal(response.status, 204);

  response = await server.json('GET', '/api/v1/identity/auth/me', { token: groupUser });
  assert.ok(!response.body.data.permissions.includes('projects:write'));
  const denied = await server.json('POST', '/api/v1/projects/projects/1/tasks', {
    token: groupUser,
    body: { title: 'No autorizada' },
  });
  assert.equal(denied.status, 403);
});

test('los roles con escritura pueden mutar su dominio', async () => {
  const manager = await login('manager@simulator.local', 'Password123!');
  const unique = Date.now();
  const response = await server.json('POST', '/api/v1/shop/products', {
    token: manager,
    body: {
      sku: `MANAGER-${unique}`,
      name: 'Producto manager',
      slug: `producto-manager-${unique}`,
      category_id: 1,
      price_cents: 500,
    },
  });
  assert.equal(response.status, 201);
});

test('las rutas públicas de autenticación no exigen token', async () => {
  const response = await server.json('POST', '/api/v1/identity/auth/forgot-password', {
    body: { email: 'admin@simulator.local' },
  });
  assert.equal(response.status, 202);
  assert.ok(response.body.data.reset_token);
});
