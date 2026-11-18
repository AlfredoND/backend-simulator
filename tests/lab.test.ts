/** HTTP transport laboratory coverage: echo, bodies, redirects, streams and errors. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { ADMIN_TOKEN, TEST_API_KEY, startTestServer, type TestServer } from './helpers.js';

let server: TestServer;

before(async () => {
  server = await startTestServer({ maxBodyBytes: 4096, maxResponseBytes: 1_048_576, maxDelayMs: 5000 });
});

after(async () => {
  await server.close();
});

interface RawResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  trailers: Record<string, string | undefined>;
}

function rawRequest(method: string, path: string, headers: Record<string, string> = {}, body?: string | Buffer): Promise<RawResult> {
  const url = new URL(server.base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path,
      method,
      headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks),
        trailers: res.trailers as Record<string, string | undefined>,
      }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('echo refleja método, query repetida, headers, cookies y body', async () => {
  const res = await rawRequest('GET', '/test/echo?x=1&x=2&name=valor', {
    'X-Custom': 'abc',
    Cookie: 'a=1; b=2',
  });
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body.toString());
  assert.equal(data.method, 'GET');
  assert.deepEqual(data.query.x, ['1', '2']);
  assert.deepEqual(data.headers['X-Custom'], ['abc']);
  assert.deepEqual(data.cookies, { a: '1', b: '2' });
  assert.equal(data.body.size, 0);
});

test('acepta métodos HTTP personalizados', async () => {
  const res = await rawRequest('CUSTOM', '/test/echo');
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body.toString());
  assert.equal(data.method, 'CUSTOM');
  assert.match(data.note, /personalizado/i);
});

test('status configurable, HEAD sin cuerpo y OPTIONS', async () => {
  assert.equal((await rawRequest('GET', '/test/status/418')).status, 418);
  assert.equal((await rawRequest('GET', '/test/status/204')).body.length, 0);
  const head = await rawRequest('HEAD', '/test/echo');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.ok(Number(head.headers['content-length']) > 0);
  const options = await new Promise<number>((resolve) => {
    const req = httpRequest({
      hostname: new URL(server.base).hostname,
      port: new URL(server.base).port,
      path: '/test/echo',
      method: 'OPTIONS',
    }, (res) => { resolve(res.statusCode ?? 0); res.resume(); });
    req.end();
  });
  assert.equal(options, 204);
});

test('cuerpos: JSON inválido, Content-Type incorrecto, límite 413 y vacío', async () => {
  let res = await rawRequest('GET', '/test/body/invalid-json');
  assert.equal(res.status, 200);
  assert.equal(res.body.toString(), '{"broken":');

  res = await rawRequest('GET', '/test/body/wrong-content-type');
  assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');

  res = await rawRequest('POST', '/test/echo', { 'Content-Type': 'application/json' }, 'x'.repeat(5000));
  assert.equal(res.status, 413);
  assert.match(JSON.parse(res.body.toString()).error.code, /PAYLOAD/);

  res = await rawRequest('GET', '/test/body/empty');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 0);
});

test('compresión gzip, deflate, Brotli y negociación por Accept-Encoding', async () => {
  let res = await rawRequest('GET', '/test/compress?algo=gzip&body=hola-mundo');
  assert.equal(res.headers['content-encoding'], 'gzip');
  assert.equal(gunzipSync(res.body).toString(), 'hola-mundo');

  res = await rawRequest('GET', '/test/compress?algo=deflate&body=hola-mundo');
  assert.equal(res.headers['content-encoding'], 'deflate');
  assert.equal(inflateSync(res.body).toString(), 'hola-mundo');

  res = await rawRequest('GET', '/test/compress?algo=br&body=hola-mundo');
  assert.equal(res.headers['content-encoding'], 'br');
  assert.equal(brotliDecompressSync(res.body).toString(), 'hola-mundo');

  res = await rawRequest('GET', '/test/compress?body=negociado', { 'Accept-Encoding': 'br, gzip' });
  assert.equal(res.headers['content-encoding'], 'br');
  assert.equal(brotliDecompressSync(res.body).toString(), 'negociado');
});

test('redirects: códigos, cadena, bucle, destino local y rechazo externo', async () => {
  let res = await rawRequest('GET', '/test/redirect/307?to=/test/echo');
  assert.equal(res.status, 307);
  assert.equal(res.headers.location, '/test/echo');

  res = await rawRequest('GET', '/test/redirect/301?to=/test/echo&absolute=1');
  assert.equal(res.status, 301);
  assert.match(String(res.headers.location), /^http:\/\/127\.0\.0\.1:\d+\/test\/echo$/);

  res = await rawRequest('GET', '/test/redirect/chain/2');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/test/redirect/chain/1');

  res = await rawRequest('GET', '/test/redirect/loop');
  assert.equal(res.headers.location, '/test/redirect/loop');

  res = await rawRequest('GET', '/test/redirect/302?to=https://example.com');
  assert.equal(res.status, 400);
});

test('autenticación de laboratorio: Basic, Bearer, API key y token expirado', async () => {
  let res = await rawRequest('GET', '/test/auth/basic', {
    Authorization: `Basic ${Buffer.from('testuser:testpass').toString('base64')}`,
  });
  assert.equal(res.status, 200);
  res = await rawRequest('GET', '/test/auth/basic', {
    Authorization: `Basic ${Buffer.from('testuser:incorrecta').toString('base64')}`,
  });
  assert.equal(res.status, 401);
  assert.match(String(res.headers['www-authenticate']), /Basic/);

  res = await rawRequest('GET', '/test/auth/bearer', { Authorization: `Bearer ${ADMIN_TOKEN}` });
  assert.equal(res.status, 200);
  res = await rawRequest('GET', '/test/auth/bearer', { Authorization: 'Bearer no-valido' });
  assert.equal(res.status, 401);

  res = await rawRequest('GET', '/test/auth/api-key', { 'X-API-Key': TEST_API_KEY });
  assert.equal(res.status, 200);
  res = await rawRequest('GET', '/test/auth/api-key', { 'X-API-Key': 'mal' });
  assert.equal(res.status, 401);

  res = await rawRequest('GET', '/test/auth/expired');
  assert.equal(res.status, 401);
  assert.match(String(res.headers['www-authenticate']), /invalid_token/);
});

test('cookies: atributos, múltiples cookies, lectura y borrado', async () => {
  let res = await rawRequest('GET', '/test/cookies/set?name=session&value=abc&httpOnly=1&max-age=3600&path=/api');
  assert.equal(res.status, 200);
  const cookie = String(res.headers['set-cookie']);
  assert.match(cookie, /session=abc/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Max-Age=3600/);
  assert.match(cookie, /Path=\/api/);

  res = await rawRequest('GET', '/test/cookies/set-many?count=3');
  assert.equal((res.headers['set-cookie'] as string[]).length, 3);

  res = await rawRequest('GET', '/test/cookies/echo', { Cookie: 'uno=1; dos=2' });
  assert.deepEqual(JSON.parse(res.body.toString()).cookies, { uno: '1', dos: '2' });

  res = await rawRequest('GET', '/test/cookies/delete?name=session');
  assert.match(String(res.headers['set-cookie']), /Max-Age=0/);
});

test('caché: ETag, 304, Last-Modified e If-Modified-Since', async () => {
  let res = await rawRequest('GET', '/test/cache/etag?version=3');
  const etag = String(res.headers.etag);
  assert.match(etag, /v3/);
  res = await rawRequest('GET', '/test/cache/etag?version=3', { 'If-None-Match': etag });
  assert.equal(res.status, 304);
  assert.equal(res.body.length, 0);

  res = await rawRequest('GET', '/test/cache/last-modified?days_ago=1');
  const lastModified = String(res.headers['last-modified']);
  assert.ok(lastModified);
  res = await rawRequest('GET', '/test/cache/last-modified?days_ago=1', { 'If-Modified-Since': lastModified });
  assert.equal(res.status, 304);

  res = await rawRequest('GET', '/test/cache/control?max_age=120');
  assert.match(String(res.headers['cache-control']), /max-age=120/);
  res = await rawRequest('GET', '/test/cache/control?no_store=1');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('descargas y rangos: 200, 206, Content-Range y 416', async () => {
  let res = await rawRequest('GET', '/test/download?size=1000');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1000);
  assert.equal(res.headers['accept-ranges'], 'bytes');

  res = await rawRequest('GET', '/test/download?size=1000', { Range: 'bytes=0-9' });
  assert.equal(res.status, 206);
  assert.equal(res.body.length, 10);
  assert.equal(res.headers['content-range'], 'bytes 0-9/1000');

  res = await rawRequest('GET', '/test/download?size=1000', { Range: 'bytes=99999-' });
  assert.equal(res.status, 416);
  assert.equal(res.headers['content-range'], 'bytes */1000');

  res = await rawRequest('HEAD', '/test/download?size=500');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 0);
  assert.equal(Number(res.headers['content-length']), 500);
});

