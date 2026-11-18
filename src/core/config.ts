import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Config {
  host: string;
  port: number;
  httpsEnabled: boolean;
  httpsPort: number;
  http2Enabled: boolean;
  http2Port: number;
  proxyEnabled: boolean;
  proxyPort: number;
  uiEnabled: boolean;
  uiDir: string;
  dbPath: string;
  seedScale: number;
  maxBodyBytes: number;
  maxResponseBytes: number;
  maxPageSize: number;
  maxDelayMs: number;
  requestTimeoutMs: number;
  adminEmail: string;
  adminPassword: string;
  seedPassword: string;
  adminToken: string;
  viewerToken: string;
  testApiKey: string;
  controlToken: string;
  basicUser: string;
  basicPassword: string;
  tlsCertPath: string;
  tlsKeyPath: string;
  tlsAutoGenerate: boolean;
  logLevel: LogLevel;
}

function loadDotEnv(): void {
  const file = resolve(process.cwd(), '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function int(name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Config inválida: ${name}=${raw}`);
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(raw.toLowerCase())) return false;
  throw new Error(`Config inválida: ${name}=${raw}`);
}

function str(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  loadDotEnv();
  const base = process.cwd();
  const cfg: Config = {
    host: str('HOST', '127.0.0.1'),
    port: int('PORT', 4000, 0, 65535),
    httpsEnabled: bool('HTTPS_ENABLED', true),
    httpsPort: int('HTTPS_PORT', 4443, 0, 65535),
    http2Enabled: bool('HTTP2_ENABLED', true),
    http2Port: int('HTTP2_PORT', 4444, 0, 65535),
    proxyEnabled: bool('PROXY_ENABLED', false),
    proxyPort: int('PROXY_PORT', 8080, 0, 65535),
    uiEnabled: bool('UI_ENABLED', true),
    uiDir: resolve(base, str('UI_DIR', './web')),
    dbPath: resolve(base, str('DB_PATH', './data/backend-simulator.sqlite')),
    seedScale: Number(str('SEED_SCALE', '1')),
    maxBodyBytes: int('MAX_BODY_BYTES', 10 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
    maxResponseBytes: int('MAX_RESPONSE_BYTES', 20 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
    maxPageSize: int('MAX_PAGE_SIZE', 100, 1, 1000),
    maxDelayMs: int('MAX_DELAY_MS', 60_000, 0, 600_000),
    requestTimeoutMs: int('REQUEST_TIMEOUT_MS', 30_000, 1000, 600_000),
    adminEmail: str('ADMIN_EMAIL', 'admin@simulator.local'),
    adminPassword: str('ADMIN_PASSWORD', 'Admin123!'),
    seedPassword: str('SEED_PASSWORD', 'Password123!'),
    adminToken: str('ADMIN_TOKEN', 'local-admin-token'),
    viewerToken: str('VIEWER_TOKEN', 'local-viewer-token'),
    testApiKey: str('TEST_API_KEY', 'local-test-api-key'),
    controlToken: str('CONTROL_TOKEN', 'local-control-token'),
    basicUser: str('BASIC_USER', 'testuser'),
    basicPassword: str('BASIC_PASSWORD', 'testpass'),
    tlsCertPath: resolve(base, str('TLS_CERT_PATH', './certs/localhost-cert.pem')),
    tlsKeyPath: resolve(base, str('TLS_KEY_PATH', './certs/localhost-key.pem')),
    tlsAutoGenerate: bool('TLS_AUTO_GENERATE', true),
    logLevel: str('LOG_LEVEL', 'info') as LogLevel,
  };
  if (!Number.isFinite(cfg.seedScale) || cfg.seedScale <= 0 || cfg.seedScale > 10) {
    throw new Error(`Config inválida: SEED_SCALE=${cfg.seedScale} (rango 0.1..10)`);
  }
  return { ...cfg, ...overrides };
}
