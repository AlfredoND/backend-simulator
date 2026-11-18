# Capability matrix

Languages: [Español](capabilities.md) | **English**

Actual backend status, not a wish list. Each row states where it is tested and any explicit limitation.

Legend: **Yes** = real scenario implemented and covered by tests; **Partial** = implemented with an explicit limitation; **No** = not implemented.

## Minimum coverage criteria

| Capability | Status | Evidence / endpoint | Test |
|---|---|---|---|
| Standard HTTP methods | Yes | APIs + `/test/echo`, `/test/methods` | `tests/lab.test.ts`, `tests/api.test.ts` |
| HEAD and OPTIONS | Yes | Router, `Allow`, no body on HEAD | `tests/api.test.ts`, `tests/lab.test.ts` |
| Extension methods (`PROPFIND`, `PURGE`, …) | Yes | Node HTTP parser | — |
| Arbitrary custom methods | Partial | `/test/echo`: captured without body; HTTP/2 accepts full requests | `tests/lab.test.ts` |
| URL and query parameters | Yes | `/test/echo` with repeats | `tests/lab.test.ts` |
| Request/response headers | Yes | `/test/headers/*`, `/test/echo` | `tests/lab.test.ts` |
| Repeated headers | Yes | `/test/headers/repeated` | — |
| Large headers | Yes | `/test/headers/large` (up to 16 KiB) | — |
| JSON bodies | Yes | APIs, `/test/body/echo` | `tests/api.test.ts`, `tests/lab.test.ts` |
| Text/HTML/XML/CSV bodies | Yes | `/test/body/echo`, `/test/response/*` | `tests/lab.test.ts` |
| URL-encoded and multipart bodies | Yes | `/test/body/echo` reflects them; files are not persisted | — |
| Binary bodies | Yes | Base64 echo, `/test/response/binary`, downloads | `tests/lab.test.ts` |
| Correct/incorrect Content-Type | Yes | APIs return 415, `/test/body/wrong-content-type` | `tests/api.test.ts`, `tests/lab.test.ts` |
| Invalid JSON | Yes | APIs return 400, `/test/body/invalid-json` | `tests/api.test.ts`, `tests/lab.test.ts` |
| Basic authentication | Yes | `/test/auth/basic` | `tests/lab.test.ts` |
| Bearer token | Yes | APIs + `/test/auth/bearer` | `tests/api.test.ts`, `tests/lab.test.ts` |
| API key | Yes | `X-API-Key` in APIs and laboratory | `tests/api.test.ts`, `tests/lab.test.ts` |
| Missing/wrong/expired credentials | Yes | `/test/auth/*`, identity | `tests/lab.test.ts`, `tests/api.test.ts` |
| Wrong authentication scheme | Yes | `/test/auth/scheme` | — |
| 301/302/303/307/308 redirects | Yes | `/test/redirect/{code}` | `tests/lab.test.ts` |
| Relative/absolute redirects | Yes | `absolute=1` | `tests/lab.test.ts` |
| Chain, loop and missing destination | Yes | `/test/redirect/chain`, `/loop`, `/missing` | `tests/lab.test.ts` |
| Timeout | Yes (client) | `/test/timeout`; the client aborts | `tests/lab.test.ts` |
| Request abort | Yes | `AbortSignal.timeout` in tests | `tests/lab.test.ts` |
| Connection reset | Yes | `/test/close` | `tests/lab.test.ts` |
| Interrupted response | Yes | `/test/stream/interrupted` | `tests/lab.test.ts` |
| Incomplete response | Yes | `/test/stream/incomplete` | `tests/lab.test.ts` |
| 4xx/5xx HTTP errors | Yes | APIs, `/test/error/{code}` | `tests/api.test.ts`, `tests/lab.test.ts` |
| Connection errors | Yes | `/test/close`, `/test/raw/malformed` | `tests/lab.test.ts` |
| Cookies and sessions | Yes | `/test/cookies/*`, identity sessions | `tests/lab.test.ts`, `tests/api.test.ts` |
| gzip/deflate/Brotli compression | Yes | `/test/compress`, negotiation | `tests/lab.test.ts` |
| Text/binary streaming | Yes | `/test/stream/text`, `/binary` | `tests/lab.test.ts` |
| SSE | Yes | `/test/stream/sse` | `tests/lab.test.ts` |
| WebSocket | No | Not implemented | — |
| Large downloads | Yes | `/test/download` (up to configured limit) | `tests/lab.test.ts` |
| Uploads | Partial | Multipart/binary echo; no file storage | — |
| Ranges and Content-Range | Yes | `/test/download` + `Range`; 206/416 | `tests/lab.test.ts` |
| Trailers | Partial | HTTP/1.1; HTTP/2 not specifically verified | `tests/lab.test.ts` |
| ETag / If-None-Match / 304 | Yes | Laboratory and business resources | `tests/lab.test.ts`, `tests/api.test.ts` |
| Last-Modified / If-Modified-Since | Yes | `/test/cache/last-modified` | `tests/lab.test.ts` |
| Cache-Control | Yes | `/test/cache/control`, resources | `tests/lab.test.ts` |
| If-Match / 412 | Yes | Business resources | `tests/api.test.ts` |
| Page/offset pagination | Yes | `page`, `per_page`, `offset` | `tests/api.test.ts` |
| Sorting and field selection | Yes | `sort`, `order`, `fields` | `tests/api.test.ts` |
| Combined filters and search | Yes | Typed filters, ranges, `q` | `tests/api.test.ts` |
| Empty responses | Yes | `/test/response/empty`, `/no-content`, 204 | `tests/lab.test.ts` |
| Large responses | Yes | `/test/response/large`, `/test/download` | `tests/lab.test.ts` |
| Concurrency | Yes | `/test/concurrency`, `/test/counter`; SQLite writes are serialized | `tests/lab.test.ts` |
| Idempotency | Yes | `/test/idempotency` | `tests/lab.test.ts` |
| Rate limiting + Retry-After | Yes | `/test/rate-limit`, `/test/error/429` | `tests/lab.test.ts` |
| HTTPS | Yes | `HTTPS_PORT`, local certificate | `tests/protocols.test.ts` |
| Local certificates | Yes | Auto-generated with OpenSSL; SAN localhost/127.0.0.1 | `tests/protocols.test.ts` |
| HTTP/2 | Yes | Dedicated TLS server, ALPN h2 | `tests/protocols.test.ts` |
| HTTP proxy | Yes (local) | `PROXY_ENABLED`; absolute requests and CONNECT; local targets | `tests/protocols.test.ts` |
| Static micro frontend | Yes | `/ui/`; overview, Request Lab, catalog, i18n and theme | `tests/ui.test.ts`, `tests/frontend.test.mjs` |
| Global per-domain authorization | Yes | `AUTH_REQUIRED=true`; `<domain>:read/write` | `tests/auth-policy.test.ts` |
| Group roles | Yes | `id_group_roles`, `/groups/:id/roles` | `tests/auth-policy.test.ts` |
| 429/500/503 scenarios on every API | Yes | `X-Simulate-Error`, `simulate_error`, global rate limit | `tests/resilience.test.ts` |
| Bilingual OpenAPI | Yes | `/openapi.json`, `/openapi.en.json`, `/docs?lang=en` | `tests/openapi.test.ts` |
| Persistent/frozen data mode | Yes | `/_control/freeze`, `/_control/restore`, `/_control/unfreeze`, `/_control/mode` | `tests/data-mode.test.ts` |
| Biome quality | Yes | `biome.json`, `.editorconfig`, `npm run check` | `npm run lint`, `npm run format:check` |
| Contract and architecture JSDoc | Yes | `src/` and `web/` | `npm run typecheck` |
| HTTP/3 / QUIC | No | Out of scope | — |
| Custom DNS | No | Out of scope | — |
| Malformed HTTP responses | Yes (HTTP/1.1) | `/test/raw/*` | `tests/lab.test.ts` |

