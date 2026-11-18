# Backend Simulator

**Backend Simulator es únicamente un servidor local de simulación de APIs HTTP.** No es un cliente HTTP, no implementa ningún SDK y no forma parte de ningún producto externo. Su función es ofrecer APIs de negocio realistas y un laboratorio de transporte para probar cualquier cliente HTTP.

Idiomas: **Español** | [English](README.en.md)

## Qué incluye

- Siete APIs HTTP de negocio sobre SQLite: identidad, proyectos, e-commerce, biblioteca, educación, RRHH y finanzas.
- CRUD, paginación, filtros, búsqueda, ordenación, selección de campos y relaciones.
- Autenticación con Bearer, API keys, sesiones, roles y permisos.
- Operaciones transaccionales: checkout, cancelación, devolución, matriculación, vacaciones, facturación y pagos.
- Laboratorio HTTP independiente en `/test` para probar transporte: compresión, streaming, redirects, cookies, caché, rangos, errores, timeouts, rate limiting y concurrencia.
- Micro frontend estático en `/ui/` con resumen, Request Lab, catálogo de endpoints, tema e idioma. Sin framework y sin build.
- HTTP/1.1, HTTPS local, HTTP/2 sobre TLS y proxy HTTP local opcional.
- Datos semilla deterministas, persistentes y protegidos por endpoints de control.
- OpenAPI dinámico y documentación bilingüe.

## Inicio rápido

Requisitos: Node.js 24 o superior y OpenSSL (para el certificado local).

```bash
npm install
npm start
```

Servicios por defecto:

| Servicio | URL |
|---|---|
| HTTP/1.1 | `http://127.0.0.1:4000` |
| Interfaz web | `http://127.0.0.1:4000/ui/` |
| Documentación interactiva | `http://127.0.0.1:4000/docs` |
| OpenAPI | `http://127.0.0.1:4000/openapi.json` |
| Laboratorio HTTP | `http://127.0.0.1:4000/test` |
| HTTPS | `https://localhost:4443` |
| HTTP/2 (TLS) | `https://localhost:4444` |
| Proxy local (opcional) | `http://127.0.0.1:8080` |
| Control | `http://127.0.0.1:4000/_control/stats` |

El certificado local se autogenera en `./certs/` si no existe. También puedes ejecutar `npm run certs`.

Comandos:

```bash
npm run dev        # recarga automática
npm run build      # compila a dist/
npm run start:dist
npm run typecheck
npm test           # integración con SQLite temporal
```

## Interfaz web

El micro frontend está en `web/` y se sirve en `/ui/`:

- Resumen de salud, uptime, registros y dominios.
- Request Lab con método, ruta, headers, body, token, aborto y respuesta completa.
- Catálogo de endpoints cargables en el laboratorio.
- Cambio de idioma español/inglés y tema claro/oscuro.
- Base URL configurable, incluso si la UI se sirve por separado.

Es JavaScript nativo con ES modules: sin framework, sin dependencias de UI y sin build. Gestión y personalización: [docs/frontend.md](docs/frontend.md) · [English](docs/frontend.en.md).

## Documentación

| Documento | Español | English |
|---|---|---|
| Guía paso a paso | [docs/user-guide.md](docs/user-guide.md) | [docs/user-guide.en.md](docs/user-guide.en.md) |
| Micro frontend | [docs/frontend.md](docs/frontend.md) | [docs/frontend.en.md](docs/frontend.en.md) |
| Laboratorio HTTP | [docs/http-lab.md](docs/http-lab.md) | [docs/http-lab.en.md](docs/http-lab.en.md) |
| Matriz de capacidades | [docs/capabilities.md](docs/capabilities.md) | [docs/capabilities.en.md](docs/capabilities.en.md) |
| Plan de entrega | [PLAN.md](PLAN.md) | [PLAN.en.md](PLAN.en.md) |
| Especificación de API | `GET /openapi.json` | `GET /openapi.json` |

## Credenciales de simulación

| Uso | Valor |
|---|---|
| Administrador | `admin@simulator.local` / `Admin123!` |
| Viewer | `viewer@simulator.local` / `Viewer123!` |
| Resto de usuarios | `Password123!` |
| Token Bearer admin | `local-admin-token` |
| Token Bearer viewer | `local-viewer-token` |
| API key admin | `local-test-api-key` (header `X-API-Key`) |
| Token de control | `local-control-token` (header `X-Control-Token`) |
| Basic Auth del laboratorio | `testuser` / `testpass` |
| Bearer del laboratorio | `local-admin-token` |

Todos los valores son configurables mediante variables de entorno. Son credenciales de simulación, no secretos reales.

## APIs de negocio

Prefijo común: `/api/v1`.

