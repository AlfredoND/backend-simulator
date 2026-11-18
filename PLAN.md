# Plan de entrega — Backend Simulator

Idiomas: **Español** | [English](PLAN.en.md)

Estado: **completado y verificado** (2026-11-18).

Runtime: Node.js 24 + TypeScript, SQLite (`node:sqlite`), servidor `node:http`, HTTPS/HTTP2 y proxy local.

## Fase 1 — Persistencia [COMPLETA]
- Esquema de 82 tablas con FKs, CHECK, UNIQUE, NULLs, 34 índices, 1:1, 1:N y M:N.
- Seed determinista de siete dominios con Unicode, estados variados, textos largos y dinero en céntimos.
- Transacciones, rollback, WAL y consultas parametrizadas.
- Resumen y datos adicionales mediante `/_control`.

## Fase 2 — APIs de negocio [COMPLETA]
- Identidad: login, refresh, logout, recuperación, usuarios, perfiles, RBAC, grupos, sesiones, tokens, API keys, direcciones y preferencias.
- Proyectos: CRUD y operaciones de tareas, subtareas, estados, miembros, actividad y estadísticas.
- E-commerce: catálogo, carritos, checkout atómico, stock, pedidos, pagos, cancelación, reembolsos, envíos, cupones y reseñas.
- Biblioteca: catálogo, disponibilidad, préstamos, devoluciones con multa, renovaciones, reservas y multas.
- Educación: CRUD, matrícula con aforo, notas, asistencia en lote y expediente/GPA.
- RRHH: empleados, contratos, salarios, vacaciones con saldo, asistencia y reportes.
- Finanzas: cuentas, transacciones con saldo, facturas con líneas, pagos, gastos, presupuestos y reportes.
- ETag/If-None-Match/304 e If-Match/412; paginación, filtros, búsqueda, orden y selección de campos; HEAD/OPTIONS/405.

## Fase 3 — Laboratorio HTTP [COMPLETA]
- `/test`: eco, métodos, status, headers, cuerpos, respuestas, compresión, redirects.
- Auth Basic/Bearer/API key/expirada/esquema; cookies; caché/304.
- Streaming texto/binario/SSE/trailers, interrupciones, incompletas y descargas con Range/416.
- Delays, timeout, cierre, errores 4xx/5xx, rate limit, concurrencia, idempotencia y respuestas malformadas.
- Métodos personalizados: extensión completa y captura básica para tokens arbitrarios; HTTP/2 admite métodos arbitrarios.

## Fase 4 — Protocolos y documentación [COMPLETA]
- HTTPS con certificado autogenerado.
- HTTP/2 TLS en puerto independiente, con fallback HTTP/1.1.
- Proxy HTTP local opcional con peticiones absolutas y CONNECT, restringido a destinos locales.
- OpenAPI dinámico y bilingüe en `/openapi.json`, `/openapi.en.json` y UI en `/docs`.
- README, guía de uso, documentación del laboratorio, matriz de capacidades y `.env.example`, con versiones en español e inglés.

## Fase 5 — Micro frontend [COMPLETA]
- UI estática en `web/`, sin framework ni build, servida en `/ui/`.
- Resumen de salud/datos, Request Lab, catálogo de endpoints, documentación, tema e idioma.
- Servidor estático con MIME, CSP y protección de traversal.
- Documentación bilingüe en `docs/frontend.md` y `docs/frontend.en.md`.

## Fase 6 — Acceso global, escenarios y contratos [COMPLETA]
- Política global `AUTH_REQUIRED=true` con permisos `<dominio>:read/write`.
- 80 usuarios semilla y 12 grupos con roles; permisos efectivos = roles directos + roles de grupo.
- Escenarios 429/500/503 en todas las APIs y rate limit global configurable.
- OpenAPI completamente bilingüe con cobertura validada en pruebas.
- Documentación de autorización/escenarios en español e inglés.
- CI en `.github/workflows/ci.yml` y pruebas de consistencia documental.
- JSDoc de contratos, seguridad y decisiones arquitectónicas en todo el código de `src/` y `web/`.

## Fase 7 — Modo de datos, licencia y calidad [COMPLETA]
- Modo persistente y modo congelado con copia descartable, restauración de imagen y salida al modo persistente.
- Endpoints `/_control/mode`, `/_control/freeze`, `/_control/restore` y `/_control/unfreeze`.
- Panel bilingüe de modo de datos en la consola, con token de control en `sessionStorage`.
- Licencia Apache-2.0 con `LICENSE`, `NOTICE` y metadatos en `package.json`.
- Dependencias de desarrollo fijadas a versiones exactas, sin `^`.
- Calidad con Biome: `biome.json`, `.editorconfig`, `npm run lint` (falla ante warnings), `npm run format:check` y `npm run check`.
- Documentación bilingüe del modo de datos y de la licencia.

## Fase 8 — Verificación [COMPLETA]
- `npm test`: 74/74 pruebas.
- `npm run typecheck`: sin errores.
- `npm run lint` y `npm run format:check`: sin errores.
- `npm run build`: OK, copia `schema.sql`.
- `npm audit`: 0 vulnerabilidades.
- Cobertura: persistencia, APIs, autorización/grupos, escenarios, OpenAPI bilingüe, laboratorio, protocolos TLS/HTTP2/proxy, micro frontend, modo de datos congelado y calidad.

## Limitaciones conocidas
- WebSocket no implementado (SSE sí).
- HTTP/3/QUIC no implementado.
- Trailers verificados en HTTP/1.1; HTTP/2 no tiene prueba específica.
- Uploads se reflejan (multipart/binario) pero no se persisten archivos.
- Métodos arbitrarios con cuerpo completo requieren HTTP/2 o métodos de extensión.
- Reset de dominios con dependencias externas (identidad/RRHH) puede dejar referencias opcionales a NULL.
- El rate limit global es en memoria y por proceso; no está pensado para despliegues distribuidos.
- La UI es estática y deliberadamente simple: no incluye router SPA ni framework.
- El modo congelado usa un snapshot síncrono y una sola imagen por proceso; no sobrevive a reinicios.
- Biome aporta lint y formato rápidos, pero no análisis type-aware como `typescript-eslint`.
