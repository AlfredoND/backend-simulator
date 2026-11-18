# Laboratorio HTTP `/test`

Idiomas: **Español** | [English](http-lab.en.md)

El laboratorio es independiente de SQLite y de los dominios de negocio. Sirve para probar el transporte y el comportamiento de un cliente HTTP. Todos los endpoints admiten `HEAD` con las mismas cabeceras que `GET` y `OPTIONS` responde `Allow`.

Las credenciales y límites salen de la configuración (`BASIC_USER`, `BASIC_PASSWORD`, `ADMIN_TOKEN`, `TEST_API_KEY`, `MAX_BODY_BYTES`, `MAX_RESPONSE_BYTES`, `MAX_DELAY_MS`).

## Eco y métodos

| Endpoint | Descripción |
|---|---|
| `/test` y `/test/echo` | Eco completo: método, versión HTTP, esquema, URL, query con valores repetidos, headers crudos, cookies, cliente, cuerpo en texto/base64/SHA-256 y JSON parseado si procede |
| `/test/upload` | Igual que el eco; útil para multipart/upload |
| `/test/methods` | Lista métodos soportados y el recibido |
| `/test/methods/{method}` | Compara el método esperado con el recibido |
| `/test/status/{code}` | Devuelve el código 200–599 indicado |
| `/test/status?code=418` | Igual, por query |

```bash
curl -i -X PATCH 'http://localhost:4000/test/echo?x=1&x=2' \
  -H 'X-Custom: valor' -H 'Cookie: a=1; b=2' \
  -H 'Content-Type: application/json' -d '{"hola":"mundo"}'
```

Métodos personalizados:

- Los métodos estándar y de extensión del parser de Node (por ejemplo `PROPFIND`, `PURGE`, `MKCOL`) se procesan normalmente.
- Un token de método arbitrario (`CUSTOM`) se captura en `/test/echo` a nivel de parser y devuelve un eco básico sin procesar el cuerpo. En HTTP/2 los métodos arbitrarios se procesan normalmente.
- Para probar cuerpo completo con un método propietario, usa HTTP/2 o un método de extensión.

## Headers

| Endpoint | Descripción |
|---|---|
| `/test/headers/echo` | Devuelve headers crudos y cookies |
| `/test/headers/required?names=x-a,x-b` | 400 con la lista de headers ausentes |
| `/test/headers/large?size=4096` | Añade `X-Large` hasta 16 KiB |
| `/test/headers/repeated` | Cabeceras de respuesta repetidas y dos `Set-Cookie` |
| `/test/headers/custom?name=X-Test&value=v` | Cabecera de respuesta arbitraria |
| `/test/headers/cache?max_age=60` | `Cache-Control`, `ETag`, `Vary` y `Expires` |

## Cuerpos y tipos de contenido

| Endpoint | Descripción |
|---|---|
| `/test/body/echo` | Cualquier método y cuerpo; JSON, texto, HTML, XML, CSV, URL-encoded, multipart o binario |
| `/test/body/empty` | 200 con cuerpo vacío |
| `/test/body/invalid-json` | 200 con `{"broken":` y Content-Type JSON |
| `/test/body/wrong-content-type` | JSON enviado como `text/plain` |
| `/test/body/large?size=N` | Respuesta binaria generada |
| `/test/response/json` | JSON con Unicode |
| `/test/response/text` | Texto plano |
| `/test/response/html` | HTML |
| `/test/response/xml` | XML |
| `/test/response/csv` | CSV |
| `/test/response/binary?size=N` | Binario |
| `/test/response/large?size=N` | Binario grande (hasta `MAX_RESPONSE_BYTES`) |
| `/test/response/empty` | 200, `Content-Length: 0` |
| `/test/response/no-content` | 204 sin cuerpo |

El eco incluye `Content-Length` entrante dentro de `headers`, `content_type`, `size`, `text`, `base64`, `sha256` y, si el Content-Type es JSON, el valor parseado o `json_error`.

## Compresión

`GET /test/compress`:

- `algo=auto|gzip|deflate|br|identity` (por defecto `auto`).
- Negociación con `Accept-Encoding` en `auto`.
- `body=texto` o `size=N` para contenido generado.
- Devuelve `Content-Encoding` coherente, `Vary: Accept-Encoding`, `X-Uncompressed-Bytes` y `X-Compression`.

```bash
curl -s --compressed 'http://localhost:4000/test/compress?algo=gzip&body=repetible'
```

## Redirecciones

| Endpoint | Descripción |
|---|---|
| `/test/redirect/{301\|302\|303\|307\|308}?to=/ruta` | Redirección local; `absolute=1` genera URL absoluta del mismo host |
| `/test/redirect?code=308&to=...` | Código por query |
| `/test/redirect/chain/{n}` | Cadena de `n` redirecciones (máx. 20) |
| `/test/redirect/loop` | Bucle infinito controlado |
| `/test/redirect/missing` | Redirige a una ruta inexistente |

Solo se aceptan destinos locales que comiencen por `/`; un destino externo devuelve 400.

## Autenticación

| Endpoint | Comportamiento |
|---|---|
| `/test/auth/basic` | Exige Basic con `BASIC_USER`/`BASIC_PASSWORD`; 401 + `WWW-Authenticate` |
| `/test/auth/bearer` | Exige `Authorization: Bearer ADMIN_TOKEN` |
| `/test/auth/api-key` | Exige `X-API-Key: TEST_API_KEY` |
| `/test/auth/expired` | Siempre 401 con `error="invalid_token"` |
| `/test/auth/scheme` | Rechaza esquemas distintos de Bearer |

