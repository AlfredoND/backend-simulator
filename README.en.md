# Backend Simulator

**Backend Simulator is only a local HTTP API simulation server.** It is not an HTTP client, it does not implement any SDK, and it is not part of any external product. Its purpose is to provide realistic business APIs and a transport laboratory for testing any HTTP client.

Languages: [Español](README.md) | **English**

## What it includes

- Seven business HTTP APIs backed by SQLite: identity, projects, e-commerce, library, education, HR and finance.
- CRUD, pagination, filters, search, sorting, field selection and relationships.
- Global authentication with Bearer/API keys, direct roles, group roles and per-domain permissions.
- Cross-cutting 429/500/503 scenarios, configurable rate limiting and header/query error injection.
- Transactional operations: checkout, cancellation, returns, enrollment, vacations, invoicing and payments.
- A standalone HTTP laboratory at `/test` for transport testing: compression, streaming, redirects, cookies, caching, ranges, errors, timeouts, rate limiting and concurrency.
- A static micro frontend at `/ui/` with an overview, Request Lab, endpoint catalog, theme and language switcher. No framework and no build.
- HTTP/1.1, local HTTPS, HTTP/2 over TLS and an optional local HTTP proxy.
- Deterministic, persistent seed data with protected control endpoints.
- Fully bilingual OpenAPI and bilingual documentation.

## Quick start

Requirements: Node.js 24 or later and OpenSSL (for the local certificate).

```bash
npm install
npm start
```

Default services:

| Service | URL |
|---|---|
| HTTP/1.1 | `http://127.0.0.1:4000` |
| Web interface | `http://127.0.0.1:4000/ui/` |
| Interactive documentation | `http://127.0.0.1:4000/docs` |
| English documentation | `http://127.0.0.1:4000/docs?lang=en` |
| Spanish OpenAPI | `http://127.0.0.1:4000/openapi.json` |
| English OpenAPI | `http://127.0.0.1:4000/openapi.en.json` |
| HTTP laboratory | `http://127.0.0.1:4000/test` |
| HTTPS | `https://localhost:4443` |
| HTTP/2 (TLS) | `https://localhost:4444` |
| Local proxy (optional) | `http://127.0.0.1:8080` |
| Control | `http://127.0.0.1:4000/_control/stats` |

The local certificate is generated in `./certs/` when missing. You can also run `npm run certs`.

Commands:

```bash
npm run dev        # automatic reload
npm run build      # compile to dist/
npm run start:dist
npm run typecheck
npm test           # integration tests with temporary SQLite
```

## Web interface

The micro frontend lives in `web/` and is served at `/ui/`:

- Health, uptime, record and domain overview.
- Request Lab with method, path, headers, body, token, abort and full response display.
- Endpoint catalog that loads samples into the laboratory.
- Spanish/English language and light/dark theme switching.
- Configurable base URL, even when the UI is served separately.

It is vanilla JavaScript with ES modules: no framework, no UI dependencies and no build. Management and customization: [docs/frontend.en.md](docs/frontend.en.md) · [Español](docs/frontend.md).

## Documentation

| Document | Spanish | English |
|---|---|---|
| Step-by-step guide | [docs/user-guide.md](docs/user-guide.md) | [docs/user-guide.en.md](docs/user-guide.en.md) |
| Micro frontend | [docs/frontend.md](docs/frontend.md) | [docs/frontend.en.md](docs/frontend.en.md) |
| Authorization and scenarios | [docs/auth-and-scenarios.md](docs/auth-and-scenarios.md) | [docs/auth-and-scenarios.en.md](docs/auth-and-scenarios.en.md) |
| HTTP laboratory | [docs/http-lab.md](docs/http-lab.md) | [docs/http-lab.en.md](docs/http-lab.en.md) |
| Capability matrix | [docs/capabilities.md](docs/capabilities.md) | [docs/capabilities.en.md](docs/capabilities.en.md) |
| Delivery plan | [PLAN.md](PLAN.md) | [PLAN.en.md](PLAN.en.md) |
| API specification | `GET /openapi.json` | `GET /openapi.en.json` |

## Simulation credentials

| Purpose | Value |
|---|---|
| Administrator | `admin@simulator.local` / `Admin123!` |
| Viewer | `viewer@simulator.local` / `Viewer123!` |
| Other users | `Password123!` |
| Admin Bearer token | `local-admin-token` |
| Viewer Bearer token | `local-viewer-token` |
| Admin API key | `local-test-api-key` (header `X-API-Key`) |
| Control token | `local-control-token` (header `X-Control-Token`) |
| Laboratory Basic Auth | `testuser` / `testpass` |
| Laboratory Bearer | `local-admin-token` |

All values can be configured through environment variables. They are simulation credentials, not real secrets.

Additional scoped accounts (password `Password123!`):

- `developer@simulator.local`: projects and identity reads.
- `manager@simulator.local`: write access to several domains.
- `auditor@simulator.local`: finance and HR reads.
- `support@simulator.local`: identity and support.
- `viewer2@simulator.local`: read-only.
- `groupviewer@simulator.local`: no direct role; obtains permissions from the **Observers** group.

