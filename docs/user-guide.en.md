# Backend Simulator usage guide

This guide explains how to start and use **Backend Simulator**, a local HTTP API simulation server. It is not an HTTP client or an SDK: it only provides business APIs and transport scenarios so any client can be tested against it.

Languages: [Español](user-guide.md) | **English**

## 1. Requirements

- Node.js 24 or later.
- npm.
- OpenSSL (only for generating the local HTTPS certificate).
- `curl` or any HTTP client for the examples.

No external database is required: the project uses embedded SQLite.

## 2. Installation

```bash
npm install
npm start
```

The first start creates `./data/backend-simulator.sqlite`, generates seed data and creates a certificate in `./certs/` if missing.

For development with automatic reload:

```bash
npm run dev
```

To compile and run the built version:

```bash
npm run build
npm run start:dist
```

## 3. Initial check

```bash
curl -s http://localhost:4000/health
curl -s http://localhost:4000/
curl -s http://localhost:4000/openapi.json | head -c 300
```

Open `http://localhost:4000/docs` for the interactive OpenAPI UI.

If port 4000 is busy, change it:

```bash
PORT=4100 npm start
```

## 4. Minimal configuration

Copy `.env.example` to `.env` and adjust what you need:

```bash
cp .env.example .env
```

Common variables:

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

