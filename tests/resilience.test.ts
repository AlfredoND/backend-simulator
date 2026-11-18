/** Cross-cutting 429/500/503 injection and global rate limiting. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestServer } from './helpers.js';

let server: TestServer;
const domains = ['identity', 'projects', 'shop', 'library', 'education', 'hr', 'finance'];

before(async () => {
  server = await startTestServer({ authRequired: false });
});

after(async () => {
  await server.close();
});

test('inyecta 429, 500 y 503 en todos los dominios de negocio', async () => {
  for (const domain of domains) {
    for (const code of [429, 500, 503]) {
      const response = await server.json('GET', `/api/v1/${domain}`, {
        headers: { 'X-Simulate-Error': String(code) },
      });
      assert.equal(response.status, code, `${domain}/${code}`);
      assert.equal(typeof response.body.error.code, 'string');
      if (code === 429) assert.ok(response.headers.get('retry-after'));
      if (code === 503) assert.equal(response.headers.get('retry-after'), '5');
    }
  }
});

test('permite simular errores mediante query y rechaza códigos no soportados', async () => {
  let response = await server.json('GET', '/api/v1/shop/products?simulate_error=503');
  assert.equal(response.status, 503);

  response = await server.json('GET', '/api/v1/shop/products?simulate_error=404');
  assert.equal(response.status, 422);

  response = await server.json('GET', '/api/v1/shop/products', {
    headers: { 'X-Simulate-Error': '418' },
  });
  assert.equal(response.status, 422);
});

test('el rate limit global devuelve 429 y cabeceras informativas', async () => {
  const limited = await startTestServer({
    authRequired: false,
    apiRateLimitMax: 2,
    apiRateLimitWindowMs: 60_000,
  });
  try {
    const first = await limited.json('GET', '/health');
    assert.equal(first.status, 200);
    const firstApi = await limited.json('GET', '/api/v1/shop/products?per_page=1');
    assert.equal(firstApi.status, 200);
    assert.equal(firstApi.headers.get('x-ratelimit-limit'), '2');
    assert.equal(firstApi.headers.get('x-ratelimit-remaining'), '1');

    const second = await limited.json('GET', '/api/v1/shop/products?per_page=1');
    assert.equal(second.status, 200);
    const third = await limited.json('GET', '/api/v1/shop/products?per_page=1');
    assert.equal(third.status, 429);
    assert.ok(Number(third.headers.get('retry-after')) >= 1);
    assert.equal(third.headers.get('x-ratelimit-remaining'), '0');
  } finally {
    await limited.close();
  }
});

test('la inyección de fallos puede deshabilitarse', async () => {
  const disabled = await startTestServer({ authRequired: false, faultInjectionEnabled: false });
  try {
    const response = await disabled.json('GET', '/api/v1/shop/products', {
      headers: { 'X-Simulate-Error': '500' },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FAULT_INJECTION_DISABLED');
  } finally {
    await disabled.close();
  }
});