| Dominio | Prefijo | Contenido principal |
|---|---|---|
| Identidad | `/api/v1/identity` | auth, usuarios, perfiles, roles, permisos, grupos, sesiones, tokens, API keys, direcciones, preferencias |
| Proyectos | `/api/v1/projects` | equipos, proyectos, miembros, tareas, subtareas, comentarios, etiquetas, adjuntos, actividad |
| E-commerce | `/api/v1/shop` | clientes, catálogo, variantes, stock, carritos, checkout, pedidos, pagos, reembolsos, envíos, cupones, reseñas |
| Biblioteca | `/api/v1/library` | autores, editoriales, géneros, libros, ejemplares, lectores, préstamos, reservas, multas |
| Educación | `/api/v1/education` | estudiantes, profesores, cursos, asignaturas, secciones, matrículas, notas, asistencia, materiales |
| RRHH | `/api/v1/hr` | empleados, departamentos, puestos, contratos, salarios, vacaciones, asistencia |
| Finanzas | `/api/v1/finance` | cuentas, transacciones, facturas, proveedores, gastos, presupuestos, pagos, reportes |

### Convenciones

Respuesta de recurso:

```json
{ "data": { "id": 1 } }
```

Lista paginada:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "per_page": 25,
    "offset": 0,
    "total": 60,
    "total_pages": 3,
    "has_next": true,
    "has_prev": false
  }
}
```

Error estructurado:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Datos inválidos",
    "details": [{ "field": "email", "message": "email inválido" }],
    "request_id": "f8b4…"
  }
}
```

Los recursos habituales aceptan:

- `page`, `per_page` (máximo 100), `limit` y `offset`.
- `sort=campo`, `sort=-campo` y `order=asc|desc`.
- `fields=id,name,price_cents` para seleccionar columnas.
- `q=texto` en recursos con búsqueda.
- Filtros exactos `?status=active`; los parámetros repetidos generan `IN`.
- Rangos `_gte`, `_lte`, `_gt`, `_lt` y `_like` cuando el tipo lo permite.
- `ETag` en lecturas; `If-None-Match` devuelve `304`; `If-Match` devuelve `412` si la versión no coincide.

