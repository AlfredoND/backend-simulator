/**
 * @file Independent HTTP transport laboratory (`/test`).
 *
 * No SQLite or domain state is touched. Handlers intentionally expose raw
 * transport edge cases: malformed frames, socket resets, incomplete responses,
 * compression, ranges, trailers, delays, rate limits and idempotent replays.
 * In-memory simulation state is process-local by design.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import type { Ctx } from '../http/router.js';
import type { RequestContext } from '../http/index.js';
import { parseCookies, readRawBody, sendBuffer, sendJson, sendText } from '../http/index.js';
import { badRequest, notFound, validationError } from '../core/errors.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isTls = (ctx: Ctx): boolean => Boolean((ctx.req.socket as { encrypted?: boolean }).encrypted);
const now = () => new Date().toISOString();
const counterState = { value: 0 };
const rateState = new Map<string, { count: number; resetAt: number }>();
const idempotencyState = new Map<string, { status: number; body: unknown; createdAt: string }>();

function configOf(ctx: Ctx) {
  return (ctx as RequestContext).app.config;
}

function integerParam(ctx: Ctx, name: string, fallback: number, min: number, max: number): number {
  const raw = ctx.query.get(name);
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw validationError([{ field: name, message: `entero entre ${min} y ${max}` }]);
  }
  return value;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function rawHeaderPairs(ctx: Ctx): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (let i = 0; i < ctx.req.rawHeaders.length; i += 2) {
    const key = ctx.req.rawHeaders[i];
    const value = ctx.req.rawHeaders[i + 1] ?? '';
    let values = result[key];
    if (!values) {
      values = [];
      result[key] = values;
    }
    values.push(value);
  }
  return result;
}

function queryObject(ctx: Ctx): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of ctx.url.searchParams.entries()) {
    const current = result[key];
    if (current === undefined) result[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else result[key] = [current, value];
  }
  return result;
}

async function echo(ctx: Ctx): Promise<void> {
  const raw = await readRawBody(ctx);
  const type = String(ctx.req.headers['content-type'] ?? '');
  let json: unknown;
  let jsonError: string | null = null;
  if (type.includes('json') && raw.length > 0) {
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch (error) {
      jsonError = error instanceof Error ? error.message : 'invalid JSON';
    }
  }
  sendJson(
    ctx,
    200,
    {
      method: ctx.req.method,
      http_version: ctx.req.httpVersion,
      scheme: isTls(ctx) ? 'https' : 'http',
      path: ctx.url.pathname,
      url: ctx.url.toString(),
      query: queryObject(ctx),
      headers: rawHeaderPairs(ctx),
      cookies: parseCookies(ctx.req.headers.cookie),
      client: { ip: ctx.req.socket.remoteAddress ?? null, port: ctx.req.socket.remotePort ?? null },
      body: {
        size: raw.length,
        content_type: type || null,
        text: raw.toString('utf8'),
        base64: raw.toString('base64'),
        sha256: createHash('sha256').update(raw).digest('hex'),
        ...(type.includes('json') ? { json, json_error: jsonError } : {}),
      },
    },
    { 'Cache-Control': 'no-store', 'X-Echo-Method': ctx.req.method ?? '' },
  );
}

function parseBasic(header: string | undefined): { user: string; pass: string } | null {
  if (!header) return null;
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

function basicChallenge(ctx: Ctx, message: string): void {
  sendJson(
    ctx,
    401,
    { error: { code: 'UNAUTHORIZED', message, status: 401 } },
    {
      'WWW-Authenticate': 'Basic realm="backend-lab", charset="UTF-8"',
      'Cache-Control': 'no-store',
    },
  );
}

function bearerChallenge(ctx: Ctx, message: string, errorCode?: string): void {
  sendJson(
    ctx,
    401,
    { error: { code: errorCode ?? 'UNAUTHORIZED', message, status: 401 } },
    {
      'WWW-Authenticate': `Bearer realm="backend-lab"${errorCode ? `, error="${errorCode}"` : ''}`,
      'Cache-Control': 'no-store',
    },
  );
}

function cookieAttributes(ctx: Ctx): string {
  const parts = [`Path=${ctx.query.get('path') ?? '/'}`];
  const maxAge = ctx.query.get('max-age');
  if (maxAge !== null) parts.push(`Max-Age=${integerParam(ctx, 'max-age', 0, -1, 31_536_000)}`);
  const expires = ctx.query.get('expires');
  if (expires) parts.push(`Expires=${new Date(expires).toUTCString()}`);
  if (['1', 'true'].includes(ctx.query.get('httpOnly') ?? '')) parts.push('HttpOnly');
  if (['1', 'true'].includes(ctx.query.get('secure') ?? '')) parts.push('Secure');
  const sameSite = ctx.query.get('sameSite');
  if (sameSite) {
    if (!['Strict', 'Lax', 'None'].includes(sameSite))
      throw validationError([{ field: 'sameSite', message: 'Strict, Lax o None' }]);
    parts.push(`SameSite=${sameSite}`);
  }
  return parts.join('; ');
}

function parseRange(header: string | undefined, total: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  let start: number;
  let end: number;
  if (match[1] === '' && match[2] !== '') {
    const suffix = Number(match[2]);
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? total - 1 : Number(match[2]);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= total || end < start) return null;
  return { start, end: Math.min(end, total - 1) };
}

async function streamText(ctx: Ctx, binary: boolean): Promise<void> {
  const chunks = integerParam(ctx, 'chunks', 5, 1, 1000);
  const delay = integerParam(ctx, 'delay', 100, 0, configOf(ctx).maxDelayMs);
  const size = integerParam(ctx, 'size', 32, 1, 65_536);
  const max = configOf(ctx).maxResponseBytes;
  if (chunks * size > max)
    throw validationError([{ field: 'size', message: 'la respuesta supera el máximo configurado' }]);
  ctx.res.statusCode = 200;
  ctx.res.setHeader('Content-Type', binary ? 'application/octet-stream' : 'text/plain; charset=utf-8');
  ctx.res.setHeader('X-Chunks', String(chunks));
  if (delay > 0) ctx.res.setHeader('X-Chunk-Delay-Ms', String(delay));
  if (ctx.isHead) {
    ctx.res.end();
    return;
  }
  let closed = false;
  ctx.res.on('close', () => {
    closed = true;
  });
  for (let i = 1; i <= chunks && !closed; i++) {
    const payload = binary
      ? Buffer.alloc(size, i % 256)
      : Buffer.from(`chunk ${i}/${chunks} ${'x'.repeat(Math.max(0, size - 16))}\n`);
    if (!ctx.res.write(payload)) await new Promise<void>((resolve) => ctx.res.once('drain', resolve));
    if (delay > 0) await sleep(delay);
  }
  if (!ctx.res.writableEnded) ctx.res.end();
}

function rawResponse(ctx: Ctx, raw: string): void {
  const socket = ctx.res.socket;
  if (!socket) {
    ctx.res.statusCode = 500;
    ctx.res.end();
    return;
  }
  socket.write(raw);
  socket.destroy();
}

async function delayedResponse(ctx: Ctx): Promise<void> {
  const ms = integerParam(ctx, 'ms', 1000, 0, configOf(ctx).maxDelayMs);
  await sleep(ms);
  if (!ctx.res.writableEnded && !ctx.res.destroyed) {
    sendJson(ctx, 200, { delayed_ms: ms, completed_at: now() });
  }
}

/**
 * Dispatches a `/test` request. The function owns the response (including raw
 * socket paths) and rethrows typed HTTP errors to the central renderer.
 */
