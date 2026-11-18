/**
 * @file Optional local forward proxy.
 *
 * Supports absolute HTTP(S) URLs and CONNECT tunnels, but only for loopback
 * targets. This is intentional: the proxy is a client-testing tool, not an open
 * relay. TLS upstreams use `rejectUnauthorized=false` only for local test hosts.
 */
import { createServer, request as httpRequest, type Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect } from 'node:net';
import type { Logger } from '../core/logger.js';

function isLocalHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

/**
 * Proxy de reenvío local para probar clientes HTTP. Solo permite destinos locales
 * para no convertirse en un proxy abierto. Soporta peticiones absolutas y CONNECT.
 */
/** Creates the loopback-only proxy server; caller controls listening/port. */
export function createLocalProxy(log: Logger): Server {
  const server = createServer((req, res) => {
    let target: URL;
    try {
      target = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'BAD_PROXY_REQUEST', message: 'URL de proxy inválida' } }));
      return;
    }
    if (!req.url?.startsWith('http://') && !req.url?.startsWith('https://')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'ABSOLUTE_URL_REQUIRED', message: 'El proxy requiere una URL absoluta' } }));
      return;
    }
    if (!isLocalHost(target.hostname)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'TARGET_NOT_ALLOWED', message: 'Solo se permiten destinos locales' } }));
      return;
    }
    const isHttps = target.protocol === 'https:';
    const requester = isHttps ? httpsRequest : httpRequest;
    const upstream = requester({
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers: { ...req.headers, host: target.host, 'x-forwarded-proxy': 'backend-simulator' },
      ...(isHttps ? { rejectUnauthorized: false } : {}),
    } as never, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.on('error', (error) => {
      log.warn('proxy upstream error', { error: error.message, target: target.toString() });
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'PROXY_UPSTREAM_ERROR', message: error.message } }));
      } else {
        res.destroy();
      }
    });
    req.pipe(upstream);
  });

  server.on('connect', (req, clientSocket, head) => {
    const [host, portRaw] = (req.url ?? '').split(':');
    const port = Number(portRaw || 443);
    if (!isLocalHost(host ?? '') || !Number.isInteger(port)) {
      clientSocket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const upstream = netConnect(port, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => {
      if (clientSocket.writable) clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
    });
  });

  return server;
}