test('streaming: chunks, trailers, SSE, interrupción y respuesta incompleta', async () => {
  let res = await rawRequest('GET', '/test/stream/text?chunks=3&delay=5&size=16');
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-chunks'], '3');
  assert.equal(res.body.toString().split('\n').filter(Boolean).length, 3);

  res = await rawRequest('GET', '/test/stream/trailers');
  assert.equal(res.status, 200);
  assert.ok(res.trailers['x-trailer-checksum']);
  assert.match(res.body.toString(), /fin/);

  res = await rawRequest('GET', '/test/stream/sse?count=2&delay=5');
  assert.match(String(res.headers['content-type']), /text\/event-stream/);
  assert.match(res.body.toString(), /event: tick/);

  await assert.rejects(async () => {
    const interrupted = await fetch(`${server.base}/test/stream/interrupted?delay=10`);
    await interrupted.text();
  });
  try {
    const incomplete = await fetch(`${server.base}/test/stream/incomplete`);
    const text = await incomplete.text();
    assert.ok(text.length < 1000);
  } catch {
    // El cliente también puede reportar un error de terminación prematura.
  }
});

test('delays, timeout abortable, cierre y errores simulados', async () => {
  const started = Date.now();
  const delayed = await server.json('GET', '/test/delay/80');
  assert.equal(delayed.status, 200);
  assert.ok(Date.now() - started >= 70);

  await assert.rejects(fetch(`${server.base}/test/timeout?ms=2000`, { signal: AbortSignal.timeout(100) }));

  let res = await rawRequest('GET', '/test/error/503');
  assert.equal(res.status, 503);
  assert.equal(res.headers['retry-after'], '5');
  assert.equal(JSON.parse(res.body.toString()).error.code, 'SERVICE_UNAVAILABLE');

  res = await rawRequest('GET', '/test/error/401');
  assert.equal(res.status, 401);
  assert.ok(res.headers['www-authenticate']);

  await assert.rejects(fetch(`${server.base}/test/close`));
  await assert.rejects(fetch(`${server.base}/test/raw/malformed`));
});

