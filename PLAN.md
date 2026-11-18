# Plan de entrega — Backend Simulator

Estado: **completado y verificado** (2026-11-18).

Runtime: Node.js 24 + TypeScript, SQLite (`node:sqlite`), servidor `node:http`, HTTPS/HTTP2 y proxy local.

## Fase 1 — Persistencia [COMPLETA]
- Esquema de 82 tablas con FKs, CHECK, UNIQUE, NULLs, 34 índices, 1:1, 1:N y M:N.
- Seed determinista de seis dominios con Unicode, estados variados, textos largos y dinero en céntimos.
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
- OpenAPI dinámico en `/openapi.json` y UI en `/docs`.
- README, `docs/http-lab.md`, `docs/capabilities.md` y `.env.example`.

## Fase 5 — Verificación [COMPLETA]
- `npm test`: 37/37 pruebas.
- `npm run typecheck`: sin errores.
- `npm run build`: OK, copia `schema.sql`.
- Cobertura: persistencia, APIs, lab y protocolos TLS/HTTP2/proxy.

## Limitaciones conocidas
- WebSocket no implementado (SSE sí).
- HTTP/3/QUIC no implementado.
- Trailers verificados en HTTP/1.1; HTTP/2 no tiene prueba específica.
- Uploads se reflejan (multipart/binario) pero no se persisten archivos.
- Métodos arbitrarios con cuerpo completo requieren HTTP/2 o métodos de extensión.
- Reset de dominios con dependencias externas (identidad/RRHH) puede dejar referencias opcionales a NULL.
- Rate limit global de APIs no incluido; el laboratorio ofrece rate limit configurable.
