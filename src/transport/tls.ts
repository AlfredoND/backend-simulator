/**
 * @file Local TLS material management.
 *
 * Existing certificate/key pairs are reused. Missing pairs can be generated
 * with OpenSSL for localhost SANs; failure disables TLS transport with a warning
 * instead of crashing the HTTP simulator. Certificates are never committed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Config } from '../core/config.js';
import type { Logger } from '../core/logger.js';

/** PEM material loaded by HTTP/2 and HTTPS servers. */
export interface TlsMaterial {
  cert: Buffer;
  key: Buffer;
}

/** Ensures a local certificate exists, returning null when TLS is unavailable. */
export function ensureCertificates(config: Config, log: Logger): TlsMaterial | null {
  if (!config.httpsEnabled && !config.http2Enabled) return null;
  if (existsSync(config.tlsCertPath) && existsSync(config.tlsKeyPath)) {
    return {
      cert: readFileSync(config.tlsCertPath),
      key: readFileSync(config.tlsKeyPath),
    };
  }
  if (!config.tlsAutoGenerate) {
    log.warn('Certificado TLS no encontrado y TLS_AUTO_GENERATE=false', {
      cert: config.tlsCertPath,
      key: config.tlsKeyPath,
    });
    return null;
  }
  try {
    mkdirSync(dirname(config.tlsCertPath), { recursive: true });
    mkdirSync(dirname(config.tlsKeyPath), { recursive: true });
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-sha256',
        '-keyout',
        config.tlsKeyPath,
        '-out',
        config.tlsCertPath,
        '-days',
        '3650',
        '-subj',
        '/CN=localhost/O=Backend Simulator',
        '-addext',
        'subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1,IP:::1',
      ],
      { stdio: 'pipe' },
    );
    log.info('Certificado TLS local generado', { cert: config.tlsCertPath });
    return {
      cert: readFileSync(config.tlsCertPath),
      key: readFileSync(config.tlsKeyPath),
    };
  } catch (error) {
    log.warn('No se pudo generar el certificado TLS; HTTPS/HTTP2 deshabilitados', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
