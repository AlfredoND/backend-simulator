import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { createSecureServer as createHttp2SecureServer, type Http2SecureServer } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { loadConfig, type Config } from './core/config.js';
import { Db } from './db/index.js';
import { createLogger, type Logger } from './core/logger.js';
import { Router } from './http/router.js';
import { createContext, sendError, sendJson, sendText } from './http/index.js';
import { ensureSeeded } from './db/seed.js';
import { HttpError } from './core/errors.js';
import { registerIdentityRoutes } from './domains/identity.js';
import { registerProjectRoutes } from './domains/projects.js';
import { registerShopRoutes } from './domains/shop.js';
import { registerLibraryRoutes } from './domains/library.js';
import { registerEducationRoutes } from './domains/education.js';
import { registerHrRoutes } from './domains/hr.js';
import { registerFinanceRoutes } from './domains/finance.js';
import { registerControlRoutes } from './control/index.js';
import { handleLab } from './lab/index.js';
import { buildOpenApi, docsHtml } from './http/openapi.js';
import { ensureCertificates } from './transport/tls.js';
import { createLocalProxy } from './transport/proxy.js';

export interface AppInstance {
  config: Config;
  db: Db;
  log: Logger;
  router: Router;
  server: Server;
  httpsServer: HttpsServer | null;
  http2Server: Http2SecureServer | null;
  proxyServer: Server | null;
  ports: { http: number | null; https: number | null; http2: number | null; proxy: number | null };
  start(): Promise<number>;
  close(): Promise<void>;
}

