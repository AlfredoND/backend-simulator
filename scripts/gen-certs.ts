import { loadConfig } from '../src/core/config.js';
import { createLogger } from '../src/core/logger.js';
import { ensureCertificates } from '../src/transport/tls.js';

const config = loadConfig({ httpsEnabled: true, http2Enabled: true });
const log = createLogger('info');
const material = ensureCertificates(config, log);
if (!material) {
  console.error('No se pudo generar o leer el certificado TLS.');
  process.exit(1);
}
console.log(`Certificado: ${config.tlsCertPath}`);
console.log(`Clave privada: ${config.tlsKeyPath}`);
console.log('SAN: localhost, *.localhost, 127.0.0.1, ::1');