```bash
curl -i -u testuser:testpass http://localhost:4000/test/auth/basic
curl -i -H 'Authorization: Bearer local-admin-token' http://localhost:4000/test/auth/bearer
```

## Cookies

| Endpoint | Descripción |
|---|---|
| `/test/cookies/set?name=&value=&path=&max-age=&expires=&httpOnly=&secure=&sameSite=` | Crea una cookie con atributos |
| `/test/cookies/set-many?count=3` | Varias cookies `Set-Cookie` |
| `/test/cookies/echo` | Devuelve cookies recibidas (parseadas y crudas) |
| `/test/cookies/delete?name=session` | `Max-Age=0` y Expires pasado |

`Secure` se envía si se solicita, independientemente del esquema; úsalo con HTTPS para un comportamiento de navegador realista.

## Caché y condicionales

| Endpoint | Comportamiento |
|---|---|
| `/test/cache/etag?version=2` | `ETag`; con `If-None-Match` igual devuelve 304 sin cuerpo |
| `/test/cache/last-modified?days_ago=1` | `Last-Modified`; con `If-Modified-Since` posterior devuelve 304 |
| `/test/cache/control?max_age=60` | `Cache-Control: public, max-age=...` |
| `/test/cache/control?no_store=1` | `Cache-Control: no-store` y `Pragma` |

Las APIs de negocio también soportan `ETag`/`If-None-Match` y `If-Match` (412).

## Streaming, descargas y rangos

| Endpoint | Descripción |
|---|---|
| `/test/stream/text?chunks=5&delay=100&size=32` | Transferencia chunked progresiva |
| `/test/stream/progressive` | Alias de texto |
| `/test/stream/binary?chunks=&size=` | Chunks binarios |
| `/test/stream/sse?count=5&delay=200` | Server-Sent Events |
| `/test/stream/trailers` | Respuesta con trailers (`X-Trailer-Checksum`) |
| `/test/stream/interrupted?delay=50` | Envía cabeceras y parte del cuerpo, luego corta la conexión |
| `/test/stream/incomplete` | Promete `Content-Length` mayor que el cuerpo enviado |
| `/test/download?size=N` | Descarga binaria con `Accept-Ranges`, `Content-Disposition` y ETag |
| `/test/range?size=N` | Alias de descarga |
| Cabecera `Range: bytes=0-99` | 206 + `Content-Range` |
| Rango inválido | 416 + `Content-Range: bytes */total` |

```bash
curl -i 'http://localhost:4000/test/download?size=1048576' -H 'Range: bytes=0-1023'
```

Los trailers se envían por HTTP/1.1. HTTP/2 tiene su propio mecanismo de trailers y puede variar según el cliente.

## Tiempo, errores y límites

| Endpoint | Descripción |
|---|---|
| `/test/delay/{ms}` o `/test/delay?ms=` | Retraso acotado por `MAX_DELAY_MS` |
| `/test/timeout?ms=30000&respond=504` | Mantiene la conexión; responde 504 si el cliente no aborta |
| `/test/never` | No responde hasta cierre del cliente o 120 s |
| `/test/close` | Cierra la conexión sin respuesta |
| `/test/error/{code}` | Error estructurado 400–599; 429/503 incluyen `Retry-After` |
| `/test/error/rate-limited` | 429 con `Retry-After: 2` |
| `/test/rate-limit?limit=3&window_ms=10000&key=demo` | Rate limit en memoria por clave/IP, cabeceras `X-RateLimit-*` |

## Concurrencia, idempotencia y escritura

| Endpoint | Descripción |
|---|---|
| `/test/counter` | Contador global en memoria |
| `/test/concurrency?delay=100&id=a` | Respuesta retrasada para lanzar solicitudes simultáneas |
| `/test/idempotency` (POST) | Exige `Idempotency-Key`; primera petición 201, repetición 200 con `Idempotent-Replay: true` |

Los estados de rate limit, idempotencia y contador viven en memoria y se reinician al reiniciar el proceso.

## Respuestas malformadas y parser

| Endpoint | Descripción |
|---|---|
| `/test/raw/malformed` | Respuesta HTTP con cabecera inválida y cierre de socket |
| `/test/raw/invalid-status-line` | Línea de estado inválida |
| `/test/raw/header-injection` | Cabecera malformada |

Estas rutas escriben bytes directamente al socket y solo tienen sentido en HTTP/1.1.

## Cobertura de escenarios

| Escenario | Endpoint |
|---|---|
| Códigos 2xx/3xx/4xx/5xx | `/test/status/{code}` |
| 304 | `/test/cache/etag` |
| 401 | `/test/auth/*`, `/test/error/401` |
| 403 | APIs de identidad con token viewer |
| 404 | `/test/redirect/missing` y ruta inexistente |
| 409/412/413/415/422 | APIs de negocio y validación de cuerpos |
| 429 | `/test/rate-limit`, `/test/error/rate-limited` |
| 500/503 | `/test/error/500`, `/test/error/503` |
| Timeout | `/test/timeout` |
| Aborto/corte | `/test/close`, `/test/stream/interrupted` |
| Respuesta incompleta | `/test/stream/incomplete` |
| Cuerpo grande | `/test/body/large`, `MAX_BODY_BYTES` |
| Respuesta grande | `/test/response/large`, `/test/download` |
| Compresión | `/test/compress` |
| Redirecciones | `/test/redirect/*` |
| Cookies | `/test/cookies/*` |
| Rangos | `/test/download` |
| Trailers | `/test/stream/trailers` |
| Concurrencia | `/test/concurrency`, `/test/counter` |
| Idempotencia | `/test/idempotency` |