Métodos: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` y `OPTIONS`. `OPTIONS` incluye `Allow`; `HEAD` conserva cabeceras y elimina el cuerpo; los métodos no permitidos devuelven `405`.

### Autenticación

- `Authorization: Bearer <token>` para sesiones y tokens.
- `X-API-Key: <key>` para API keys.
- Los recursos de identidad requieren `identity:read` para lectura e `identity:write` para escritura.
- El resto de dominios está abierto por defecto; los escenarios `401`/`403` están disponibles en identidad y en `/test/auth/*`.

```bash
curl -s http://localhost:4000/health

TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/identity/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@simulator.local","password":"Admin123!"}' |
  node -pe 'JSON.parse(fs.readFileSync(0)).data.access_token')

curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/v1/identity/auth/me

curl -s -H 'X-API-Key: local-test-api-key' \
  'http://localhost:4000/api/v1/identity/users?per_page=3'
```

## Laboratorio HTTP

Prefijo `/test`, independiente de SQLite. Permite probar:

- Eco de método, URL, query repetida, headers crudos, cookies y cuerpo.
- Métodos estándar, de extensión y personalizados.
- Códigos HTTP, cuerpos vacíos, JSON inválido, binarios, HTML, XML y CSV.
- Compresión gzip, deflate y Brotli.
- Redirecciones 301/302/303/307/308, cadenas, bucles y destinos ausentes.
- Basic, Bearer, API key y tokens expirados.
- Cookies, ETag/Last-Modified/304, streaming, SSE, trailers y descargas con rangos.
- Delays, timeouts, cortes, respuestas incompletas, errores, 429 y rate limiting.
- Concurrencia, contador e idempotencia.
- Respuestas HTTP malformadas a nivel de socket.

Guía completa: [docs/http-lab.md](docs/http-lab.md) · [English](docs/http-lab.en.md).

```bash
curl -i http://localhost:4000/test/status/418
curl -i --compressed 'http://localhost:4000/test/compress?algo=gzip&body=hola'
curl -i 'http://localhost:4000/test/download?size=1048576' -H 'Range: bytes=0-1023'
curl -i 'http://localhost:4000/test/redirect/307?to=/test/echo'
curl -i 'http://localhost:4000/test/cache/etag?version=2'
curl -s -X POST 'http://localhost:4000/test/idempotency' -H 'Idempotency-Key: demo'
```

## Protocolos de transporte

| Capacidad | Estado |
|---|---|
| HTTP/1.1 | Sí |
| HTTPS con certificado autofirmado local | Sí (`HTTPS_PORT`) |
| HTTP/2 sobre TLS | Sí (`HTTP2_PORT`, ALPN `h2`) |
| HTTP/2 con fallback HTTP/1.1 | Sí (`allowHTTP1`) |
| Proxy HTTP local (URL absoluta y CONNECT) | Sí, opcional y solo destinos locales |
| SSE | Sí, `/test/stream/sse` |
| WebSocket | No implementado |

## Persistencia y datos

- SQLite en `DB_PATH` (por defecto `./data/backend-simulator.sqlite`), WAL activo y foreign keys activas.
- Los datos semilla solo se cargan si la base está vacía. **No se borran al arrancar.**
- IDs explícitos y datos deterministas; Unicode, NULLs, fechas variadas, importes en céntimos y estados variados.
- `SEED_SCALE` (0.1–10) multiplica los volúmenes principales.
- Estadísticas: `GET /_control/stats` y `GET /_control/domains`.
- Reset protegido con `X-Control-Token`:

```bash
curl -X POST http://localhost:4000/_control/reset/shop \
  -H 'X-Control-Token: local-control-token'

curl -X POST http://localhost:4000/_control/reset \
  -H 'X-Control-Token: local-control-token'
```

- Datos adicionales: `POST /_control/seed` con `{"entity":"users|tasks|products|books|students|employees|transactions","count":N}` y `X-Control-Token`.
- Resetear identidad o RRHH puede dejar referencias opcionales a `NULL` en otros dominios. Shop, library, education y projects se restauran de forma autocontenida.

## Configuración

Copia `.env.example`. Las variables del entorno tienen prioridad; `.env` se carga si existe.

| Variable | Defecto | Descripción |
|---|---|---|
| `HOST` | `127.0.0.1` | Interfaz de escucha |
| `PORT` | `4000` | Puerto HTTP (`0` = aleatorio) |
| `HTTPS_ENABLED` | `true` | Activa HTTPS |
| `HTTPS_PORT` | `4443` | Puerto HTTPS |
| `HTTP2_ENABLED` | `true` | Activa HTTP/2 TLS |
| `HTTP2_PORT` | `4444` | Puerto HTTP/2 |
| `PROXY_ENABLED` | `false` | Activa proxy local |
| `PROXY_PORT` | `8080` | Puerto del proxy |
| `UI_ENABLED` | `true` | Sirve el micro frontend en `/ui/` |
| `UI_DIR` | `./web` | Directorio de archivos de la UI |
| `DB_PATH` | `./data/backend-simulator.sqlite` | Ruta SQLite |
| `SEED_SCALE` | `1` | Escala de datos (0.1–10) |
| `MAX_BODY_BYTES` | `10485760` | Límite de request body |
| `MAX_RESPONSE_BYTES` | `20971520` | Límite de respuestas generadas |
| `MAX_PAGE_SIZE` | `100` | Tamaño máximo de página |
| `MAX_DELAY_MS` | `60000` | Retraso máximo del laboratorio |
| `REQUEST_TIMEOUT_MS` | `30000` | Timeout de recepción |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | semilla | Credenciales del administrador |
| `SEED_PASSWORD` | `Password123!` | Contraseña de usuarios semilla |
| `ADMIN_TOKEN` / `VIEWER_TOKEN` | semilla | Tokens Bearer |
| `TEST_API_KEY` | `local-test-api-key` | API key semilla y del laboratorio |
| `CONTROL_TOKEN` | `local-control-token` | Protección de reset y seed |
| `BASIC_USER` / `BASIC_PASSWORD` | `testuser` / `testpass` | Basic Auth del laboratorio |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | `./certs/...` | Certificado y clave |
| `TLS_AUTO_GENERATE` | `true` | Genera certificado si falta |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |

## Estructura

```text
src/
  app.ts, index.ts       composición y arranque HTTP/HTTPS/HTTP2/proxy
  core/                  configuración, errores, logger y validación
  db/                    schema.sql, persistencia, seed y mapa de dominios
  http/                  router, contexto HTTP, auth, filtros, CRUD y OpenAPI
  domains/               APIs de negocio
  lab/                   laboratorio HTTP
  control/               estadísticas, reset y datos extra
  transport/             certificados TLS y proxy local
web/                     micro frontend estático (HTML/CSS/JS, sin build)
tests/                   integración y pruebas del frontend
docs/                    guía, frontend, laboratorio, capacidades y versiones en inglés
```

## Pruebas

```bash
npm test
npm run typecheck
```

Las 48 pruebas usan bases SQLite temporales y puertos aleatorios; no tocan la base de desarrollo. Cubren restricciones relacionales, transacciones, autenticación, validación, ETag/412, operaciones de negocio, laboratorio HTTP, compresión, rangos, streaming, HTTPS, HTTP/2, proxy, servidor estático y helpers del micro frontend.

## Límites y seguridad

Este servidor es exclusivamente local:

- Credenciales y certificados de simulación; no usar en producción.
- El proxy solo acepta destinos locales.
- Las redirecciones del laboratorio solo admiten rutas locales.
- Los cuerpos y respuestas generadas están limitados por configuración.
- La UI guarda el token en `sessionStorage` y no carga recursos de terceros.
- Las operaciones destructivas exigen `X-Control-Token`.
- Las consultas usan parámetros ligados y listas blancas de columnas/tablas.
- No se ejecuta código recibido ni se accede a archivos por rutas de usuario.
