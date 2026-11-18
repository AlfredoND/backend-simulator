# Guía de uso de Backend Simulator

Esta guía explica cómo arrancar y utilizar **Backend Simulator**, un servidor local de simulación de APIs HTTP. No es un cliente HTTP ni un SDK: solo proporciona APIs de negocio y escenarios de transporte para que cualquier cliente pueda probarse contra él.

Idiomas: **Español** | [English](user-guide.en.md)

## 1. Requisitos

- Node.js 24 o superior.
- npm.
- OpenSSL (solo para generar el certificado HTTPS local).
- `curl` o cualquier cliente HTTP para los ejemplos.

No necesitas una base de datos externa: se usa SQLite embebido.

## 2. Instalación

```bash
npm install
npm start
```

El primer arranque crea `./data/backend-simulator.sqlite`, genera los datos semilla y crea un certificado en `./certs/` si no existe.

Para desarrollo con recarga automática:

```bash
npm run dev
```

Para compilar y ejecutar la versión compilada:

```bash
npm run build
npm run start:dist
```

## 3. Verificación inicial

```bash
curl -s http://localhost:4000/health
curl -s http://localhost:4000/
curl -s http://localhost:4000/openapi.json | head -c 300
```

Abre `http://localhost:4000/docs` para la interfaz interactiva de OpenAPI.

Si el puerto 4000 está ocupado, cámbialo:

```bash
PORT=4100 npm start
```

## 4. Configuración mínima

Copia `.env.example` a `.env` y ajusta lo necesario:

```bash
cp .env.example .env
```

Variables habituales:

```dotenv
HOST=127.0.0.1
PORT=4000
DB_PATH=./data/backend-simulator.sqlite
HTTPS_ENABLED=true
HTTPS_PORT=4443
HTTP2_ENABLED=true
HTTP2_PORT=4444
PROXY_ENABLED=false
SEED_SCALE=1
LOG_LEVEL=info
```