export async function handleLab(ctx: Ctx): Promise<void> {
  const config = configOf(ctx);
  const path = ctx.url.pathname.replace(/\/+$/, '') || '/test';
  const method = (ctx.req.method ?? 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    ctx.res.statusCode = 204;
    ctx.res.setHeader('Allow', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
    ctx.res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
    ctx.res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Api-Key, X-Custom, Idempotency-Key, Range, If-None-Match, If-Modified-Since',
    );
    ctx.res.setHeader('Access-Control-Max-Age', '600');
    ctx.res.end();
    return;
  }

  try {
    if (path === '/test' || path === '/test/echo') return await echo(ctx);

    if (path === '/test/methods') {
      sendJson(ctx, 200, {
        received_method: method,
        supported: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
        note: 'Cualquier método, incluidos métodos personalizados, es aceptado en /test/echo.',
      });
      return;
    }
    if (path.startsWith('/test/methods/')) {
      const expected = path.slice('/test/methods/'.length).toUpperCase();
      sendJson(ctx, 200, { expected, received: method, match: expected === method });
      return;
    }

    if (path === '/test/status' || path.startsWith('/test/status/')) {
      const raw = path.startsWith('/test/status/') ? path.slice('/test/status/'.length) : ctx.query.get('code');
      const code = Number(raw ?? 200);
      if (!Number.isInteger(code) || code < 200 || code > 599)
        throw validationError([{ field: 'code', message: 'código entre 200 y 599' }]);
      sendJson(
        ctx,
        code,
        { simulated_status: code, body_present: ![204, 304].includes(code) },
        {
          'X-Simulated-Status': String(code),
          ...(code === 429 ? { 'Retry-After': '2' } : {}),
          ...(code === 401 ? { 'WWW-Authenticate': 'Bearer realm="lab"' } : {}),
        },
      );
      return;
    }

    if (path === '/test/headers/echo') {
      sendJson(ctx, 200, { headers: rawHeaderPairs(ctx), cookies: parseCookies(ctx.req.headers.cookie) });
      return;
    }
    if (path === '/test/headers/required') {
      const names = (ctx.query.get('names') ?? 'x-required')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const missing = names.filter((name) => ctx.req.headers[name.toLowerCase()] === undefined);
      if (missing.length) {
        sendJson(ctx, 400, {
          error: { code: 'MISSING_HEADERS', message: 'Faltan headers obligatorios', missing, status: 400 },
        });
        return;
      }
      sendJson(ctx, 200, { present: names });
      return;
    }
    if (path === '/test/headers/large') {
      const size = integerParam(ctx, 'size', 4096, 1, 16_384);
      sendJson(
        ctx,
        200,
        { header_size: size, value_sha256: createHash('sha256').update('x'.repeat(size)).digest('hex') },
        {
          'X-Large': 'x'.repeat(size),
        },
      );
      return;
    }
    if (path === '/test/headers/repeated') {
      ctx.res.setHeader('Set-Cookie', ['repeat=one; Path=/', 'repeat=two; Path=/']);
      sendJson(
        ctx,
        200,
        { repeated: true },
        {
          'X-Duplicate': ['first', 'second'],
          'X-Repeat-A': 'one',
          'X-Repeat-B': 'two',
        },
      );
      return;
    }
    if (path === '/test/headers/custom') {
      const name = ctx.query.get('name') ?? 'X-Custom-Response';
      const value = ctx.query.get('value') ?? 'custom-value';
      if (!/^[A-Za-z0-9-]+$/.test(name) || /[\r\n]/.test(value))
        throw validationError([{ field: 'name', message: 'nombre o valor de header inválido' }]);
      ctx.res.setHeader(name, value);
      sendJson(ctx, 200, { header: name, value, request_custom: ctx.req.headers[name.toLowerCase()] ?? null });
      return;
    }
    if (path === '/test/headers/cache') {
      sendJson(
        ctx,
        200,
        { cached: true },
        {
          'Cache-Control': `public, max-age=${integerParam(ctx, 'max_age', 60, 0, 86_400)}`,
          ETag: '"header-cache-v1"',
          Vary: 'Accept-Encoding',
          Expires: new Date(Date.now() + 60_000).toUTCString(),
        },
      );
      return;
    }

    if (path === '/test/body/echo' || path === '/test/upload') return await echo(ctx);
    if (path === '/test/body/empty') {
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Length', '0');
      ctx.res.end();
      return;
    }
    if (path === '/test/body/invalid-json') {
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Type', 'application/json');
      ctx.res.setHeader('Content-Length', '10');
      ctx.res.end('{"broken":');
      return;
    }
    if (path === '/test/body/wrong-content-type') {
      sendText(
        ctx,
        200,
        JSON.stringify({ message: 'Soy JSON pero el Content-Type es texto plano' }),
        'text/plain; charset=utf-8',
      );
      return;
    }
    if (path === '/test/body/large') {
      const size = integerParam(ctx, 'size', 1024 * 1024, 1, config.maxResponseBytes);
      const body = Buffer.alloc(size, 0x61);
      sendBuffer(ctx, 200, body, 'application/octet-stream', { 'X-Generated-Bytes': String(size) });
      return;
    }

    if (path.startsWith('/test/response/')) {
      const kind = path.slice('/test/response/'.length);
      if (kind === 'json') {
        sendJson(ctx, 200, { kind: 'json', unicode: 'áéíóú ñ 日本語 العربية', items: [1, 2, 3] });
        return;
      }
      if (kind === 'text') {
        sendText(ctx, 200, 'Respuesta de texto plano con Unicode: ñ, ü, 漢字.');
        return;
      }
      if (kind === 'html') {
        sendText(
          ctx,
          200,
          '<!doctype html><html lang="es"><body><h1>HTML simulado</h1><p>Prueba de respuesta HTML.</p></body></html>',
          'text/html; charset=utf-8',
        );
        return;
      }
      if (kind === 'xml') {
        sendText(
          ctx,
          200,
          '<?xml version="1.0" encoding="UTF-8"?><root><item id="1">texto</item></root>',
          'application/xml; charset=utf-8',
        );
        return;
      }
      if (kind === 'csv') {
        sendText(ctx, 200, 'id,nombre,precio\n1,"Producto, especial",19.99\n2,Otro,5.00\n', 'text/csv; charset=utf-8');
        return;
      }
      if (kind === 'empty') {
        ctx.res.statusCode = 200;
        ctx.res.setHeader('Content-Length', '0');
        ctx.res.end();
        return;
      }
      if (kind === 'no-content') {
        ctx.res.statusCode = 204;
        ctx.res.end();
        return;
      }
      if (kind === 'binary' || kind === 'large') {
        const size = integerParam(ctx, 'size', kind === 'large' ? 1024 * 1024 : 256, 1, config.maxResponseBytes);
        const body = Buffer.alloc(size, 0x42);
        sendBuffer(ctx, 200, body, 'application/octet-stream', { 'X-Generated-Bytes': String(size) });
        return;
      }
      throw notFound('Tipo de respuesta desconocido');
    }

    if (path === '/test/compress') {
      const requested = ctx.query.get('algo') ?? 'auto';
      const accept = ctx.req.headers['accept-encoding'] ?? '';
      let encoding: 'gzip' | 'deflate' | 'br' | 'identity' = 'identity';
      if (requested === 'auto') {
        if (/\bbr\b/.test(accept)) encoding = 'br';
        else if (/\bgzip\b/.test(accept)) encoding = 'gzip';
        else if (/\bdeflate\b/.test(accept)) encoding = 'deflate';
      } else if (['gzip', 'deflate', 'br', 'identity'].includes(requested)) {
        encoding = requested as 'gzip' | 'deflate' | 'br' | 'identity';
      } else {
        throw validationError([{ field: 'algo', message: 'use gzip, deflate, br, identity o auto' }]);
      }
      const max = config.maxResponseBytes;
      const size = integerParam(ctx, 'size', 0, 0, max);
      const original =
        size > 0
          ? Buffer.alloc(size, 0x7a)
          : Buffer.from(ctx.query.get('body') ?? 'Contenido comprimible repetido. '.repeat(32), 'utf8');
      if (original.length > max) throw validationError([{ field: 'size', message: 'respuesta demasiado grande' }]);
      let body = original;
      if (encoding === 'gzip') body = gzipSync(original);
      else if (encoding === 'deflate') body = deflateSync(original);
      else if (encoding === 'br') body = brotliCompressSync(original);
      sendBuffer(ctx, 200, body, 'text/plain; charset=utf-8', {
        ...(encoding === 'identity' ? {} : { 'Content-Encoding': encoding }),
        Vary: 'Accept-Encoding',
        'X-Uncompressed-Bytes': String(original.length),
        'X-Compression': encoding,
      });
      return;
    }

    if (path === '/test/redirect' || path.startsWith('/test/redirect/')) {
      const tail = path.startsWith('/test/redirect/') ? path.slice('/test/redirect/'.length) : '';
      if (tail === 'loop') {
        ctx.res.writeHead(302, { Location: '/test/redirect/loop', 'Cache-Control': 'no-store' });
        ctx.res.end();
        return;
      }
      if (tail === 'missing') {
        ctx.res.writeHead(302, { Location: '/test/this-target-does-not-exist', 'Cache-Control': 'no-store' });
        ctx.res.end();
        return;
      }
      if (tail.startsWith('chain/')) {
        const n = Number(tail.slice('chain/'.length));
        if (!Number.isInteger(n) || n < 0 || n > 20)
          throw validationError([{ field: 'n', message: 'entero entre 0 y 20' }]);
        if (n === 0) {
          sendJson(ctx, 200, { chain_complete: true });
          return;
        }
        ctx.res.writeHead(302, { Location: `/test/redirect/chain/${n - 1}`, 'Cache-Control': 'no-store' });
        ctx.res.end();
        return;
      }
      let code = 302;
      if (tail) {
        code = Number(tail);
        if (![301, 302, 303, 307, 308].includes(code))
          throw validationError([{ field: 'code', message: 'use 301, 302, 303, 307 o 308' }]);
      } else {
        const qCode = Number(ctx.query.get('code') ?? 302);
        if (![301, 302, 303, 307, 308].includes(qCode))
          throw validationError([{ field: 'code', message: 'use 301, 302, 303, 307 o 308' }]);
        code = qCode;
      }
      const to = ctx.query.get('to') ?? '/test/echo';
      if (!to.startsWith('/') || to.startsWith('//'))
        throw badRequest('El destino debe ser una ruta local que empiece por /');
      const host = ctx.req.headers.host ?? `localhost:${config.port}`;
      const absolute = ['1', 'true'].includes(ctx.query.get('absolute') ?? '');
      const scheme = isTls(ctx) ? 'https' : 'http';
      const location = absolute ? `${scheme}://${host}${to}` : to;
      ctx.res.writeHead(code, {
        Location: location,
        'Cache-Control': 'no-store',
        'X-Redirect-Source': '/test/redirect',
      });
      ctx.res.end();
      return;
    }

    if (path === '/test/auth/basic') {
      const given = parseBasic(ctx.req.headers.authorization);
      if (!given) return basicChallenge(ctx, 'Credenciales Basic ausentes');
      if (!safeEqual(given.user, config.basicUser) || !safeEqual(given.pass, config.basicPassword)) {
        return basicChallenge(ctx, 'Credenciales Basic incorrectas');
      }
      sendJson(ctx, 200, { authenticated: true, scheme: 'Basic', user: given.user });
      return;
    }
    if (path === '/test/auth/bearer') {
      const header = ctx.req.headers.authorization;
      const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
      if (!match) return bearerChallenge(ctx, 'Bearer token ausente');
      if (!safeEqual(match[1].trim(), config.adminToken)) return bearerChallenge(ctx, 'Token inválido');
      sendJson(ctx, 200, { authenticated: true, scheme: 'Bearer' });
      return;
    }
    if (path === '/test/auth/api-key') {
      const key = ctx.req.headers['x-api-key'];
      if (typeof key !== 'string' || key.length === 0) {
        sendJson(ctx, 401, { error: { code: 'UNAUTHORIZED', message: 'Falta X-API-Key', status: 401 } });
        return;
      }
      if (!safeEqual(key, config.testApiKey)) {
        sendJson(ctx, 401, { error: { code: 'UNAUTHORIZED', message: 'API key inválida', status: 401 } });
        return;
      }
      sendJson(ctx, 200, { authenticated: true, scheme: 'ApiKey' });
      return;
    }
    if (path === '/test/auth/expired') {
      return bearerChallenge(ctx, 'El token presentado está expirado', 'invalid_token');
    }
    if (path === '/test/auth/scheme') {
      const header = ctx.req.headers.authorization;
      if (!header) return bearerChallenge(ctx, 'Falta Authorization');
      if (!/^Bearer\s+/i.test(header))
        return bearerChallenge(ctx, 'Esquema no soportado; use Bearer', 'invalid_request');
      sendJson(ctx, 200, { received: header.replace(/\s.+$/, ''), note: 'Esquema Bearer aceptado' });
      return;
    }

    if (path === '/test/cookies/set') {
      const name = ctx.query.get('name') ?? 'session';
      const value = ctx.query.get('value') ?? 'abc123';
      if (!/^[A-Za-z0-9_-]+$/.test(name))
        throw validationError([{ field: 'name', message: 'nombre de cookie inválido' }]);
      ctx.res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; ${cookieAttributes(ctx)}`);
      sendJson(ctx, 200, { cookie_set: name, value });
      return;
    }
    if (path === '/test/cookies/set-many') {
      const count = integerParam(ctx, 'count', 3, 1, 10);
      const cookies = Array.from(
        { length: count },
        (_, i) => `sim_cookie_${i + 1}=value_${i + 1}; Path=/; Max-Age=3600`,
      );
      ctx.res.setHeader('Set-Cookie', cookies);
      sendJson(ctx, 200, { cookies_set: count, cookies });
      return;
    }
    if (path === '/test/cookies/echo') {
      sendJson(ctx, 200, { cookies: parseCookies(ctx.req.headers.cookie), raw: ctx.req.headers.cookie ?? null });
      return;
    }
    if (path === '/test/cookies/delete') {
      const name = ctx.query.get('name') ?? 'session';
      ctx.res.setHeader('Set-Cookie', `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
      sendJson(ctx, 200, { deleted: name });
      return;
    }

    if (path === '/test/cache/etag') {
      const version = ctx.query.get('version') ?? '1';
      const etag = `"sim-etag-v${version}"`;
      if (ctx.req.headers['if-none-match'] === etag || ctx.req.headers['if-none-match'] === '*') {
        ctx.res.statusCode = 304;
        ctx.res.setHeader('ETag', etag);
        ctx.res.setHeader('Cache-Control', 'public, max-age=60');
        ctx.res.end();
        return;
      }
      sendJson(
        ctx,
        200,
        { etag: version, value: 'contenido cacheable' },
        { ETag: etag, 'Cache-Control': 'public, max-age=60' },
      );
      return;
    }
    if (path === '/test/cache/last-modified') {
      const days = integerParam(ctx, 'days_ago', 1, 0, 3650);
      const timestamp = new Date(Date.now() - days * 86_400_000);
      timestamp.setUTCMilliseconds(0);
      const lastModified = timestamp.toUTCString();
      const ims = ctx.req.headers['if-modified-since'];
      if (ims && !Number.isNaN(Date.parse(ims)) && Date.parse(ims) >= timestamp.getTime()) {
        ctx.res.statusCode = 304;
        ctx.res.setHeader('Last-Modified', lastModified);
        ctx.res.end();
        return;
      }
      sendJson(
        ctx,
        200,
        { last_modified: lastModified },
        { 'Last-Modified': lastModified, 'Cache-Control': 'public, max-age=3600' },
      );
      return;
    }
    if (path === '/test/cache/control') {
      const maxAge = integerParam(ctx, 'max_age', 60, 0, 86_400);
      const noStore = ['1', 'true'].includes(ctx.query.get('no_store') ?? '');
      sendJson(
        ctx,
        200,
        { cached: !noStore },
        {
          'Cache-Control': noStore ? 'no-store' : `public, max-age=${maxAge}`,
          ...(noStore ? { Pragma: 'no-cache' } : {}),
        },
      );
      return;
    }

    if (path === '/test/stream/text' || path === '/test/stream/progressive') return await streamText(ctx, false);
    if (path === '/test/stream/binary') return await streamText(ctx, true);
    if (path === '/test/stream/sse') {
      const count = integerParam(ctx, 'count', 5, 1, 100);
      const delay = integerParam(ctx, 'delay', 200, 0, config.maxDelayMs);
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      ctx.res.setHeader('Cache-Control', 'no-cache');
      if (ctx.isHead) {
        ctx.res.end();
        return;
      }
      ctx.res.flushHeaders();
      let closed = false;
      ctx.res.on('close', () => {
        closed = true;
      });
      for (let i = 1; i <= count && !closed; i++) {
        ctx.res.write(`event: tick\ndata: ${JSON.stringify({ event: i, total: count, at: now() })}\n\n`);
        if (delay > 0) await sleep(delay);
      }
      if (!closed) ctx.res.write(`event: done\ndata: ${JSON.stringify({ total: count })}\n\n`);
      if (!ctx.res.writableEnded) ctx.res.end();
      return;
    }
    if (path === '/test/stream/trailers') {
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      ctx.res.setHeader('Trailer', 'X-Trailer-Checksum');
      if (ctx.isHead) {
        ctx.res.end();
        return;
      }
      ctx.res.write('primera parte\n');
      ctx.res.write('segunda parte\n');
      const digest = createHash('sha256').update('primera parteseegunda parte\n').digest('hex');
      ctx.res.addTrailers({ 'X-Trailer-Checksum': digest });
      ctx.res.end('fin\n');
      return;
    }
    if (path === '/test/stream/interrupted') {
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      ctx.res.setHeader('Content-Length', '1000');
      ctx.res.setHeader('Connection', 'close');
      ctx.res.write('Esta respuesta se interrumpirá...');
      await sleep(integerParam(ctx, 'delay', 50, 0, 5000));
      ctx.res.destroy();
      return;
    }
    if (path === '/test/stream/incomplete') {
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      ctx.res.setHeader('Content-Length', '1000');
      ctx.res.setHeader('Connection', 'close');
      ctx.res.write('solo una parte del cuerpo prometido');
      ctx.res.end();
      return;
    }
    if (path === '/test/download' || path === '/test/range') {
      const total = integerParam(ctx, 'size', 65_536, 1, config.maxResponseBytes);
      const etag = `"download-${total}"`;
      if (ctx.req.headers['if-none-match'] === etag) {
        ctx.res.statusCode = 304;
        ctx.res.setHeader('ETag', etag);
        ctx.res.end();
        return;
      }
      const body = Buffer.alloc(total);
      for (let i = 0; i < total; i++) body[i] = 97 + (i % 26);
      const rangeHeader = ctx.req.headers.range;
      const range = parseRange(rangeHeader, total);
      if (rangeHeader && !range) {
        sendJson(
          ctx,
          416,
          { error: { code: 'RANGE_NOT_SATISFIABLE', message: 'Rango no satisfacible', total } },
          {
            'Content-Range': `bytes */${total}`,
            'Accept-Ranges': 'bytes',
          },
        );
        return;
      }
      if (range) {
        const slice = body.subarray(range.start, range.end + 1);
        sendBuffer(ctx, 206, slice, 'application/octet-stream', {
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
          ETag: etag,
        });
      } else {
        sendBuffer(ctx, 200, body, 'application/octet-stream', {
          'Accept-Ranges': 'bytes',
          'Content-Disposition': 'attachment; filename="simulation.bin"',
          ETag: etag,
        });
      }
      return;
    }

    if (path === '/test/delay' || path.startsWith('/test/delay/')) {
      if (path !== '/test/delay') {
        const ms = Number(path.slice('/test/delay/'.length));
        if (!Number.isInteger(ms) || ms < 0 || ms > config.maxDelayMs)
          throw validationError([{ field: 'ms', message: 'retraso fuera de rango' }]);
        await sleep(ms);
        sendJson(ctx, 200, { delayed_ms: ms });
        return;
      }
      return await delayedResponse(ctx);
    }
    if (path === '/test/timeout') {
      const ms = integerParam(ctx, 'ms', 30_000, 1, Math.max(120_000, config.maxDelayMs));
      const respondWith = ctx.query.get('respond') === '200' ? 200 : 504;
      const outcome = await new Promise<'timeout' | 'closed'>((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), ms);
        ctx.res.once('close', () => {
          clearTimeout(timer);
          resolve('closed');
        });
      });
      if (outcome === 'timeout' && !ctx.res.writableEnded && !ctx.res.destroyed) {
        sendJson(ctx, respondWith, { simulated: 'timeout', waited_ms: ms });
      }
      return;
    }
    if (path === '/test/never') {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 120_000);
        ctx.res.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (!ctx.res.writableEnded && !ctx.res.destroyed) {
        ctx.res.statusCode = 504;
        ctx.res.end();
      }
      return;
    }
    if (path === '/test/close') {
      ctx.res.destroy();
      return;
    }
    if (path === '/test/error' || path.startsWith('/test/error/')) {
      let code = path === '/test/error' ? 500 : Number(path.slice('/test/error/'.length));
      if (path.endsWith('/rate-limited')) code = 429;
      if (!Number.isInteger(code) || code < 400 || code > 599)
        throw validationError([{ field: 'code', message: 'código entre 400 y 599' }]);
      sendJson(
        ctx,
        code,
        {
          error: {
            code: code === 429 ? 'TOO_MANY_REQUESTS' : code === 503 ? 'SERVICE_UNAVAILABLE' : 'SIMULATED_ERROR',
            message: `Error HTTP ${code} simulado`,
            status: code,
            request_id: ctx.requestId,
          },
        },
        {
          'Cache-Control': 'no-store',
          ...(code === 429 ? { 'Retry-After': '2' } : {}),
          ...(code === 503 ? { 'Retry-After': '5' } : {}),
          ...(code === 401 ? { 'WWW-Authenticate': 'Bearer realm="lab"' } : {}),
        },
      );
      return;
    }
    if (path === '/test/rate-limit') {
      const limit = integerParam(ctx, 'limit', 3, 1, 10_000);
      const windowMs = integerParam(ctx, 'window_ms', 10_000, 100, 600_000);
      const key = ctx.query.get('key') ?? ctx.req.socket.remoteAddress ?? 'anonymous';
      const nowMs = Date.now();
      let bucket = rateState.get(key);
      if (!bucket || bucket.resetAt <= nowMs) {
        bucket = { count: 0, resetAt: nowMs + windowMs };
        rateState.set(key, bucket);
      }
      bucket.count += 1;
      const remaining = Math.max(0, limit - bucket.count);
      const headers = {
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(Math.ceil(bucket.resetAt / 1000)),
        'Cache-Control': 'no-store',
      };
      if (bucket.count > limit) {
        sendJson(
          ctx,
          429,
          {
            error: {
              code: 'TOO_MANY_REQUESTS',
              message: 'Rate limit excedido',
              retry_after_seconds: Math.ceil((bucket.resetAt - nowMs) / 1000),
            },
          },
          {
            ...headers,
            'Retry-After': String(Math.ceil((bucket.resetAt - nowMs) / 1000)),
          },
        );
        return;
      }
      sendJson(ctx, 200, { allowed: true, count: bucket.count, limit, remaining, window_ms: windowMs }, headers);
      return;
    }

    if (path === '/test/counter') {
      counterState.value += 1;
      sendJson(ctx, 200, { counter: counterState.value, request_id: ctx.requestId, at: now() });
      return;
    }
    if (path === '/test/concurrency') {
      const delay = integerParam(ctx, 'delay', 0, 0, config.maxDelayMs);
      const id = ctx.query.get('id') ?? ctx.requestId;
      const startedAt = now();
      await sleep(delay);
      sendJson(ctx, 200, { id, delay_ms: delay, started_at: startedAt, finished_at: now() });
      return;
    }
    if (path === '/test/idempotency') {
      const key = ctx.req.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length === 0 || key.length > 200) {
        throw validationError([{ field: 'Idempotency-Key', message: 'header obligatorio (máx. 200 caracteres)' }]);
      }
      const existing = idempotencyState.get(key);
      if (existing) {
        sendJson(ctx, 200, existing.body, {
          'Idempotent-Replay': 'true',
          'Idempotency-Key': key,
          'Cache-Control': 'no-store',
        });
        return;
      }
      const body = { id: ctx.requestId, key, created_at: now(), operation: 'simulated-write' };
      idempotencyState.set(key, { status: 201, body, createdAt: now() });
      if (idempotencyState.size > 500) {
        const oldest = [...idempotencyState.entries()].sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt))[0];
        if (oldest) idempotencyState.delete(oldest[0]);
      }
      sendJson(ctx, 201, body, { 'Idempotency-Key': key, 'Cache-Control': 'no-store' });
      return;
    }

    if (path === '/test/raw/malformed') {
      rawResponse(ctx, 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nBroken-Header\r\n\r\nrespuesta malformada');
      return;
    }
    if (path === '/test/raw/invalid-status-line') {
      rawResponse(ctx, 'NOT-HTTP GARBAGE\r\n\r\n');
      return;
    }
    if (path === '/test/raw/header-injection') {
      rawResponse(ctx, 'HTTP/1.1 200 OK\r\nX-Evil: a\r\nInjected-Header\r\nContent-Length: 2\r\n\r\nok');
      return;
    }

    throw notFound('Endpoint de laboratorio no encontrado');
  } catch (error) {
    if (!ctx.res.headersSent) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      sendJson(ctx, 500, {
        error: { code: 'LAB_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    } else if (!ctx.res.writableEnded) {
      ctx.res.end();
    }
  }
}
