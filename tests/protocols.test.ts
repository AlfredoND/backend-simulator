import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { connect as http2Connect } from 'node:http2';
import { connect as netConnect } from 'node:net';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer, type TestServer } from './helpers.js';

let server: TestServer;
let certDir: string;

before(async () => {
  certDir = mkdtempSync(join(tmpdir(), 'backend-certs-'));
  server = await startTestServer({
    httpsEnabled: true,
    http2Enabled: true,
    proxyEnabled: true,
    httpsPort: 0,
    http2Port: 0,
    proxyPort: 0,
    tlsCertPath: join(certDir, 'cert.pem'),
    tlsKeyPath: join(certDir, 'key.pem'),
  });
});

after(async () => {
  await server.close();
  rmSync(certDir, { recursive: true, force: true });
});

function httpsGet(path: string): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: 'localhost',
      port: server.app.ports.https!,
      path,
      rejectUnauthorized: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

function http2Get(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const session = http2Connect(`https://localhost:${server.app.ports.http2}`, { rejectUnauthorized: false });
    const req = session.request({ ':path': path });
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      session.close();
      resolve(Buffer.concat(chunks).toString());
    });
    req.on('error', reject);
    req.end();
  });
}

test('genera certificado local y sirve HTTPS con el mismo enrutado', async () => {
  assert.ok(existsSync(join(certDir, 'cert.pem')));
  assert.ok(existsSync(join(certDir, 'key.pem')));
  assert.ok(server.app.ports.https);
  const health = await httpsGet('/health');
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).data.status, 'ok');
  const echo = await httpsGet('/test/echo');
  const data = JSON.parse(echo.body);
  assert.equal(data.scheme, 'https');
  assert.equal(data.http_version, '1.1');
});

test('HTTP/2 sobre TLS responde con versión 2.0', async () => {
  assert.ok(server.app.ports.http2);
  const body = await http2Get('/test/echo');
  const data = JSON.parse(body);
  assert.equal(data.http_version, '2.0');
  assert.equal(data.path, '/test/echo');
});

test('proxy HTTP local reenvía peticiones absolutas y rechaza destinos externos', async () => {
  assert.ok(server.app.ports.proxy);
  const proxyPort = server.app.ports.proxy!;
  const target = `${server.base}/test/echo?via=proxy`;

  const proxied = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const client = netConnect(proxyPort, '127.0.0.1', () => {
      client.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${server.app.ports.http}\r\nConnection: close\r\n\r\n`);
    });
    const chunks: Buffer[] = [];
    client.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    client.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      const [head, ...rest] = raw.split('\r\n\r\n');
      const status = Number(head.split(' ')[1]);
      resolve({ status, body: rest.join('\r\n\r\n') });
    });
    client.on('error', reject);
  });
  assert.equal(proxied.status, 200);
  assert.equal(JSON.parse(proxied.body).path, '/test/echo');

  const rejected = await new Promise<string>((resolve, reject) => {
    const client = netConnect(proxyPort, '127.0.0.1', () => {
      client.write('GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n');
    });
    const chunks: Buffer[] = [];
    client.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    client.on('end', () => resolve(Buffer.concat(chunks).toString()));
    client.on('error', reject);
  });
  assert.match(rejected, /403/);
});

test('CONNECT crea un túnel hacia un destino local', async () => {
  const proxyPort = server.app.ports.proxy!;
  const targetPort = server.app.ports.http!;
  const response = await new Promise<string>((resolve, reject) => {
    const client = netConnect(proxyPort, '127.0.0.1', () => {
      client.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`);
    });
    let phase = 'connect';
    let data = '';
    client.on('data', (chunk) => {
      data += chunk.toString();
      if (phase === 'connect' && data.includes('\r\n\r\n')) {
        assert.match(data, /200 Connection Established/);
        phase = 'tunnel';
        data = '';
        client.write(`GET /health HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nConnection: close\r\n\r\n`);
      } else if (phase === 'tunnel' && data.includes('\r\n\r\n')) {
        resolve(data);
        client.end();
      }
    });
    client.on('error', reject);
  });
  assert.match(response, /200 OK/);
  assert.match(response, /"status":"ok"/);
});