export function createApp(overrides: Partial<Config> = {}): AppInstance {
  const config = loadConfig(overrides);
  const log = createLogger(config.logLevel);
  const db = new Db(config.dbPath);
  db.initSchema();
  const seeded = ensureSeeded(db, config);
  if (seeded) log.info('Datos semilla generados', { db: config.dbPath });

  const router = new Router();
  registerIdentityRoutes(router, '/api/v1');
  registerProjectRoutes(router, '/api/v1');
  registerShopRoutes(router, '/api/v1');
  registerLibraryRoutes(router, '/api/v1');
  registerEducationRoutes(router, '/api/v1');
  registerHrRoutes(router, '/api/v1');
  registerFinanceRoutes(router, '/api/v1');
  registerControlRoutes(router);

  router.add('GET', '/', (ctx) => {
    sendJson(ctx, 200, {
      data: {
        name: 'Backend Simulator',
        version: '1.0.0',
        documentation: '/docs',
        openapi: '/openapi.json',
        domains: ['identity', 'projects', 'shop', 'library', 'education', 'hr', 'finance'],
        lab: '/test',
        health: '/health',
      },
    });
  }, { summary: 'Información del servicio' });

  router.add('GET', '/health', (ctx) => {
    sendJson(ctx, 200, {
      data: {
        status: 'ok',
        uptime_seconds: Math.round(process.uptime()),
        database: { ok: db.get<{ ok: number }>('SELECT 1 AS ok')?.ok === 1 },
        timestamp: new Date().toISOString(),
      },
    });
  }, { summary: 'Comprobación de salud' });

  router.add('GET', '/openapi.json', (ctx) => {
    const host = ctx.req.headers.host ?? `${config.host}:${config.port}`;
    const scheme = (ctx.req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http';
    sendJson(ctx, 200, buildOpenApi(router, config, `${scheme}://${host}`), { 'Cache-Control': 'no-store' });
  }, { summary: 'Especificación OpenAPI 3.0' });

  router.add('GET', '/docs', (ctx) => {
    sendText(ctx, 200, docsHtml(), 'text/html; charset=utf-8');
  }, { summary: 'Documentación interactiva' });

  const requestListener = (req: IncomingMessage, res: ServerResponse) => {
    const isHead = (req.method ?? 'GET').toUpperCase() === 'HEAD';
    const ctx = createContext({ config, db, log }, req, res, isHead);
    const started = performance.now();
    res.setHeader('Server', 'Backend-Simulator/1.0');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, ETag, Location, Retry-After');
    res.on('finish', () => {
      log.debug('request', {
        method: req.method,
        path: ctx.url.pathname,
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
        request_id: ctx.requestId,
      });
    });

    void (async () => {
      try {
        const pathname = ctx.url.pathname;
        const method = (req.method ?? 'GET').toUpperCase();
        if (pathname === '/test' || pathname.startsWith('/test/')) {
          await handleLab(ctx);
          return;
        }
        if (method === 'OPTIONS') {
          const allowed = router.allowedMethods(pathname);
          if (allowed.length === 1) {
            throw new HttpError(404, 'NOT_FOUND', 'Ruta no encontrada');
          }
          res.statusCode = 204;
          res.setHeader('Allow', allowed.join(', '));
          res.setHeader('Access-Control-Allow-Methods', allowed.join(', '));
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key, X-Control-Token, Idempotency-Key, Range, If-None-Match, If-Modified-Since');
          res.setHeader('Access-Control-Max-Age', '600');
          res.end();
          return;
        }
        const match = router.match(method, pathname);
        if (!match) {
          const allowed = router.allowedMethods(pathname);
          if (allowed.length > 1) {
            throw new HttpError(405, 'METHOD_NOT_ALLOWED', `Método ${method} no permitido`, {
              headers: { Allow: allowed.join(', ') },
            });
          }
          throw new HttpError(404, 'NOT_FOUND', 'Ruta no encontrada');
        }
        ctx.params = match.params;
        await match.route.handler(ctx);
      } catch (error) {
        if (!res.headersSent) sendError(ctx, error);
        else if (!res.writableEnded) res.end();
      }
    })();
  };

  const server = createServer(requestListener);

  const configureHttpServer = (target: Server | HttpsServer | Http2SecureServer) => {
    const timed = target as unknown as Partial<Pick<Server, 'requestTimeout' | 'headersTimeout' | 'keepAliveTimeout'>>;
    if ('requestTimeout' in target) timed.requestTimeout = config.requestTimeoutMs;
    if ('headersTimeout' in target) timed.headersTimeout = Math.min(config.requestTimeoutMs, 30_000);
    if ('keepAliveTimeout' in target) timed.keepAliveTimeout = 5_000;
    target.on('clientError', (error, socket) => {
      log.warn('client error', { error: error.message });
      if (!socket.writable) return;
      const parseError = error as Error & { code?: string; rawPacket?: Buffer };
      if (parseError.code === 'HPE_INVALID_METHOD' && parseError.rawPacket) {
        const firstLine = parseError.rawPacket.toString('utf8').split('\r\n')[0] ?? '';
        const [customMethod, targetUrl] = firstLine.split(' ');
        if (customMethod && targetUrl?.startsWith('/test/')) {
          const payload = JSON.stringify({
            method: customMethod,
            path: targetUrl.split('?')[0],
            url: targetUrl,
            note: 'Método personalizado capturado por el parser HTTP; el cuerpo no se procesa.',
          });
          socket.end(
            `HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n` +
            `Content-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n\r\n${payload}`,
          );
          return;
        }
      }
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
  };
  configureHttpServer(server);

  let httpsServer: HttpsServer | null = null;
  let http2Server: Http2SecureServer | null = null;
  let proxyServer: Server | null = null;
  const tls = ensureCertificates(config, log);
  if (config.httpsEnabled && tls) {
    httpsServer = createHttpsServer({ key: tls.key, cert: tls.cert }, requestListener);
    configureHttpServer(httpsServer);
  }
  if (config.http2Enabled && tls) {
    http2Server = createHttp2SecureServer(
      { key: tls.key, cert: tls.cert, allowHTTP1: true },
      requestListener as never,
    );
    configureHttpServer(http2Server);
  }
  if (config.proxyEnabled) {
    proxyServer = createLocalProxy(log);
  }

  const ports = { http: null as number | null, https: null as number | null, http2: null as number | null, proxy: null as number | null };

  const listen = (target: Server | HttpsServer | Http2SecureServer, port: number, label: string): Promise<number> =>
    new Promise<number>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      target.once('error', onError);
      target.listen(port, config.host, () => {
        target.off('error', onError);
        const address = target.address() as AddressInfo;
        log.info(`${label} escuchando`, { url: `${label === 'HTTP' ? 'http' : 'https'}://${config.host}:${address.port}` });
        resolve(address.port);
      });
    });

  const closeServer = (target: Server | HttpsServer | Http2SecureServer | null): Promise<void> =>
    new Promise<void>((resolve) => {
      if (!target || !target.listening) {
        resolve();
        return;
      }
      target.close(() => resolve());
      (target as Server).closeAllConnections?.();
    });

  return {
    config,
    db,
    log,
    router,
    server,
    httpsServer,
    http2Server,
    proxyServer,
    ports,
    start: async () => {
      const httpPort = await listen(server, config.port, 'HTTP');
      ports.http = httpPort;
      if (httpsServer) {
        try {
          ports.https = await listen(httpsServer, config.httpsPort, 'HTTPS');
        } catch (error) {
          log.warn('No se pudo iniciar HTTPS', { error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (http2Server) {
        try {
          ports.http2 = await listen(http2Server, config.http2Port, 'HTTP/2');
        } catch (error) {
          log.warn('No se pudo iniciar HTTP/2', { error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (proxyServer) {
        try {
          ports.proxy = await listen(proxyServer, config.proxyPort, 'Proxy');
        } catch (error) {
          log.warn('No se pudo iniciar el proxy', { error: error instanceof Error ? error.message : String(error) });
        }
      }
      return httpPort;
    },
    close: async () => {
      await Promise.all([
        closeServer(server),
        closeServer(httpsServer),
        closeServer(http2Server),
        closeServer(proxyServer),
      ]);
      db.close();
    },
  };
}
