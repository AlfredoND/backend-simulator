# Delivery plan — Backend Simulator

Languages: [Español](PLAN.md) | **English**

Status: **completed and verified** (2026-11-18).

Runtime: Node.js 24 + TypeScript, SQLite (`node:sqlite`), `node:http` server, HTTPS/HTTP2 and local proxy.

## Phase 1 — Persistence [COMPLETE]
- 82-table schema with FKs, CHECK, UNIQUE, NULLs, 34 indexes, 1:1, 1:N and M:N.
- Deterministic seed for seven domains with Unicode, varied states, long text and cent-based money.
- Transactions, rollback, WAL and parameterized queries.
- Statistics and extra data through `/_control`.

## Phase 2 — Business APIs [COMPLETE]
- Identity: login, refresh, logout, recovery, users, profiles, RBAC, groups, sessions, tokens, API keys, addresses and preferences.
- Projects: CRUD and task, subtask, status, member, activity and statistics operations.
- E-commerce: catalog, carts, atomic checkout, stock, orders, payments, cancellation, refunds, shipping, coupons and reviews.
- Library: catalog, availability, loans, returns with fines, renewals, reservations and fines.
- Education: CRUD, capacity-controlled enrollment, grades, bulk attendance and transcript/GPA.
- HR: employees, contracts, salaries, vacation balances, attendance and reports.
- Finance: accounts, balance-updating transactions, invoices with lines, payments, expenses, budgets and reports.
- ETag/If-None-Match/304 and If-Match/412; pagination, filters, search, sorting and field selection; HEAD/OPTIONS/405.

## Phase 3 — HTTP Laboratory [COMPLETE]
- `/test`: echo, methods, status, headers, bodies, responses, compression and redirects.
- Basic/Bearer/API key/expired/scheme auth; cookies; cache/304.
- Text/binary/SSE/trailer streams, interruptions, incomplete responses and Range/416 downloads.
- Delays, timeout, connection close, 4xx/5xx errors, rate limit, concurrency, idempotency and malformed responses.
- Custom methods: extension methods fully supported and basic capture for arbitrary tokens; HTTP/2 accepts arbitrary methods.

## Phase 4 — Protocols and documentation [COMPLETE]
- HTTPS with an auto-generated certificate.
- HTTP/2 TLS on a dedicated port with HTTP/1.1 fallback.
- Optional local HTTP proxy with absolute requests and CONNECT, restricted to local targets.
- Dynamic, bilingual OpenAPI at `/openapi.json`, `/openapi.en.json` and UI at `/docs`.
- README, usage guide, laboratory documentation, capability matrix and `.env.example`, with Spanish and English versions.

## Phase 5 — Micro frontend [COMPLETE]
- Static UI in `web/`, no framework or build step, served at `/ui/`.
- Health/data overview, Request Lab, endpoint catalog, documentation, theme and language switching.
- Static server with MIME, CSP and path-traversal protection.
- Bilingual documentation in `docs/frontend.md` and `docs/frontend.en.md`.

## Phase 6 — Global access, scenarios and contracts [COMPLETE]
- Global `AUTH_REQUIRED=true` policy with `<domain>:read/write` permissions.
- 80 seed users and 12 groups with roles; effective permissions = direct roles + group roles.
- 429/500/503 scenarios across every API and a configurable global rate limit.
- Fully bilingual OpenAPI with test-validated coverage.
- Authorization/scenario documentation in Spanish and English.
- CI at `.github/workflows/ci.yml` and documentation consistency tests.
- JSDoc for contracts, security and architectural decisions across `src/` and `web/`.

## Phase 7 — Verification [COMPLETE]
- `npm test`: 65/65 tests.
- `npm run typecheck`: no errors.
- `npm run build`: OK, copies `schema.sql`.
- Coverage: persistence, APIs, authorization/groups, scenarios, bilingual OpenAPI, laboratory, TLS/HTTP2/proxy protocols and micro frontend.

## Known limitations
- WebSocket not implemented (SSE is available).
- HTTP/3/QUIC not implemented.
- Trailers verified over HTTP/1.1; HTTP/2 has no specific test.
- Uploads are reflected (multipart/binary) but files are not persisted.
- Arbitrary methods with a complete body require HTTP/2 or extension methods.
- Resetting domains with external dependencies (identity/HR) may leave optional NULL references.
- The global rate limit is in memory and per process; it is not designed for distributed deployments.
- The UI is static and deliberately simple: no SPA router or framework.
