import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestServer } from './helpers.js';
import { missingEnglishSummaries } from '../src/http/openapi-i18n.js';

let server: TestServer;

before(async () => {
  server = await startTestServer({ authRequired: false });
});

after(async () => {
  await server.close();
});

function operations(spec: any): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [path, methods] of Object.entries<any>(spec.paths)) {
    for (const [method, operation] of Object.entries<any>(methods)) {
      result[`${method.toUpperCase()} ${path}`] = operation;
    }
  }
  return result;
}

test('publica especificaciones OpenAPI en español e inglés', async () => {
  const es = await server.json('GET', '/openapi.json');
  const en = await server.json('GET', '/openapi.en.json');
  assert.equal(es.status, 200);
  assert.equal(en.status, 200);
  assert.equal(en.body.info.title, 'Backend Simulator');
  assert.match(en.body.info.description, /Local HTTP backend simulator/);
  assert.match(es.body.info.description, /Simulador local de backend HTTP/);
  assert.deepEqual(Object.keys(es.body.paths), Object.keys(en.body.paths));

  const esOps = operations(es.body);
  const enOps = operations(en.body);
  assert.deepEqual(Object.keys(esOps), Object.keys(enOps));
  assert.equal(enOps['GET /api/v1/shop/products'].summary, 'List products');
  assert.equal(esOps['GET /api/v1/shop/products'].summary, 'Lista producto');
  assert.equal(enOps['GET /test/echo'].summary, 'Reflects the request method, URL, query, headers, cookies and body');
  assert.equal(en.body.tags.find((tag: any) => tag.name === 'Shop · Catalog').description, 'Products, variants, brands and categories.');
});

test('todas las operaciones personalizadas tienen resumen inglés', () => {
  const missing = missingEnglishSummaries(server.app.router.routes);
  assert.deepEqual(missing, []);
});

test('traduce parámetros de filtro y descripciones de respuesta', async () => {
  const en = await server.json('GET', '/openapi.en.json');
  const operation = en.body.paths['/api/v1/shop/products'].get;
  const filter = operation.parameters.find((parameter: any) => parameter.name === 'status');
  assert.equal(filter.description, 'Exact filter by status. Repeat for IN.');
  assert.equal(operation.responses['200'].description, 'Paginated list of products');
  assert.equal(operation.responses['500'].$ref, '#/components/responses/InternalError');
});

test('la UI de documentación permite elegir idioma', async () => {
  let response = await server.request('GET', '/docs');
  let html = await response.text();
  assert.match(html, /<html lang="es">/);
  assert.match(html, /\/openapi\.json/);

  response = await server.request('GET', '/docs?lang=en');
  html = await response.text();
  assert.match(html, /<html lang="en">/);
  assert.match(html, /\/openapi\.en\.json/);

  const aliased = await server.json('GET', '/openapi.json?lang=en');
  assert.match(aliased.body.info.description, /Local HTTP backend simulator/);

  const root = await server.json('GET', '/');
  assert.equal(root.body.data.openapi_en, '/openapi.en.json');
  assert.equal(root.body.data.docs_en, '/docs?lang=en');
});
