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
- Dynamic OpenAPI at `/openapi.json` and UI at `/docs`.
- README, usage guide, laboratory documentation, capability matrix and `.env.example`, with Spanish and English versions.

## Phase 5 — Verification [COMPLETE]
- `npm test`: 37/37 tests.
- `npm run typecheck`: no errors.
- `npm run build`: OK, copies `schema.sql`.
- Coverage: persistence, APIs, laboratory and TLS/HTTP2/proxy protocols.

## Known limitations
- WebSocket not implemented (SSE is available).
- HTTP/3/QUIC not implemented.
- Trailers verified over HTTP/1.1; HTTP/2 has no specific test.
- Uploads are reflected (multipart/binary) but files are not persisted.
- Arbitrary methods with a complete body require HTTP/2 or extension methods.
- Resetting domains with external dependencies (identity/HR) may leave optional NULL references.
- No global API rate limit; the laboratory provides configurable rate limiting.
