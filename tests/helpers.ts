import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type AppInstance } from '../src/app.js';
import type { Config } from '../src/core/config.js';

export const ADMIN_TOKEN = 'local-admin-token';
export const VIEWER_TOKEN = 'local-viewer-token';
export const CONTROL_TOKEN = 'local-control-token';
export const TEST_API_KEY = 'local-test-api-key';

export interface RequestOptions {
  body?: unknown;
  rawBody?: string | Buffer;
  token?: string;
  headers?: Record<string, string>;
  redirect?: 'follow' | 'manual' | 'error';
}

export interface TestServer {
  app: AppInstance;
  base: string;
  request(method: string, path: string, options?: RequestOptions): Promise<Response>;
  json(method: string, path: string, options?: RequestOptions): Promise<{ status: number; body: any; headers: Headers }>;
  close(): Promise<void>;
}

export async function startTestServer(overrides: Partial<Config> = {}): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), 'backend-sim-test-'));
  const app = createApp({
    dbPath: join(dir, 'test.sqlite'),
    port: 0,
    httpsEnabled: false,
    http2Enabled: false,
    proxyEnabled: false,
    logLevel: 'silent',
    ...overrides,
  });
  await app.start();
  const base = `http://127.0.0.1:${app.ports.http}`;
  const request = async (method: string, path: string, options: RequestOptions = {}): Promise<Response> => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    let body: string | Buffer | undefined;
    if (options.rawBody !== undefined) {
      body = options.rawBody;
      if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
    } else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    }
    return fetch(`${base}${path}`, { method, headers, body: body as never, redirect: options.redirect ?? 'manual' });
  };
  const json = async (method: string, path: string, options: RequestOptions = {}) => {
    const response = await request(method, path, options);
    const text = await response.text();
    let body: any;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body, headers: response.headers };
  };
  return {
    app,
    base,
    request,
    json,
    close: async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function pollIdle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