Las variables de entorno tienen prioridad sobre `.env`. Consulta la tabla completa en el [README](../README.md#configuración).

## 5. Autenticación

Con `AUTH_REQUIRED=true` (por defecto), **todas** las rutas `/api/v1` requieren autenticación y permisos por dominio. Las únicas excepciones son login, refresh, forgot/reset password y verify. El dominio de identidad usa tokens Bearer y API keys. También hay tokens de simulación listos para usar:

```bash
# Token de administrador
curl -s -H 'Authorization: Bearer local-admin-token' \
  http://localhost:4000/api/v1/identity/users?per_page=3

# API key
curl -s -H 'X-API-Key: local-test-api-key' \
  http://localhost:4000/api/v1/identity/users?per_page=3

# Viewer: puede leer, pero no escribir
curl -s -H 'Authorization: Bearer local-viewer-token' \
  http://localhost:4000/api/v1/identity/users?per_page=3
```

Login real con sesión y refresh token:

```bash
LOGIN=$(curl -s -X POST http://localhost:4000/api/v1/identity/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@simulator.local","password":"Admin123!"}')

TOKEN=$(printf '%s' "$LOGIN" | node -pe 'JSON.parse(fs.readFileSync(0)).data.access_token')
REFRESH=$(printf '%s' "$LOGIN" | node -pe 'JSON.parse(fs.readFileSync(0)).data.refresh_token')

curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/v1/identity/auth/me

curl -s -X POST http://localhost:4000/api/v1/identity/auth/refresh \
  -H 'Content-Type: application/json' \
  -d "{\"refresh_token\":\"$REFRESH\"}"
```

Credenciales semilla:

- `admin@simulator.local` / `Admin123!`
- `viewer@simulator.local` / `Viewer123!`
- Resto de usuarios: `Password123!`
- `developer@simulator.local`, `manager@simulator.local`, `auditor@simulator.local`, `support@simulator.local` y `viewer2@simulator.local`: roles acotados.
- `groupviewer@simulator.local`: sin rol directo; recibe permisos del grupo **Observadores**.

Política y grupos:

- Lectura: `<dominio>:read`; escritura: `<dominio>:write`.
- Los permisos efectivos unen roles directos y roles de grupo.
- Los roles de grupo se gestionan en `/api/v1/identity/groups/:id/roles`.
- `GET /api/v1/identity/users/:id/permissions` muestra la unión efectiva.

Escenarios globales:

```bash
# Error inyectado en cualquier dominio
curl -i -H 'Authorization: Bearer local-admin-token' \
  -H 'X-Simulate-Error: 503' \
  http://localhost:4000/api/v1/finance/accounts

# Rate limit real (configura API_RATE_LIMIT_MAX > 0)
curl -i -H 'Authorization: Bearer local-admin-token' \
  http://localhost:4000/api/v1/shop/products
```

Detalle completo: [auth-and-scenarios.md](auth-and-scenarios.md) · [English](auth-and-scenarios.en.md).

Los ejemplos de dominios que siguen incluyen el header de administrador.

## 6. Consultas y paginación

Patrón general:

```bash
curl -s -H 'Authorization: Bearer local-admin-token' 'http://localhost:4000/api/v1/shop/products?per_page=5&sort=-price_cents&fields=id,name,price_cents&status=active'
```

Parámetros útiles:

- `page`, `per_page`, `limit`, `offset`.
- `sort=name` o `sort=-name`; `order=asc|desc`.
- `fields=id,name,price_cents`.
- `q=texto` donde exista búsqueda.
- Filtros exactos: `status=active`, `category_id=2`.
- Rangos: `price_cents_gte=1000`, `price_cents_lte=100000`, `created_at_gte=2026-01-01`.
- Texto parcial: `name_like=portátil`.
- Los parámetros repetidos se convierten en `IN`.

## 7. Ejemplos por dominio

### Proyectos: crear tarea y cambiar estado

```bash
TASK=$(curl -s -H 'Authorization: Bearer local-admin-token' -X POST http://localhost:4000/api/v1/projects/projects/1/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Preparar demo","priority":"high","estimate_minutes":60}')

TASK_ID=$(printf '%s' "$TASK" | node -pe 'JSON.parse(fs.readFileSync(0)).data.id')

curl -s -H 'Authorization: Bearer local-admin-token' -X PATCH "http://localhost:4000/api/v1/projects/tasks/$TASK_ID/status" \
  -H 'Content-Type: application/json' \
  -d '{"status":"done"}'

curl -s -H 'Authorization: Bearer local-admin-token' http://localhost:4000/api/v1/projects/projects/1/stats
```

### E-commerce: carrito y checkout

```bash
CUSTOMER_ID=1
VARIANT_ID=$(curl -s -H 'Authorization: Bearer local-admin-token' 'http://localhost:4000/api/v1/shop/inventory?per_page=100' |
  node -pe "const d=JSON.parse(fs.readFileSync(0)).data; (d.find(r => r.quantity - r.reserved > 2) || {}).variant_id")

CART=$(curl -s -H 'Authorization: Bearer local-admin-token' -X POST http://localhost:4000/api/v1/shop/carts \
  -H 'Content-Type: application/json' \
  -d "{\"customer_id\":$CUSTOMER_ID}")
CART_ID=$(printf '%s' "$CART" | node -pe 'JSON.parse(fs.readFileSync(0)).data.id')

curl -s -H 'Authorization: Bearer local-admin-token' -X POST "http://localhost:4000/api/v1/shop/carts/$CART_ID/items" \
  -H 'Content-Type: application/json' \
  -d "{\"variant_id\":$VARIANT_ID,\"quantity\":1}"

curl -s -H 'Authorization: Bearer local-admin-token' -X POST "http://localhost:4000/api/v1/shop/carts/$CART_ID/checkout" \
  -H 'Content-Type: application/json' \
  -d '{"shipping_address_id":1,"payment_method_id":1,"coupon_code":"SAVE10"}'
```

Comprueba stock antes con:

```bash
curl -s -H 'Authorization: Bearer local-admin-token' http://localhost:4000/api/v1/shop/products/1/details
curl -s -H 'Authorization: Bearer local-admin-token' http://localhost:4000/api/v1/shop/inventory/low-stock?threshold=5
```

### Biblioteca: préstamo y devolución

```bash
LOAN=$(curl -s -H 'Authorization: Bearer local-admin-token' -X POST http://localhost:4000/api/v1/library/loans \
  -H 'Content-Type: application/json' \
  -d '{"book_id":1,"reader_id":1,"days":14}')
LOAN_ID=$(printf '%s' "$LOAN" | node -pe 'JSON.parse(fs.readFileSync(0)).data.id')

curl -s -H 'Authorization: Bearer local-admin-token' -X POST "http://localhost:4000/api/v1/library/loans/$LOAN_ID/return"
curl -s -H 'Authorization: Bearer local-admin-token' http://localhost:4000/api/v1/library/books/1/availability
```

### Educación: matrícula, asistencia y expediente

```bash
STUDENT=$(curl -s -H 'Authorization: Bearer local-admin-token' -X POST http://localhost:4000/api/v1/education/students \
  -H 'Content-Type: application/json' \
  -d '{"student_code":"GUIDE-001","full_name":"Alumno Guía","email":"guide.student@education.test","enrolled_at":"2026-09-01"}')
STUDENT_ID=$(printf '%s' "$STUDENT" | node -pe 'JSON.parse(fs.readFileSync(0)).data.id')

curl -s -H 'Authorization: Bearer local-admin-token' -X POST http://localhost:4000/api/v1/education/sections/1/enroll \
  -H 'Content-Type: application/json' \
  -d "{\"student_id\":$STUDENT_ID}"

curl -s -H 'Authorization: Bearer local-admin-token' -X POST http://localhost:4000/api/v1/education/attendance/bulk \
  -H 'Content-Type: application/json' \
  -d "{\"records\":[{\"student_id\":$STUDENT_ID,\"section_id\":1,\"attendance_date\":\"2026-11-10\",\"status\":\"present\"}]}"

curl -s -H 'Authorization: Bearer local-admin-token' "http://localhost:4000/api/v1/education/students/$STUDENT_ID/transcript"
```

### RRHH: vacaciones

```bash
VACATION=$(curl -s -H 'Authorization: Bearer local-admin-token' -X POST http://localhost:4000/api/v1/hr/vacations/request \
  -H 'Content-Type: application/json' \
  -d '{"employee_id":1,"start_date":"2027-03-01","end_date":"2027-03-03","days":3,"reason":"Guía"}')
VACATION_ID=$(printf '%s' "$VACATION" | node -pe 'JSON.parse(fs.readFileSync(0)).data.id')

curl -s -H 'Authorization: Bearer local-admin-token' -X PATCH "http://localhost:4000/api/v1/hr/vacations/$VACATION_ID/decision" \
  -H 'Content-Type: application/json' \
  -d '{"status":"approved"}'

curl -s -H 'Authorization: Bearer local-admin-token' 'http://localhost:4000/api/v1/hr/vacations/balance/1?year=2027'
curl -s -H 'Authorization: Bearer local-admin-token' http://localhost:4000/api/v1/hr/reports/payroll
```

### Finanzas: factura y pago

```bash
INVOICE=$(curl -s -H 'Authorization: Bearer local-admin-token' -X POST http://localhost:4000/api/v1/finance/invoices \
  -H 'Content-Type: application/json' \
  -d '{"customer_name":"Cliente Guía","items":[{"description":"Servicio","quantity":2,"unit_price_cents":5000}]}')
INVOICE_ID=$(printf '%s' "$INVOICE" | node -pe 'JSON.parse(fs.readFileSync(0)).data.id')

curl -s -H 'Authorization: Bearer local-admin-token' -X POST "http://localhost:4000/api/v1/finance/invoices/$INVOICE_ID/pay" \
  -H 'Content-Type: application/json' \
  -d '{"account_id":2,"method":"transfer","reference":"GUIDE-PAY-1"}'

curl -s -H 'Authorization: Bearer local-admin-token' http://localhost:4000/api/v1/finance/reports/balance
curl -s -H 'Authorization: Bearer local-admin-token' 'http://localhost:4000/api/v1/finance/reports/expenses?group_by=category'
```

## 8. ETag, caché y concurrencia optimista

```bash
PRODUCT=$(curl -s -H 'Authorization: Bearer local-admin-token' -D /tmp/product.headers http://localhost:4000/api/v1/shop/products/1)
ETAG=$(awk 'BEGIN{IGNORECASE=1} /^etag:/ {gsub("\r",""); print $2}' /tmp/product.headers)

# 304 si no cambió
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Authorization: Bearer local-admin-token' \
  -H "If-None-Match: $ETAG" \
  http://localhost:4000/api/v1/shop/products/1

# 412 si la versión no coincide
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH \
  -H 'Authorization: Bearer local-admin-token' \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "incorrecto"' \
  -d '{"description":"cambio"}' \
  http://localhost:4000/api/v1/shop/products/1
```

## 9. Laboratorio HTTP

El prefijo `/test` no usa SQLite y sirve para probar transporte.

```bash
# Eco completo
curl -s -X PATCH 'http://localhost:4000/test/echo?x=1&x=2' \
  -H 'X-Custom: demo' -H 'Content-Type: application/json' \
  -d '{"hello":"world"}'

# Código de estado
curl -i http://localhost:4000/test/status/418

# Compresión
curl -i --compressed 'http://localhost:4000/test/compress?algo=gzip&body=hola'

# Redirecciones
curl -i 'http://localhost:4000/test/redirect/307?to=/test/echo'
curl -i 'http://localhost:4000/test/redirect/chain/3'
curl -i 'http://localhost:4000/test/redirect/loop'

# Autenticación
curl -i -u testuser:testpass http://localhost:4000/test/auth/basic
curl -i -H 'Authorization: Bearer local-admin-token' http://localhost:4000/test/auth/bearer
curl -i -H 'X-API-Key: local-test-api-key' http://localhost:4000/test/auth/api-key

# Cookies
curl -i 'http://localhost:4000/test/cookies/set?name=session&value=abc&httpOnly=1'
curl -s -H 'Cookie: a=1; b=2' http://localhost:4000/test/cookies/echo

# Caché
curl -i http://localhost:4000/test/cache/etag?version=1
curl -i -H 'If-None-Match: "sim-etag-v1"' http://localhost:4000/test/cache/etag?version=1

# Rangos
curl -i 'http://localhost:4000/test/download?size=100000' -H 'Range: bytes=0-1023'

# Streaming
curl -N 'http://localhost:4000/test/stream/text?chunks=5&delay=200&size=32'
curl -N 'http://localhost:4000/test/stream/sse?count=3&delay=200'

# Delay, timeout y errores
curl -i 'http://localhost:4000/test/delay/500'
curl -i 'http://localhost:4000/test/timeout?ms=5000'
curl -i http://localhost:4000/test/error/503
curl -i http://localhost:4000/test/error/429

# Rate limit
curl -i 'http://localhost:4000/test/rate-limit?limit=2&key=demo'

# Idempotencia
curl -i -X POST http://localhost:4000/test/idempotency -H 'Idempotency-Key: demo'
```

Métodos personalizados: usa un método de extensión, por ejemplo:

```bash
curl -i -X PROPFIND http://localhost:4000/test/echo
```

La referencia completa está en [http-lab.md](http-lab.md) y [http-lab.en.md](http-lab.en.md).

## 10. HTTPS, HTTP/2 y proxy

```bash
# HTTPS con certificado local
curl -k https://localhost:4443/health

# HTTP/2 sobre TLS
curl -k --http2 https://localhost:4444/test/echo

# Detén el servidor actual y arráncalo con el proxy habilitado
PROXY_ENABLED=true npm start
curl -x http://127.0.0.1:8080 http://127.0.0.1:4000/test/echo
```

El proxy solo permite destinos locales. Para confiar en el certificado, añade `certs/localhost-cert.pem` a tu almacén de confianza o usa `-k` en pruebas locales.

## 11. Control de datos

```bash
# Estadísticas
curl -s http://localhost:4000/_control/stats
curl -s http://localhost:4000/_control/domains

# Reset de un dominio
curl -s -X POST http://localhost:4000/_control/reset/shop \
  -H 'X-Control-Token: local-control-token'

# Reset total
curl -s -X POST http://localhost:4000/_control/reset \
  -H 'X-Control-Token: local-control-token'

# Datos adicionales
curl -s -X POST http://localhost:4000/_control/seed \
  -H 'X-Control-Token: local-control-token' \
  -H 'Content-Type: application/json' \
  -d '{"entity":"products","count":5}'

# Estado del modo de datos
curl -s http://localhost:4000/_control/mode

# Congelar: trabajar sobre una copia descartable
curl -s -X POST http://localhost:4000/_control/freeze \
  -H 'X-Control-Token: local-control-token'

# Restaurar la imagen congelada (o los datos semilla en persistente)
curl -s -X POST http://localhost:4000/_control/restore \
  -H 'X-Control-Token: local-control-token'

# Descartar la copia y volver a la base persistente
curl -s -X POST http://localhost:4000/_control/unfreeze \
  -H 'X-Control-Token: local-control-token'
```

Los endpoints destructivos exigen `X-Control-Token`. En modo persistente los cambios sobreviven a los reinicios; `/_control/restore` vuelve a los datos semilla. En modo congelado se trabaja sobre una copia: `/_control/reset` y `/_control/seed` afectan solo a la copia, y `/_control/unfreeze` descarta todo y recupera la base persistente intacta. Al reiniciar, el servidor siempre arranca en modo persistente. Contrato completo: [modos de datos](data-modes.md).

## 12. Pruebas

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run check
npm run build
```

Las 72 pruebas crean bases SQLite temporales y puertos aleatorios; no modifican tu base de desarrollo. `npm run check` ejecuta typecheck, lint con Biome, formato y pruebas.

## 13. Problemas comunes

| Problema | Solución |
|---|---|
| `EADDRINUSE` | Cambia `PORT`, `HTTPS_PORT`, `HTTP2_PORT` o `PROXY_PORT` |
| Error de certificado | Usa `curl -k` o confía en `certs/localhost-cert.pem` |
| `401 Unauthorized` | Añade `Authorization: Bearer ...` o `X-API-Key` |
| `403 Forbidden` | Usa un token con el permiso necesario; el viewer es de solo lectura |
| `415 Unsupported Media Type` | Envía `Content-Type: application/json` |
| `413 Payload Too Large` | Ajusta `MAX_BODY_BYTES` o reduce el cuerpo |
| `422 Validation Error` | Revisa `error.details` con los campos inválidos |
| No quiero datos anteriores | Detén el servidor y ejecuta un reset protegido |
| Proxy externo rechazado | Es intencional: solo se permiten destinos locales |
| Método personalizado sin cuerpo | Usa un método de extensión o HTTP/2 |

## 14. Interfaz web

Con el servidor en marcha, abre:

```text
http://localhost:4000/ui/
```

La interfaz es un micro frontend estático, sin framework ni build:

- **Resumen**: salud, uptime, registros y conteos por dominio.
- **Request Lab**: envía peticiones con método, ruta, headers, body y token; muestra estado, tiempo, tamaño, headers y cuerpo.
- **Catálogo API**: busca endpoints y cárgalos en el laboratorio.
- **Documentación**: enlaces a OpenAPI/Swagger y credenciales de simulación.
- **Preferencias**: español/inglés, tema claro/oscuro y API base configurable.

El botón **Usar token demo** carga `local-admin-token`. Para servir la UI por separado, usa cualquier servidor estático sobre `web/` y configura la Base URL de la API. Si no quieres servirla:

```bash
UI_ENABLED=false npm start
```

Detalles y personalización: [frontend.md](frontend.md) · [English](frontend.en.md).

## 15. Parada

```bash
Ctrl+C
```

El servidor cierra HTTP, HTTPS, HTTP/2, proxy y SQLite de forma ordenada.

## Documentación relacionada

- [README](../README.md) · [English README](../README.en.md)
- [Micro frontend](frontend.md) · [English](frontend.en.md)
- [Autorización y escenarios](auth-and-scenarios.md) · [English](auth-and-scenarios.en.md)
- [Modos de datos](data-modes.md) · [English](data-modes.en.md)
- [Laboratorio HTTP](http-lab.md) · [English](http-lab.en.md)
- [Matriz de capacidades](capabilities.md) · [English](capabilities.en.md)
- [OpenAPI](http://localhost:4000/openapi.json)
