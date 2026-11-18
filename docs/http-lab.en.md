# HTTP laboratory `/test`

Languages: [Español](http-lab.md) | **English**

The laboratory is independent of SQLite and of the business domains. It is used to test HTTP transport and client behaviour. Every endpoint supports `HEAD` with the same headers as `GET`, and `OPTIONS` responds with `Allow`.

Credentials and limits come from configuration (`BASIC_USER`, `BASIC_PASSWORD`, `ADMIN_TOKEN`, `TEST_API_KEY`, `MAX_BODY_BYTES`, `MAX_RESPONSE_BYTES`, `MAX_DELAY_MS`).

## Echo and methods

| Endpoint | Description |
|---|---|
| `/test` and `/test/echo` | Full echo: method, HTTP version, scheme, URL, query with repeated values, raw headers, cookies, client, body as text/base64/SHA-256 and parsed JSON when applicable |
| `/test/upload` | Same as echo; useful for multipart and uploads |
| `/test/methods` | Lists supported methods and the received method |
| `/test/methods/{method}` | Compares the expected method with the received one |
| `/test/status/{code}` | Returns the requested 200–599 status |
| `/test/status?code=418` | Same, through a query parameter |

```bash
curl -i -X PATCH 'http://localhost:4000/test/echo?x=1&x=2' \
  -H 'X-Custom: value' -H 'Cookie: a=1; b=2' \
  -H 'Content-Type: application/json' -d '{"hello":"world"}'
```

Custom methods:

- Standard and parser extension methods such as `PROPFIND`, `PURGE` or `MKCOL` are processed normally.
- An arbitrary method token (`CUSTOM`) is captured at parser level in `/test/echo` and returns a basic echo without processing the body. HTTP/2 processes arbitrary methods normally.
- To test a full body with a proprietary method, use HTTP/2 or an extension method.

## Headers

| Endpoint | Description |
|---|---|
| `/test/headers/echo` | Returns raw headers and cookies |
| `/test/headers/required?names=x-a,x-b` | 400 with the missing header list |
| `/test/headers/large?size=4096` | Adds `X-Large` up to 16 KiB |
| `/test/headers/repeated` | Repeated response headers and two `Set-Cookie` values |
| `/test/headers/custom?name=X-Test&value=v` | Arbitrary response header |
| `/test/headers/cache?max_age=60` | `Cache-Control`, `ETag`, `Vary` and `Expires` |

## Bodies and content types

| Endpoint | Description |
|---|---|
| `/test/body/echo` | Any method and body: JSON, text, HTML, XML, CSV, URL-encoded, multipart or binary |
| `/test/body/empty` | 200 with an empty body |
| `/test/body/invalid-json` | 200 with `{"broken":` and a JSON Content-Type |
| `/test/body/wrong-content-type` | JSON sent as `text/plain` |
| `/test/body/large?size=N` | Generated binary response |
| `/test/response/json` | JSON with Unicode |
| `/test/response/text` | Plain text |
| `/test/response/html` | HTML |
| `/test/response/xml` | XML |
| `/test/response/csv` | CSV |
| `/test/response/binary?size=N` | Binary |
| `/test/response/large?size=N` | Large binary (up to `MAX_RESPONSE_BYTES`) |
| `/test/response/empty` | 200 with `Content-Length: 0` |
| `/test/response/no-content` | 204 without a body |

The echo includes the incoming `Content-Length` inside `headers`, plus `content_type`, `size`, `text`, `base64`, `sha256` and, for JSON Content-Types, the parsed value or `json_error`.

## Compression

`GET /test/compress`:

- `algo=auto|gzip|deflate|br|identity` (default `auto`).
- `Accept-Encoding` negotiation when using `auto`.
- `body=text` or `size=N` for generated content.
- Returns a matching `Content-Encoding`, `Vary: Accept-Encoding`, `X-Uncompressed-Bytes` and `X-Compression`.

```bash
curl -s --compressed 'http://localhost:4000/test/compress?algo=gzip&body=repeatable'
```

## Redirects

| Endpoint | Description |
|---|---|
| `/test/redirect/{301\|302\|303\|307\|308}?to=/path` | Local redirect; `absolute=1` builds an absolute URL on the same host |
| `/test/redirect?code=308&to=...` | Code through query parameters |
| `/test/redirect/chain/{n}` | Chain of `n` redirects (max 20) |
| `/test/redirect/loop` | Controlled redirect loop |
| `/test/redirect/missing` | Redirects to a non-existent route |

Only local destinations starting with `/` are accepted; external destinations return 400.

## Authentication

| Endpoint | Behaviour |
|---|---|
| `/test/auth/basic` | Requires Basic with `BASIC_USER`/`BASIC_PASSWORD`; 401 + `WWW-Authenticate` |
| `/test/auth/bearer` | Requires `Authorization: Bearer ADMIN_TOKEN` |
| `/test/auth/api-key` | Requires `X-API-Key: TEST_API_KEY` |
| `/test/auth/expired` | Always 401 with `error="invalid_token"` |
| `/test/auth/scheme` | Rejects schemes other than Bearer |

