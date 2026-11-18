# Mafetch Backend Simulator

Entorno local de simulación de APIs HTTP y de transporte para probar clientes como Mafetch sin mocks acoplados. Incluye seis dominios de negocio sobre SQLite, un laboratorio HTTP independiente, HTTPS, HTTP/2, proxy local, datos deterministas y documentación OpenAPI.

No implementa Mafetch, no es un runner de pruebas y no pretende ser seguro para producción.

## Inicio rápido

Requisitos: Node.js 24 o superior y OpenSSL (para generar el certificado local).

```bash
npm install
npm start
```

Servicios por defecto:

| Servicio | URL |
|---|---|
| HTTP/1.1 | `http://127.0.0.1:4000` |
| Docs | `http://127.0.0.1:4000/docs` |
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
npm test           # pruebas de integración con SQLite temporal
```

## Credenciales semilla

| Uso | Valor |
|---|---|
| Administrador | `admin@mafetch.local` / `Admin123!` |
| Viewer | `viewer@mafetch.local` / `Viewer123!` |
| Resto de usuarios | `Password123!` |
| Token Bearer admin | `local-admin-token` |
| Token Bearer viewer | `local-viewer-token` |
| API key admin | `local-test-api-key` (header `X-API-Key`) |
| Token de control | `local-control-token` (header `X-Control-Token`) |
| Basic Auth del laboratorio | `testuser` / `testpass` |
| Bearer del laboratorio | `local-admin-token` |

Todos los valores son configurables por variables de entorno. No son secretos reales.

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

Respuestas exitosas:

```json
{ "data": { "id": 1 } }
```

Listas:

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

Errores:

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

La mayoría de recursos generados aceptan:

- `page`, `per_page` (máximo 100), `limit`, `offset`.
- `sort=campo` o `sort=-campo`, y `order=asc|desc`.
- `fields=id,name,precio` para seleccionar columnas.
- `q=texto` donde hay búsqueda documentada.
- Filtros exactos `?status=active`; al repetir un parámetro se genera `IN`.
- Rangos `_gte`, `_lte`, `_gt`, `_lt` y `_like` cuando el tipo lo permite.
- `ETag` en lecturas de recurso, `If-None-Match` → `304`, y `If-Match` en escrituras → `412` si la versión no coincide.

Métodos: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` y `OPTIONS`. `OPTIONS` devuelve `Allow`; `HEAD` mantiene cabeceras y elimina el cuerpo. Los métodos no permitidos devuelven `405`.

### Autenticación

- `Authorization: Bearer <token>` para sesiones y tokens.
- `X-API-Key: <key>` para API keys.
- Los recursos de identidad y las mutaciones sensibles exigen permisos. Las rutas de lectura de identidad requieren `identity:read`; las escrituras `identity:write`.
- El resto de dominios está abierto por defecto para facilitar escenarios de negocio; los escenarios de `401`/`403` están disponibles en identidad y en `/test/auth/*`.
- Permisos efectivos: `GET /api/v1/identity/users/:id/permissions`.

Ejemplos:

```bash
curl -s http://localhost:4000/health

TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/identity/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@mafetch.local","password":"Admin123!"}' |
  node -pe 'JSON.parse(fs.readFileSync(0)).data.access_token')

curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/v1/identity/auth/me

curl -s -H 'X-API-Key: local-test-api-key' \
  'http://localhost:4000/api/v1/identity/users?per_page=3'
```

### Operaciones de negocio destacadas

- **Proyectos**: crear tareas dentro de un proyecto, subtareas, cambio de estado, historial y estadísticas agregadas.
- **E-commerce**: checkout atómico con cálculo de impuestos, descuento, envío, pago, envío logístico y descuento de stock; cancelación y reembolso restauran/actualizan datos en transacción.
- **Biblioteca**: préstamo con disponibilidad y límite de 5 préstamos activos, devolución con multa por retraso, renovación y reservas con índice único parcial.
- **Educación**: matrícula por sección con aforo, asistencia en lote con upsert y expediente con promedio ponderado/GPA.
- **RRHH**: solicitud de vacaciones con solape y saldo anual, aprobación/rechazo, nómina agregada.
- **Finanzas**: factura con líneas y cálculo de IVA, pago parcial/total, movimientos que actualizan saldo, balance y presupuestos.