test('rate limit, idempotencia, contador y concurrencia', async () => {
  let res = await rawRequest('GET', '/test/rate-limit?limit=1&key=a');
  assert.equal(res.status, 200);
  res = await rawRequest('GET', '/test/rate-limit?limit=1&key=a');
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers['retry-after']) >= 1);

  res = await rawRequest('POST', '/test/idempotency', { 'Idempotency-Key': 'k-1' });
  assert.equal(res.status, 201);
  const first = JSON.parse(res.body.toString());
  res = await rawRequest('POST', '/test/idempotency', { 'Idempotency-Key': 'k-1' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['idempotent-replay'], 'true');
  assert.equal(JSON.parse(res.body.toString()).id, first.id);

  const concurrentStart = Date.now();
  const responses = await Promise.all([1, 2, 3].map((id) => server.json('GET', `/test/concurrency?delay=100&id=${id}`)));
  assert.ok(Date.now() - concurrentStart < 500);
  for (const response of responses) {
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }
  assert.deepEqual(responses.map((r) => r.body.id), ['1', '2', '3']);

  res = await rawRequest('GET', '/test/counter');
  assert.equal(res.status, 200);
  assert.ok(JSON.parse(res.body.toString()).counter >= 1);
});

test('respuestas vacías, binarias, HTML/XML/CSV y HEAD', async () => {
  let res = await rawRequest('GET', '/test/response/no-content');
  assert.equal(res.status, 204);
  assert.equal(res.body.length, 0);
  res = await rawRequest('GET', '/test/response/binary?size=128');
  assert.equal(res.body.length, 128);
  assert.equal(res.headers['content-type'], 'application/octet-stream');
  res = await rawRequest('GET', '/test/response/html');
  assert.match(String(res.headers['content-type']), /text\/html/);
  res = await rawRequest('GET', '/test/response/xml');
  assert.match(res.body.toString(), /<root>/);
  res = await rawRequest('GET', '/test/response/csv');
  assert.match(res.body.toString(), /id,nombre,precio/);
  res = await rawRequest('HEAD', '/test/response/large?size=4096');
  assert.equal(res.body.length, 0);
  assert.equal(Number(res.headers['content-length']), 4096);
});