```bash
curl -i -u testuser:testpass http://localhost:4000/test/auth/basic
curl -i -H 'Authorization: Bearer local-admin-token' http://localhost:4000/test/auth/bearer
```

## Cookies

| Endpoint | Description |
|---|---|
| `/test/cookies/set?name=&value=&path=&max-age=&expires=&httpOnly=&secure=&sameSite=` | Creates a cookie with attributes |
| `/test/cookies/set-many?count=3` | Several `Set-Cookie` headers |
| `/test/cookies/echo` | Returns received cookies (parsed and raw) |
| `/test/cookies/delete?name=session` | `Max-Age=0` and a past Expires |

`Secure` is sent when requested, regardless of scheme; use HTTPS for realistic browser behaviour.

## Caching and conditionals

| Endpoint | Behaviour |
|---|---|
| `/test/cache/etag?version=2` | `ETag`; matching `If-None-Match` returns 304 without a body |
| `/test/cache/last-modified?days_ago=1` | `Last-Modified`; a later `If-Modified-Since` returns 304 |
| `/test/cache/control?max_age=60` | `Cache-Control: public, max-age=...` |
| `/test/cache/control?no_store=1` | `Cache-Control: no-store` and `Pragma` |

Business APIs also support `ETag`/`If-None-Match` and `If-Match` (412).

## Streaming, downloads and ranges

| Endpoint | Description |
|---|---|
| `/test/stream/text?chunks=5&delay=100&size=32` | Progressive chunked transfer |
| `/test/stream/progressive` | Text alias |
| `/test/stream/binary?chunks=&size=` | Binary chunks |
| `/test/stream/sse?count=5&delay=200` | Server-Sent Events |
| `/test/stream/trailers` | Response with trailers (`X-Trailer-Checksum`) |
| `/test/stream/interrupted?delay=50` | Sends headers and part of the body, then closes the connection |
| `/test/stream/incomplete` | Promises a larger `Content-Length` than the sent body |
| `/test/download?size=N` | Binary download with `Accept-Ranges`, `Content-Disposition` and ETag |
| `/test/range?size=N` | Download alias |
| Header `Range: bytes=0-99` | 206 + `Content-Range` |
| Invalid range | 416 + `Content-Range: bytes */total` |

```bash
curl -i 'http://localhost:4000/test/download?size=1048576' -H 'Range: bytes=0-1023'
```

Trailers are sent over HTTP/1.1. HTTP/2 has its own trailer mechanism and client support may vary.

## Time, errors and limits

| Endpoint | Description |
|---|---|
| `/test/delay/{ms}` or `/test/delay?ms=` | Delay bounded by `MAX_DELAY_MS` |
| `/test/timeout?ms=30000&respond=504` | Keeps the connection open; responds 504 if the client does not abort |
| `/test/never` | Does not respond until the client closes or 120 s pass |
| `/test/close` | Closes the connection without a response |
| `/test/error/{code}` | Structured 400–599 error; 429/503 include `Retry-After` |
| `/test/error/rate-limited` | 429 with `Retry-After: 2` |
| `/test/rate-limit?limit=3&window_ms=10000&key=demo` | In-memory rate limit by key/IP, `X-RateLimit-*` headers |

## Concurrency, idempotency and writes

| Endpoint | Description |
|---|---|
| `/test/counter` | In-memory global counter |
| `/test/concurrency?delay=100&id=a` | Delayed response for simultaneous requests |
| `/test/idempotency` (POST) | Requires `Idempotency-Key`; first request 201, replay 200 with `Idempotent-Replay: true` |

Rate limit, idempotency and counter state live in memory and reset when the process restarts.

## Malformed responses and parser

| Endpoint | Description |
|---|---|
| `/test/raw/malformed` | HTTP response with an invalid header and socket close |
| `/test/raw/invalid-status-line` | Invalid status line |
| `/test/raw/header-injection` | Malformed header |

These routes write bytes directly to the socket and only make sense over HTTP/1.1.

## Scenario coverage

| Scenario | Endpoint |
|---|---|
| 2xx/3xx/4xx/5xx codes | `/test/status/{code}` |
| 304 | `/test/cache/etag` |
| 401 | `/test/auth/*`, `/test/error/401` |
| 403 | Identity APIs with the viewer token |
| 404 | `/test/redirect/missing` and unknown routes |
| 409/412/413/415/422 | Business APIs and body validation |
| 429 | `/test/rate-limit`, `/test/error/rate-limited` |
| 500/503 | `/test/error/500`, `/test/error/503` |
| Timeout | `/test/timeout` |
| Abort/reset | `/test/close`, `/test/stream/interrupted` |
| Incomplete response | `/test/stream/incomplete` |
| Large body | `/test/body/large`, `MAX_BODY_BYTES` |
| Large response | `/test/response/large`, `/test/download` |
| Compression | `/test/compress` |
| Redirects | `/test/redirect/*` |
| Cookies | `/test/cookies/*` |
| Ranges | `/test/download` |
| Trailers | `/test/stream/trailers` |
| Concurrency | `/test/concurrency`, `/test/counter` |
| Idempotency | `/test/idempotency` |