Consulta `/docs` para contratos interactivos. La especificación `/openapi.json` se genera desde el router y los esquemas de recursos.

## Laboratorio HTTP

Prefijo `/test`, independiente de SQLite. Incluye:

- Eco completo de método, URL, query repetida, headers crudos, cookies y cuerpo (texto, base64, SHA-256, JSON parseado).
- Métodos estándar y extensiones; métodos personalizados arbitrarios en `/test/echo` (capturados por el parser) y en HTTP/2.
- Códigos de estado, cuerpos vacíos/binarios/JSON/HTML/XML/CSV, JSON inválido y Content-Type incorrecto.
- Compresión gzip, deflate y Brotli, negociada o forzada.
- Redirecciones 301/302/303/307/308, relativas/absolutas, cadenas, bucles y destinos ausentes.
- Basic, Bearer, API key, credenciales ausentes/incorrectas, expiradas y esquema incorrecto.
- Cookies con Path, Max-Age, Expires, HttpOnly, Secure y SameSite; múltiples cookies.
- ETag/If-None-Match, Last-Modified/If-Modified-Since, Cache-Control y 304.
- Streaming de texto/binario/SSE, trailers, cortes, respuestas incompletas y descargas grandes.
- Rangos `Range`/`Content-Range`, rangos inválidos `416` y descargas condicionales.
- Retrasos, timeout, cierre de conexión, errores controlados, 429 con `Retry-After` y rate limit en memoria.
- Concurrencia, contador, idempotencia con `Idempotency-Key`.
- Respuestas HTTP malformadas y cabeceras inválidas a nivel de socket.

Referencia completa con ejemplos: [docs/http-lab.md](docs/http-lab.md).

Ejemplos:

```bash
curl -i http://localhost:4000/test/status/418
curl -i --compressed 'http://localhost:4000/test/compress?algo=gzip&body=hola'
curl -i 'http://localhost:4000/test/download?size=1048576' -H 'Range: bytes=0-1023'
curl -i 'http://localhost:4000/test/redirect/307?to=/test/echo'
curl -i 'http://localhost:4000/test/cache/etag?version=2'
curl -s -X POST 'http://localhost:4000/test/idempotency' -H 'Idempotency-Key: demo'
```

## Protocolos y transporte

| Capacidad | Estado |
|---|---|
| HTTP/1.1 | Sí |
| HTTPS con certificado autofirmado local | Sí (`HTTPS_PORT`) |
| HTTP/2 sobre TLS | Sí (`HTTP2_PORT`, ALPN `h2`) |
| HTTP/2 sobre HTTP/1.1 en el mismo puerto TLS | Sí (`allowHTTP1`) |
| Proxy HTTP local (peticiones absolutas y CONNECT) | Sí, opcional y limitado a destinos locales |
| SSE | Sí, `/test/stream/sse` |
| WebSocket | No implementado |

El proxy es útil para probar clientes con configuración de proxy, pero rechaza destinos externos para no actuar como proxy abierto.

## Persistencia y datos

- SQLite en `DB_PATH` (por defecto `./data/mafetch-sim.sqlite`), WAL activado, foreign keys activas.
- Los datos semilla solo se cargan si la base está vacía. **No se borran al arrancar.**
- IDs explícitos y datos deterministas; Unicode, NULLs, fechas variadas, dinero en céntimos y estados variados.
- `SEED_SCALE` (0.1–10) multiplica los volúmenes principales.
- Estadísticas: `GET /_control/stats` y `GET /_control/domains`.
- Reseteo protegido:

```bash
curl -X POST http://localhost:4000/_control/reset/shop \
  -H 'X-Control-Token: local-control-token'

curl -X POST http://localhost:4000/_control/reset \
  -H 'X-Control-Token: local-control-token'
```

- Datos adicionales: `POST /_control/seed` con `{"entity":"users|tasks|products|books|students|employees|transactions","count":N}` y `X-Control-Token`.
- Resetear un dominio con dependencias externas (por ejemplo identidad o RRHH) puede dejar referencias opcionales a `NULL`; los dominios autocontenidos (shop, library, education, projects) se restauran limpiamente.