The seed creates 80 users and 12 groups; groups can grant complete roles. Details: [docs/auth-and-scenarios.en.md](docs/auth-and-scenarios.en.md).

## Business APIs

Common prefix: `/api/v1`.

| Domain | Prefix | Main content |
|---|---|---|
| Identity | `/api/v1/identity` | auth, users, profiles, roles, permissions, groups, sessions, tokens, API keys, addresses, preferences |
| Projects | `/api/v1/projects` | teams, projects, members, tasks, subtasks, comments, labels, attachments, activity |
| E-commerce | `/api/v1/shop` | customers, catalog, variants, stock, carts, checkout, orders, payments, refunds, shipping, coupons, reviews |
| Library | `/api/v1/library` | authors, publishers, genres, books, copies, readers, loans, reservations, fines |
| Education | `/api/v1/education` | students, teachers, courses, subjects, sections, enrollments, grades, attendance, materials |
| HR | `/api/v1/hr` | employees, departments, positions, contracts, salaries, vacations, attendance |
| Finance | `/api/v1/finance` | accounts, transactions, invoices, suppliers, expenses, budgets, payments, reports |

### Conventions

Resource response:

```json
{ "data": { "id": 1 } }
```

Paginated list:

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

Structured error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid data",
    "details": [{ "field": "email", "message": "invalid email" }],
    "request_id": "f8b4…"
  }
}
```

Regular resources support:

- `page`, `per_page` (maximum 100), `limit` and `offset`.
- `sort=field`, `sort=-field` and `order=asc|desc`.
- `fields=id,name,price_cents` to select columns.
- `q=text` on searchable resources.
- Exact filters such as `?status=active`; repeated parameters produce `IN`.
- `_gte`, `_lte`, `_gt`, `_lt` and `_like` ranges when the type allows it.
- `ETag` on reads; `If-None-Match` returns `304`; `If-Match` returns `412` when the version does not match.

Methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` and `OPTIONS`. `OPTIONS` includes `Allow`; `HEAD` keeps headers and removes the body; disallowed methods return `405`.

### Authentication

`AUTH_REQUIRED=true` is the default: every `/api/v1` route requires `Authorization: Bearer` or `X-API-Key`, except login, refresh, forgot/reset password and verify.

- Domain reads require `<domain>:read`; writes require `<domain>:write`.
- Effective permissions are the union of direct roles and group roles.
- `groupviewer@simulator.local` has no direct role: it receives `viewer` from the **Observers** group.
- Login, refresh, recovery and verification are public; logout, me and password change require identity.
- Group roles are managed with `GET/POST/DELETE /api/v1/identity/groups/:id/roles`.
- Global scenarios: `X-Simulate-Error: 429|500|503` or `?simulate_error=...`, plus rate limiting with `API_RATE_LIMIT_MAX`/`API_RATE_LIMIT_WINDOW_MS`.

```bash
curl -s http://localhost:4000/health

TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/identity/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@simulator.local","password":"Admin123!"}' |
  node -pe 'JSON.parse(fs.readFileSync(0)).data.access_token')

curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:4000/api/v1/shop/products?per_page=1'

curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/v1/identity/auth/me

curl -s -H 'X-API-Key: local-test-api-key' \
  'http://localhost:4000/api/v1/identity/users?per_page=3'
```

## HTTP laboratory

Prefix `/test`, independent of SQLite. It can test:

- Echo of method, URL, repeated query parameters, raw headers, cookies and body.
- Standard, extension and custom methods.
- HTTP status codes, empty bodies, invalid JSON, binary, HTML, XML and CSV.
- gzip, deflate and Brotli compression.
- 301/302/303/307/308 redirects, chains, loops and missing targets.
- Basic, Bearer, API key and expired tokens.
- Cookies, ETag/Last-Modified/304, streaming, SSE, trailers and range downloads.
- Delays, timeouts, connection resets, incomplete responses, errors, 429 and rate limiting.
- Concurrency, a counter and idempotency.
- Malformed HTTP responses at the socket level.

Full guide: [docs/http-lab.en.md](docs/http-lab.en.md) · [Español](docs/http-lab.md).

```bash
curl -i http://localhost:4000/test/status/418
curl -i --compressed 'http://localhost:4000/test/compress?algo=gzip&body=hello'
curl -i 'http://localhost:4000/test/download?size=1048576' -H 'Range: bytes=0-1023'
curl -i 'http://localhost:4000/test/redirect/307?to=/test/echo'
curl -i 'http://localhost:4000/test/cache/etag?version=2'
curl -s -X POST 'http://localhost:4000/test/idempotency' -H 'Idempotency-Key: demo'
```

## Transport protocols

| Capability | Status |
|---|---|
| HTTP/1.1 | Yes |
| HTTPS with local self-signed certificate | Yes (`HTTPS_PORT`) |
| HTTP/2 over TLS | Yes (`HTTP2_PORT`, ALPN `h2`) |
| HTTP/2 with HTTP/1.1 fallback | Yes (`allowHTTP1`) |
| Local HTTP proxy (absolute URL and CONNECT) | Yes, optional and local targets only |
| SSE | Yes, `/test/stream/sse` |
| WebSocket | Not implemented |

