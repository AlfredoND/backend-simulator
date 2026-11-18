import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { startTestServer, type TestServer } from './helpers.js';

let server: TestServer;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

function rawGet(path: string): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  const url = new URL(server.base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: url.hostname, port: url.port, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString(),
        headers: res.headers,
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('sirve la interfaz estática y redirige /ui a /ui/', async () => {
  let response = await server.request('GET', '/ui', { redirect: 'manual' });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), '/ui/');

  response = await server.request('GET', '/ui/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.match(await response.text(), /Backend Simulator/);

  response = await server.request('GET', '/ui/styles.css');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/css/);

  response = await server.request('GET', '/ui/js/main.js');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /javascript/);

  response = await server.request('GET', '/ui/favicon.svg');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /image\/svg\+xml/);
});

test('HEAD y OPTIONS funcionan sobre la interfaz', async () => {
  const head = await server.request('HEAD', '/ui/');
  assert.equal(head.status, 200);
  assert.ok(Number(head.headers.get('content-length')) > 0);
  assert.equal((await head.arrayBuffer()).byteLength, 0);

  const options = await server.request('OPTIONS', '/ui/js/main.js');
  assert.equal(options.status, 204);
  assert.match(options.headers.get('allow') ?? '', /GET/);
});

test('protege el directorio estático frente a traversal y métodos no permitidos', async () => {
  const traversal = await rawGet('/ui/%2e%2e/package.json');
  assert.equal(traversal.status, 404);
  assert.doesNotMatch(traversal.body, /dependencies/);

  const missing = await server.request('GET', '/ui/js/missing.js');
  assert.equal(missing.status, 404);

  const denied = await server.request('POST', '/ui/');
  assert.equal(denied.status, 405);
  assert.match(denied.headers.get('allow') ?? '', /GET/);
});

test('la raíz del API anuncia la interfaz', async () => {
  const { status, body } = await server.json('GET', '/');
  assert.equal(status, 200);
  assert.equal(body.data.ui, '/ui/');
});
