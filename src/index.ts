/**
 * @file Process entrypoint. Builds the application, starts every enabled
 * transport and installs graceful shutdown handlers.
 */
import { createApp } from './app.js';

const app = createApp();
const port = await app.start();
app.log.info('Servidor listo', {
  http: `http://${app.config.host}:${port}`,
  https: app.ports.https ? `https://${app.config.host}:${app.ports.https}` : null,
  http2: app.ports.http2 ? `https://${app.config.host}:${app.ports.http2} (HTTP/2)` : null,
  proxy: app.ports.proxy ? `http://${app.config.host}:${app.ports.proxy} (proxy)` : null,
  docs: `http://${app.config.host}:${port}/docs`,
});

const shutdown = async (signal: string) => {
  app.log.info('Cerrando servidor', { signal });
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