## Persistence and data

- SQLite at `DB_PATH` (default `./data/backend-simulator.sqlite`), WAL enabled and foreign keys active.
- Seed data is loaded only when the database is empty. **It is not deleted on startup.**
- Explicit IDs and deterministic data; Unicode, NULLs, varied dates, cent-based money and varied states.
- `SEED_SCALE` (0.1–10) multiplies main volumes.
- Statistics: `GET /_control/stats` and `GET /_control/domains`.
- Protected reset with `X-Control-Token`:

```bash
curl -X POST http://localhost:4000/_control/reset/shop \
  -H 'X-Control-Token: local-control-token'

curl -X POST http://localhost:4000/_control/reset \
  -H 'X-Control-Token: local-control-token'
```

- Extra data: `POST /_control/seed` with `{"entity":"users|tasks|products|books|students|employees|transactions","count":N}` and `X-Control-Token`.
- Resetting identity or HR may leave optional `NULL` references in other domains. Shop, library, education and projects can be reset independently.

## Configuration

Copy `.env.example`. Environment variables take precedence; `.env` is loaded when present.

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Listen interface |
| `PORT` | `4000` | HTTP port (`0` = random) |
| `HTTPS_ENABLED` | `true` | Enable HTTPS |
| `HTTPS_PORT` | `4443` | HTTPS port |
| `HTTP2_ENABLED` | `true` | Enable HTTP/2 TLS |
| `HTTP2_PORT` | `4444` | HTTP/2 port |
| `PROXY_ENABLED` | `false` | Enable local proxy |
| `PROXY_PORT` | `8080` | Proxy port |
| `UI_ENABLED` | `true` | Serve the micro frontend at `/ui/` |
| `UI_DIR` | `./web` | UI asset directory |
| `AUTH_REQUIRED` | `true` | Require authentication and permissions on `/api/v1` |
| `API_RATE_LIMIT_MAX` | `0` | Global maximum per window; `0` disables it |
| `API_RATE_LIMIT_WINDOW_MS` | `60000` | Global rate-limit window |
| `FAULT_INJECTION_ENABLED` | `true` | Allow `X-Simulate-Error` |
| `DB_PATH` | `./data/backend-simulator.sqlite` | SQLite path |
| `SEED_SCALE` | `1` | Data scale (0.1–10) |
| `MAX_BODY_BYTES` | `10485760` | Request body limit |
| `MAX_RESPONSE_BYTES` | `20971520` | Generated response limit |
| `MAX_PAGE_SIZE` | `100` | Maximum page size |
| `MAX_DELAY_MS` | `60000` | Laboratory maximum delay |
| `REQUEST_TIMEOUT_MS` | `30000` | Request receive timeout |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | seed | Administrator credentials |
| `SEED_PASSWORD` | `Password123!` | Seed user password |
| `ADMIN_TOKEN` / `VIEWER_TOKEN` | seed | Bearer tokens |
| `TEST_API_KEY` | `local-test-api-key` | Seed and laboratory API key |
| `CONTROL_TOKEN` | `local-control-token` | Reset and seed protection |
| `BASIC_USER` / `BASIC_PASSWORD` | `testuser` / `testpass` | Laboratory Basic Auth |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | `./certs/...` | Certificate and key |
| `TLS_AUTO_GENERATE` | `true` | Generate certificate when missing |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |

## Structure

```text
src/
  app.ts, index.ts       HTTP/HTTPS/HTTP2/proxy composition and startup
  core/                  configuration, errors, logger and validation
  db/                    schema.sql, persistence, seed and domain map
  http/                  router, HTTP context, auth, filters, CRUD and OpenAPI
  domains/               business APIs
  lab/                   HTTP laboratory
  control/               statistics, reset and extra data
  transport/             TLS certificates and local proxy
web/                     static micro frontend (HTML/CSS/JS, no build)
tests/                   integration and frontend tests
docs/                    guide, frontend, laboratory, capabilities and Spanish versions
```

## Tests

```bash
npm test
npm run typecheck
```

The 65 tests use temporary SQLite databases and random ports; they do not touch the development database. They cover relational constraints, transactions, global authorization and groups, 429/500/503 scenarios, validation, ETag/412, bilingual OpenAPI, business operations, the HTTP laboratory, compression, ranges, streaming, HTTPS, HTTP/2, the proxy, the static server and bilingual documentation. Code under `src/` and `web/` includes JSDoc for contracts and decisions. CI: `.github/workflows/ci.yml`.

## Limits and security

This server is local-only:

- Simulation credentials and certificates; do not use in production.
- The proxy only accepts local targets.
- Laboratory redirects only allow local paths.
- Generated bodies and responses are limited by configuration.
- The UI keeps its token in `sessionStorage` and loads no third-party assets.
- `AUTH_REQUIRED=true` applies per-domain permissions; public endpoints are limited to authentication and metadata.
- Destructive operations require `X-Control-Token`.
- Queries use bound parameters and column/table allowlists.
- Received code is never executed and user paths never access arbitrary files.
