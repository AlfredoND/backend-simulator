import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Config } from '../core/config.js';
import type { Db } from '../db/index.js';
import type { Logger } from '../core/logger.js';
import { HttpError, badRequest, payloadTooLarge, unauthorized, unsupportedMedia } from '../core/errors.js';
import type { Ctx } from './router.js';

export interface App {
  config: Config;
  db: Db;
  log: Logger;
}

export interface RequestContext extends Ctx {
  app: App;
  bodyCache?: Buffer;
}

const NO_BODY_STATUS = new Set([204, 304]);

export function setRequestIdHeader(ctx: Ctx, requestId: string): void {
  ctx.res.setHeader('X-Request-Id', requestId);
}

export async function readRawBody(ctx: Ctx, limit?: number): Promise<Buffer> {
  const max = limit ?? (ctx as RequestContext).app.config.maxBodyBytes;
  const declared = Number(ctx.req.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > max) {
    ctx.req.resume();
    throw payloadTooLarge(`El cuerpo supera el límite de ${max} bytes`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of ctx.req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > max) {
      ctx.req.resume();
      throw payloadTooLarge(`El cuerpo supera el límite de ${max} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function contentTypeOf(ctx: Ctx): string {
  return String(ctx.req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
}

export async function readJsonBody<T = unknown>(ctx: Ctx): Promise<T> {
  const type = contentTypeOf(ctx);
  if (!type) throw unsupportedMedia('Falta el header Content-Type; se esperaba application/json');
  if (type !== 'application/json' && !type.endsWith('+json')) {
    throw unsupportedMedia(`Content-Type ${type} no soportado; se esperaba application/json`);
  }
  const raw = await readRawBody(ctx);
  if (raw.length === 0) throw badRequest('El cuerpo JSON está vacío');
  try {
    return JSON.parse(raw.toString('utf8')) as T;
  } catch (error) {
    throw badRequest('JSON inválido', { reason: error instanceof Error ? error.message : 'parse error' });
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

export type ResponseHeaders = Record<string, string | string[] | number>;

export function sendJson(ctx: Ctx, status: number, payload: unknown, headers: ResponseHeaders = {}): void {
  const body = JSON.stringify(payload);
  const buf = Buffer.from(body, 'utf8');
  for (const [key, value] of Object.entries(headers)) ctx.res.setHeader(key, value);
  ctx.res.statusCode = status;
  if (NO_BODY_STATUS.has(status)) {
    ctx.res.removeHeader('Content-Type');
    ctx.res.removeHeader('Content-Length');
    ctx.res.end();
    return;
  }
  ctx.res.setHeader('Content-Type', 'application/json; charset=utf-8');
  ctx.res.setHeader('Content-Length', String(buf.length));
  if (ctx.isHead) ctx.res.end();
  else ctx.res.end(buf);
}

export function sendText(ctx: Ctx, status: number, text: string, contentType = 'text/plain; charset=utf-8', headers: ResponseHeaders = {}): void {
  const buf = Buffer.from(text, 'utf8');
  for (const [key, value] of Object.entries(headers)) ctx.res.setHeader(key, value);
  ctx.res.statusCode = status;
  ctx.res.setHeader('Content-Type', contentType);
  ctx.res.setHeader('Content-Length', String(buf.length));
  if (ctx.isHead || NO_BODY_STATUS.has(status)) ctx.res.end();
  else ctx.res.end(buf);
}

export function sendBuffer(ctx: Ctx, status: number, body: Buffer, contentType: string, headers: ResponseHeaders = {}): void {
  for (const [key, value] of Object.entries(headers)) ctx.res.setHeader(key, value);
  ctx.res.statusCode = status;
  ctx.res.setHeader('Content-Type', contentType);
  ctx.res.setHeader('Content-Length', String(body.length));
  if (ctx.isHead || NO_BODY_STATUS.has(status)) ctx.res.end();
  else ctx.res.end(body);
}

export function sendError(ctx: Ctx, error: unknown): void {
  const app = (ctx as RequestContext).app;
  let httpError: HttpError;
  if (error instanceof HttpError) {
    httpError = error;
  } else {
    app.log.error('Error no controlado', {
      request_id: ctx.requestId,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
    httpError = new HttpError(500, 'INTERNAL_ERROR', 'Error interno del servidor');
  }
  if (httpError.headers) {
    for (const [key, value] of Object.entries(httpError.headers)) ctx.res.setHeader(key, value);
  }
  if (httpError.status === 401 && !ctx.res.hasHeader('WWW-Authenticate')) {
    ctx.res.setHeader('WWW-Authenticate', 'Bearer realm="backend-simulator"');
  }
  if (httpError.status === 429) ctx.res.setHeader('Cache-Control', 'no-store');
  const payload = {
    error: {
      code: httpError.code,
      message: httpError.message,
      ...(httpError.details !== undefined ? { details: httpError.details } : {}),
      request_id: ctx.requestId,
    },
  };
  sendJson(ctx, httpError.status, payload);
}

export function createContext(
  app: App,
  req: IncomingMessage,
  res: ServerResponse,
  isHead: boolean,
): RequestContext {
  const requestId = randomUUID();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  setRequestIdHeader({ req, res, url, params: {}, query: url.searchParams, requestId, isHead }, requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return {
    app,
    req,
    res,
    url,
    params: {},
    query: url.searchParams,
    requestId,
    isHead,
  };
}

export function requireAuthHeader(ctx: Ctx): string {
  const header = ctx.req.headers.authorization;
  if (!header) throw unauthorized('Falta el header Authorization');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw unauthorized('Esquema de autenticación no soportado; se esperaba Bearer');
  return match[1].trim();
}