## Configuración

Todas las variables se leen del entorno. También se carga `.env` si existe (sin sobrescribir variables ya definidas). Copia `.env.example`.

| Variable | Defecto | Descripción |
|---|---|---|
| `HOST` | `127.0.0.1` | Interfaz de escucha |
| `PORT` | `4000` | Puerto HTTP (`0` en pruebas = aleatorio) |
| `HTTPS_ENABLED` | `true` | Activa HTTPS |
| `HTTPS_PORT` | `4443` | Puerto HTTPS |
| `HTTP2_ENABLED` | `true` | Activa HTTP/2 TLS |
| `HTTP2_PORT` | `4444` | Puerto HTTP/2 |
| `PROXY_ENABLED` | `false` | Activa proxy local |
| `PROXY_PORT` | `8080` | Puerto proxy |
| `DB_PATH` | `./data/mafetch-sim.sqlite` | Ruta SQLite |
| `SEED_SCALE` | `1` | Escala de datos (0.1–10) |
| `MAX_BODY_BYTES` | `10485760` | Límite de request body |
| `MAX_RESPONSE_BYTES` | `20971520` | Límite de respuestas generadas |
| `MAX_PAGE_SIZE` | `100` | Tamaño máximo de página |
| `MAX_DELAY_MS` | `60000` | Retraso máximo del laboratorio |
| `REQUEST_TIMEOUT_MS` | `30000` | Timeout de recepción de request |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | semilla | Credenciales del admin |
| `SEED_PASSWORD` | `Password123!` | Contraseña de usuarios semilla |
| `ADMIN_TOKEN` / `VIEWER_TOKEN` | semilla | Tokens Bearer de negocio y laboratorio |
| `TEST_API_KEY` | `local-test-api-key` | API key semilla y laboratorio |
| `CONTROL_TOKEN` | `local-control-token` | Protección de reset/seed |
| `BASIC_USER` / `BASIC_PASSWORD` | `testuser` / `testpass` | Basic Auth del laboratorio |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | `./certs/...` | Certificado y clave |
| `TLS_AUTO_GENERATE` | `true` | Genera certificado con OpenSSL si falta |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |

## Estructura

```text
src/
  app.ts, index.ts       composición y arranque HTTP/HTTPS/HTTP2/proxy
  schema.sql             esquema relacional
  seed.ts                datos deterministas y reseteo
  db.ts, config.ts       persistencia y configuración
  router.ts, http.ts     router sin framework, cuerpos y respuestas
  resource.ts, query.ts  CRUD reutilizable, validación, paginación y filtros
  auth.ts, validate.ts   autenticación/permisos y validación de cuerpos
  domains/               identidad, proyectos, shop, biblioteca, educación, RRHH, finanzas
  lab.ts                 laboratorio HTTP
  control.ts             estadísticas, reset y datos extra
  openapi.ts             especificación y UI
  tls.ts, proxy.ts       certificados y proxy
tests/                   integración: db, api, lab, protocolos
docs/                    documentación del laboratorio y matriz de capacidades
```

## Pruebas

```bash
npm test
npm run typecheck
```

Las pruebas usan bases SQLite temporales y puertos aleatorios; no tocan la base de desarrollo. Cubren restricciones relacionales, transacciones/rollback, auth 401/403, validación, ETag/412, operaciones de negocio, laboratorio HTTP, compresión, rangos, streaming, HTTPS, HTTP/2 y proxy.

Matriz de cobertura honesta: [docs/capabilities.md](docs/capabilities.md).

## Límites y seguridad

Este servidor es exclusivamente local:

- Las credenciales y certificados son de simulación; no usar en producción.
- El proxy solo acepta destinos locales.
- Las redirecciones del laboratorio solo admiten rutas locales.
- Los cuerpos y respuestas generadas están limitados por configuración.
- Las operaciones destructivas exigen `X-Control-Token`.
- Las consultas usan parámetros ligados y listas blancas de columnas/tablas.
- No se ejecuta código recibido ni se accede a archivos por rutas de usuario.
