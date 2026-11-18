# Global authorization and scenarios

Languages: [Español](auth-and-scenarios.md) | **English**

This document describes cross-cutting access policy, simulation users and groups, global error scenarios and the bilingual OpenAPI specification.

## Global policy

`AUTH_REQUIRED=true` is the default. Every route under `/api/v1` requires a valid Bearer token or API key, except for public authentication routes:

- `POST /api/v1/identity/auth/login`
- `POST /api/v1/identity/auth/refresh`
- `POST /api/v1/identity/auth/forgot-password`
- `POST /api/v1/identity/auth/reset-password`
- `GET /api/v1/identity/auth/verify`

Authenticated session routes (`logout`, `me`, `change-password`) require identity but no additional domain permission.

### Permissions by domain

| Prefix | Read (`GET`/`HEAD`) | Write (`POST`/`PUT`/`PATCH`/`DELETE`) |
|---|---|---|
| `/api/v1/identity` | `identity:read` | `identity:write` |
| `/api/v1/projects` | `projects:read` | `projects:write` |
| `/api/v1/shop` | `shop:read` | `shop:write` |
| `/api/v1/library` | `library:read` | `library:write` |
| `/api/v1/education` | `education:read` | `education:write` |
| `/api/v1/hr` | `hr:read` | `hr:write` |
| `/api/v1/finance` | `finance:read` | `finance:write` |

`/test`, `/ui`, `/docs`, `/openapi*.json`, `/health` and `/_control/stats|domains|config|mode` remain public. Destructive control operations (`reset`, `seed`, `freeze`, `restore`, `unfreeze`) require `X-Control-Token`.

```bash
# 401 without credentials
curl -i http://localhost:4000/api/v1/shop/products

# 200 with an administrator token
curl -i -H 'Authorization: Bearer local-admin-token' \
  http://localhost:4000/api/v1/shop/products?per_page=1
```

## Simulation users

In addition to the administrator and viewer, the seed includes accounts with scoped roles. All use `Password123!` except the administrator.

| Email | Direct role | Purpose |
|---|---|---|
| `admin@simulator.local` | admin | Full access (`Admin123!`) |
| `viewer@simulator.local` | viewer | Read-only (`Viewer123!`) |
| `developer@simulator.local` | developer | Projects and identity reads |
| `manager@simulator.local` | manager | Write access to several domains |
| `auditor@simulator.local` | auditor | Finance and HR reads |
| `support@simulator.local` | support | Identity and support |
| `viewer2@simulator.local` | viewer | Second read-only user |
| `groupviewer@simulator.local` | **none** | Permissions obtained exclusively from a group |

```bash
curl -s -X POST http://localhost:4000/api/v1/identity/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"groupviewer@simulator.local","password":"Password123!"}'
```

The seed creates 80 users and 12 groups. Groups can grant complete roles:

| Group | Granted role |
|---|---|
| Engineering | developer |
| Product design | viewer |
| Operations | manager |
| Customer support | support |
| Leadership | manager |
| Quality | auditor |
| Research | developer |
| Security | auditor |
| Observers | viewer (`groupviewer` belongs here) |
| Auditors | auditor |
| Support | support |
| Management | manager |

Effective permissions are the union of direct roles and group roles. Query them with:

```bash
curl -H 'Authorization: Bearer local-admin-token' \
  http://localhost:4000/api/v1/identity/users/8/permissions
```

### Manage group roles

```bash
# List
curl -H 'Authorization: Bearer local-admin-token' \
  http://localhost:4000/api/v1/identity/groups/9/roles

# Grant developer to group 9
curl -X POST http://localhost:4000/api/v1/identity/groups/9/roles \
  -H 'Authorization: Bearer local-admin-token' \
  -H 'Content-Type: application/json' \
  -d '{"role":"developer"}'

# Remove
curl -X DELETE http://localhost:4000/api/v1/identity/groups/9/roles/3 \
  -H 'Authorization: Bearer local-admin-token'
```

`groupviewer` gains `projects:write` when developer is granted and loses it when removed. Group changes apply on the next request without logging in again.

## Global 429/500/503 scenarios

The `X-Simulate-Error` header or `simulate_error` query parameter injects the scenario before the router, after authorization. It works across all domains:

```bash
for domain in identity projects shop library education hr finance; do
  curl -s -o /dev/null -w "$domain:%{http_code}\n" \
    -H 'Authorization: Bearer local-admin-token' \
    -H 'X-Simulate-Error: 500' \
    "http://localhost:4000/api/v1/$domain"
done
```

Supported codes: `429`, `500`, `503`. Anything else returns 422.

- `429`: `Retry-After: 1` and `SIMULATED_RATE_LIMIT`.
- `500`: `SIMULATED_INTERNAL_ERROR`.
- `503`: `Retry-After: 5` and `SERVICE_UNAVAILABLE`.

Injection can be disabled with `FAULT_INJECTION_ENABLED=false`; in that case the header returns `403 FAULT_INJECTION_DISABLED`.

### Configurable real rate limit

There is also a global in-memory rate limit:

```dotenv
API_RATE_LIMIT_MAX=60
API_RATE_LIMIT_WINDOW_MS=60000
```

- Applies to every `/api/v1` route.
- The key is the authenticated user or the IP.
- Responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`.
- Exceeding the limit returns `429 TOO_MANY_REQUESTS` with `Retry-After`.
- State is per process and resets on restart. `API_RATE_LIMIT_MAX=0` disables it.

## Bilingual OpenAPI

| Resource | Spanish | English |
|---|---|---|
| Specification | `GET /openapi.json` | `GET /openapi.en.json` |
| Alias | `GET /openapi.json` | `GET /openapi.json?lang=en` |
| Swagger UI | `/docs` | `/docs?lang=en` |
| Root metadata | `openapi` | `openapi_en`, `docs_en` |

The English specification translates summaries, descriptions, parameters, responses, tags, servers and examples. Technical path, operation and schema names do not change. Translation coverage is validated by tests.

## Technical decisions

- Global authorization runs **before** error injection and routing, so a 401/403 is not masked as a 500.
- `AUTH_REQUIRED=false` keeps internal identity guards and is useful for exercising business APIs without credentials.
- Group roles are resolved on every request (SQL query), allowing policy changes to be tested without reissuing tokens.
- The rate limiter and simulation counters live in memory: this is a test environment, not a distributed gateway.
- The English specification reuses the same route definitions; there are no duplicated contracts.

## Tests

- `tests/auth-policy.test.ts`: global 401/403, read-only permissions, groups and role changes.
- `tests/resilience.test.ts`: 429/500/503 across all seven domains, query/header, 422 and the real rate limit.
- `tests/openapi.test.ts`: path parity, English summaries/parameters/tags, translation coverage and bilingual `/docs`.
