import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Ctx } from './router.js';
import { sendBuffer } from './index.js';
import { HttpError, notFound } from '../core/errors.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' http: https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export async function serveStatic(ctx: Ctx, prefix: string, rootDir: string): Promise<void> {
  const method = (ctx.req.method ?? 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    ctx.res.statusCode = 204;
    ctx.res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    ctx.res.end();
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Método no permitido para archivos estáticos', {
      headers: { Allow: 'GET, HEAD, OPTIONS' },
    });
  }

  if (ctx.url.pathname === prefix) {
    ctx.res.writeHead(308, { Location: `${prefix}/`, 'Cache-Control': 'no-store' });
    ctx.res.end();
    return;
  }

  let relative: string;
  try {
    relative = decodeURIComponent(ctx.url.pathname.slice(prefix.length + 1));
  } catch {
    throw notFound('Recurso no encontrado');
  }
  if (relative.includes('\0')) throw notFound('Recurso no encontrado');

  let root: string;
  try {
    root = await realpath(resolve(rootDir));
  } catch {
    throw notFound('Interfaz web no disponible');
  }

  const requested = resolve(root, relative === '' ? 'index.html' : relative);
  if (requested !== root && !requested.startsWith(root + sep)) {
    throw notFound('Recurso no encontrado');
  }

  try {
    const info = await stat(requested);
    const target = info.isDirectory() ? resolve(requested, 'index.html') : requested;
    const realTarget = await realpath(target);
    if (!realTarget.startsWith(root + sep)) throw notFound('Recurso no encontrado');
    const body = await readFile(realTarget);
    const extension = extname(realTarget).toLowerCase();
    sendBuffer(ctx, 200, body, MIME[extension] ?? 'application/octet-stream', {
      'Cache-Control': 'no-cache',
      ...(extension === '.html' ? { 'Content-Security-Policy': CSP } : {}),
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw notFound('Recurso no encontrado');
  }
}