Environment variables take precedence over `.env`. See the full table in the [README](../README.en.md#configuration).

## 5. Authentication

The identity domain uses Bearer tokens and API keys. Simulation tokens are ready to use:

```bash
# Administrator token
curl -s -H 'Authorization: Bearer local-admin-token' \
  http://localhost:4000/api/v1/identity/users?per_page=3

# API key
curl -s -H 'X-API-Key: local-test-api-key' \
  http://localhost:4000/api/v1/identity/users?per_page=3

# Viewer: can read, cannot write
curl -s -H 'Authorization: Bearer local-viewer-token' \
  http://localhost:4000/api/v1/identity/users?per_page=3
```

Real login with session and refresh token:

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

Seed credentials:

- `admin@simulator.local` / `Admin123!`
- `viewer@simulator.local` / `Viewer123!`
- Other users: `Password123!`

## 6. Queries and pagination

General pattern:

```bash
curl -s 'http://localhost:4000/api/v1/shop/products?per_page=5&sort=-price_cents&fields=id,name,price_cents&status=active'
```

Useful parameters:

- `page`, `per_page`, `limit`, `offset`.
- `sort=name` or `sort=-name`; `order=asc|desc`.
- `fields=id,name,price_cents`.
- `q=text` where search is available.
- Exact filters: `status=active`, `category_id=2`.
- Ranges: `price_cents_gte=1000`, `price_cents_lte=100000`, `created_at_gte=2026-01-01`.
- Partial text: `name_like=laptop`.
- Repeated parameters become `IN`.

## 7. Domain examples

### Projects: create a task and change its status

```bash
TASK=$(curl -s -X POST http://localhost:4000/api/v1/projects/projects/1/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Prepare demo","priority":"high","estimate_minutes":60}')

TASK_ID=$(printf '%s' "$TASK" | node -pe 'JSON.parse(fs.readFileSync(0)).data.id')

curl -s -X PATCH "http://localhost:4000/api/v1/projects/tasks/$TASK_ID/status" \
  -H 'Content-Type: application/json' \
  -d '{"status":"done"}'

curl -s http://localhost:4000/api/v1/projects/projects/1/stats
```

### E-commerce: cart and checkout

```bash
CUSTOMER_ID=1
VARIANT_ID=$(curl -s 'http://localhost:4000/api/v1/shop/inventory?per_page=100' |
  node -pe "const d=JSON.parse(fs.readFileSync(0)).data; (d.find(r => r.quantity - r.reserved > 2) || {}).variant_id")

CART=$(curl -s -X POST http://localhost:4000/api/v1/shop/carts \
  -H 'Content-Type: application/json' \
  -d "{\"customer_id\":$CUSTOMER_ID}")
CART_ID=$(printf '%s' "$CART" | node -pe 'JSON.parse(fs.readFileSync(0)).data.id')

curl -s -X POST "http://localhost:4000/api/v1/shop/carts/$CART_ID/items" \
  -H 'Content-Type: application/json' \
  -d "{\"variant_id\":$VARIANT_ID,\"quantity\":1}"

curl -s -X POST "http://localhost:4000/api/v1/shop/carts/$CART_ID/checkout" \
  -H 'Content-Type: application/json' \
  -d '{"shipping_address_id":1,"payment_method_id":1,"coupon_code":"SAVE10"}'
```

Check stock first:

```bash
curl -s http://localhost:4000/api/v1/shop/products/1/details
curl -s http://localhost:4000/api/v1/shop/inventory/low-stock?threshold=5
```

### Library: loan and return

```bash
LOAN=$(curl -s -X POST http://localhost:4000/api/v1/library/loans \
  -H 'Content-Type: application/json' \
  -d '{"book_id":1,"reader_id":1,"days":14}')
LOAN_ID=$(printf '%s' "$LOAN" | node -pe 'JSON.parse(fs.readFileSync(0)).data.id')

curl -s -X POST "http://localhost:4000/api/v1/library/loans/$LOAN_ID/return"
curl -s http://localhost:4000/api/v1/library/books/1/availability
```

### Education: enrollment, attendance and transcript

```bash
STUDENT=$(curl -s -X POST http://localhost:4000/api/v1/education/students \
  -H 'Content-Type: application/json' \
  -d '{"student_code":"GUIDE-001","full_name":"Guide Student","email":"guide.student@education.test","enrolled_at":"2026-09-01"}')
STUDENT_ID=$(printf '%s' "$STUDENT" | node -pe 'JSON.parse(fs.readFileSync(0)).data.id')

curl -s -X POST http://localhost:4000/api/v1/education/sections/1/enroll \
  -H 'Content-Type: application/json' \
  -d "{\"student_id\":$STUDENT_ID}"

curl -s -X POST http://localhost:4000/api/v1/education/attendance/bulk \
  -H 'Content-Type: application/json' \
  -d "{\"records\":[{\"student_id\":$STUDENT_ID,\"section_id\":1,\"attendance_date\":\"2026-11-10\",\"status\":\"present\"}]}"

curl -s "http://localhost:4000/api/v1/education/students/$STUDENT_ID/transcript"
```

### HR: vacations

```bash
VACATION=$(curl -s -X POST http://localhost:4000/api/v1/hr/vacations/request \
  -H 'Content-Type: application/json' \
  -d '{"employee_id":1,"start_date":"2027-03-01","end_date":"2027-03-03","days":3,"reason":"Guide"}')
VACATION_ID=$(printf '%s' "$VACATION" | node -pe 'JSON.parse(fs.readFileSync(0)).data.id')

curl -s -X PATCH "http://localhost:4000/api/v1/hr/vacations/$VACATION_ID/decision" \
  -H 'Content-Type: application/json' \
  -d '{"status":"approved"}'

curl -s 'http://localhost:4000/api/v1/hr/vacations/balance/1?year=2027'
curl -s http://localhost:4000/api/v1/hr/reports/payroll
```

### Finance: invoice and payment

```bash
INVOICE=$(curl -s -X POST http://localhost:4000/api/v1/finance/invoices \
  -H 'Content-Type: application/json' \
  -d '{"customer_name":"Guide Customer","items":[{"description":"Service","quantity":2,"unit_price_cents":5000}]}')
INVOICE_ID=$(printf '%s' "$INVOICE" | node -pe 'JSON.parse(fs.readFileSync(0)).data.id')

curl -s -X POST "http://localhost:4000/api/v1/finance/invoices/$INVOICE_ID/pay" \
  -H 'Content-Type: application/json' \
  -d '{"account_id":2,"method":"transfer","reference":"GUIDE-PAY-1"}'

curl -s http://localhost:4000/api/v1/finance/reports/balance
curl -s 'http://localhost:4000/api/v1/finance/reports/expenses?group_by=category'
```

## 8. ETag, caching and optimistic concurrency

```bash
PRODUCT=$(curl -s -D /tmp/product.headers http://localhost:4000/api/v1/shop/products/1)
ETAG=$(awk 'BEGIN{IGNORECASE=1} /^etag:/ {gsub("\r",""); print $2}' /tmp/product.headers)

# 304 if unchanged
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "If-None-Match: $ETAG" \
  http://localhost:4000/api/v1/shop/products/1

# 412 if the version does not match
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "wrong"' \
  -d '{"description":"change"}' \
  http://localhost:4000/api/v1/shop/products/1
```

## 9. HTTP laboratory

The `/test` prefix does not use SQLite and is intended for transport testing.

```bash
# Full echo
curl -s -X PATCH 'http://localhost:4000/test/echo?x=1&x=2' \
  -H 'X-Custom: demo' -H 'Content-Type: application/json' \
  -d '{"hello":"world"}'

# Status code
curl -i http://localhost:4000/test/status/418

# Compression
curl -i --compressed 'http://localhost:4000/test/compress?algo=gzip&body=hello'

# Redirects
curl -i 'http://localhost:4000/test/redirect/307?to=/test/echo'
curl -i 'http://localhost:4000/test/redirect/chain/3'
curl -i 'http://localhost:4000/test/redirect/loop'

# Authentication
curl -i -u testuser:testpass http://localhost:4000/test/auth/basic
curl -i -H 'Authorization: Bearer local-admin-token' http://localhost:4000/test/auth/bearer
curl -i -H 'X-API-Key: local-test-api-key' http://localhost:4000/test/auth/api-key

# Cookies
curl -i 'http://localhost:4000/test/cookies/set?name=session&value=abc&httpOnly=1'
curl -s -H 'Cookie: a=1; b=2' http://localhost:4000/test/cookies/echo

# Caching
curl -i http://localhost:4000/test/cache/etag?version=1
curl -i -H 'If-None-Match: "sim-etag-v1"' http://localhost:4000/test/cache/etag?version=1

# Ranges
curl -i 'http://localhost:4000/test/download?size=100000' -H 'Range: bytes=0-1023'

# Streaming
curl -N 'http://localhost:4000/test/stream/text?chunks=5&delay=200&size=32'
curl -N 'http://localhost:4000/test/stream/sse?count=3&delay=200'

# Delay, timeout and errors
curl -i 'http://localhost:4000/test/delay/500'
curl -i 'http://localhost:4000/test/timeout?ms=5000'
curl -i http://localhost:4000/test/error/503
curl -i http://localhost:4000/test/error/429

# Rate limit
curl -i 'http://localhost:4000/test/rate-limit?limit=2&key=demo'

# Idempotency
curl -i -X POST http://localhost:4000/test/idempotency -H 'Idempotency-Key: demo'
```

Custom methods: use an extension method, for example:

```bash
curl -i -X PROPFIND http://localhost:4000/test/echo
```

The complete reference is in [http-lab.en.md](http-lab.en.md) and [http-lab.md](http-lab.md).

## 10. HTTPS, HTTP/2 and proxy

```bash
# HTTPS with the local certificate
curl -k https://localhost:4443/health

# HTTP/2 over TLS
curl -k --http2 https://localhost:4444/test/echo

# Stop the current server and start it with the proxy enabled
PROXY_ENABLED=true npm start
curl -x http://127.0.0.1:8080 http://127.0.0.1:4000/test/echo
```

The proxy only allows local targets. To trust the certificate, add `certs/localhost-cert.pem` to your trust store or use `-k` for local tests.

## 11. Data control

```bash
# Statistics
curl -s http://localhost:4000/_control/stats
curl -s http://localhost:4000/_control/domains

# Reset one domain
curl -s -X POST http://localhost:4000/_control/reset/shop \
  -H 'X-Control-Token: local-control-token'

# Full reset
curl -s -X POST http://localhost:4000/_control/reset \
  -H 'X-Control-Token: local-control-token'

# Extra data
curl -s -X POST http://localhost:4000/_control/seed \
  -H 'X-Control-Token: local-control-token' \
  -H 'Content-Type: application/json' \
  -d '{"entity":"products","count":5}'
```

Destructive endpoints require `X-Control-Token`. Data persists across normal restarts. To start from scratch, delete the database while the server is stopped or use `/_control/reset`.

## 12. Tests

```bash
npm test
npm run typecheck
npm run build
```

Tests create temporary SQLite databases and random ports; they do not modify your development database.

## 13. Common issues

| Problem | Solution |
|---|---|
| `EADDRINUSE` | Change `PORT`, `HTTPS_PORT`, `HTTP2_PORT` or `PROXY_PORT` |
| Certificate error | Use `curl -k` or trust `certs/localhost-cert.pem` |
| `401 Unauthorized` | Add `Authorization: Bearer ...` or `X-API-Key` |
| `403 Forbidden` | Use a token with the required permission; viewer is read-only |
| `415 Unsupported Media Type` | Send `Content-Type: application/json` |
| `413 Payload Too Large` | Raise `MAX_BODY_BYTES` or reduce the body |
| `422 Validation Error` | Check `error.details` for invalid fields |
| Old data is not wanted | Stop the server and use a protected reset |
| External proxy target rejected | Intentional: only local targets are allowed |
| Custom method without body | Use an extension method or HTTP/2 |

## 14. Shutdown

```bash
Ctrl+C
```

The server closes HTTP, HTTPS, HTTP/2, proxy and SQLite cleanly.

## Related documentation

- [README (English)](../README.en.md) · [Español](../README.md)
- [HTTP laboratory](http-lab.en.md) · [Español](http-lab.md)
- [Capability matrix](capabilities.en.md) · [Español](capabilities.md)
- [OpenAPI](http://localhost:4000/openapi.json)