## Business scenarios

| Scenario | Status | Evidence |
|---|---|---|
| 401 authentication | Yes | Any `/api/v1` without a token when `AUTH_REQUIRED=true` |
| 403 permissions | Yes | Business POST with the viewer token or a read-only group |
| 404 resource | Yes | Any missing resource |
| 409 conflict | Yes | Duplicate emails, checkout without stock, duplicate reservations |
| 412 precondition | Yes | Stale `If-Match` on resources |
| 413 payload | Yes | `MAX_BODY_BYTES` |
| 415 Content-Type | Yes | JSON bodies with a wrong type |
| 422 validation | Yes | Unknown fields, types and limits |
| 429 limit | Yes | `X-Simulate-Error: 429` or `API_RATE_LIMIT_MAX` on any `/api/v1` |
| Controlled 500/503 | Yes | `/test/error/*` and `X-Simulate-Error` on any `/api/v1` |
| Transactional rollback | Yes | Checkout, cancellation, return, payments, invoices |
| NULL data | Yes | Profiles, dates, optional references |
| Unicode and long text | Yes | Names, descriptions, bios |
| 1:1, 1:N, M:N relationships | Yes | Profiles, stats, book authors, role permissions, labels |
| Aggregations and JOINs | Yes | Project/shop/course/finance stats |
| Per-domain / full reset | Yes | `/_control/reset/:domain`, `/_control/reset` |
| Frozen / seed restore | Yes | `/_control/restore`; `/_control/unfreeze` |
| Extra data | Yes | `/_control/seed` (`users`, `tasks`, `products`, `books`, `students`, `employees`, `transactions`) |

## Verification

```text
npm test           74 tests, 74 pass
npm run typecheck  no errors
npm run lint       no errors
npm run format:check  no changes
npm run build      compiles and copies schema.sql
npm audit          0 vulnerabilities
```

Last verified run: 2026-11-18.
