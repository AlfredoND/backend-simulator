# Matriz de capacidades

Idiomas: **Español** | [English](capabilities.en.md)

Estado real del backend, no una lista de deseos. Cada fila indica dónde se prueba y qué limitación existe.

Leyenda: **Sí** = escenario real implementado y cubierto por pruebas; **Parcial** = implementado con una limitación explícita; **No** = no implementado.

## Criterios mínimos de cobertura

| Capacidad | Estado | Evidencia / endpoint | Prueba |
|---|---|---|---|
| Métodos HTTP estándar | Sí | APIs + `/test/echo`, `/test/methods` | `tests/lab.test.ts`, `tests/api.test.ts` |
| HEAD y OPTIONS | Sí | Router, `Allow`, sin cuerpo en HEAD | `tests/api.test.ts`, `tests/lab.test.ts` |
| Métodos de extensión (`PROPFIND`, `PURGE`, …) | Sí | Parser HTTP de Node | — |
| Métodos personalizados arbitrarios | Parcial | `/test/echo`: capturados sin cuerpo; HTTP/2 los admite completos | `tests/lab.test.ts` |
| URL y query parameters | Sí | `/test/echo` con repetidos | `tests/lab.test.ts` |
| Headers de request/response | Sí | `/test/headers/*`, `/test/echo` | `tests/lab.test.ts` |
| Headers repetidos | Sí | `/test/headers/repeated` | — |
| Headers grandes | Sí | `/test/headers/large` (hasta 16 KiB) | — |
| Cuerpos JSON | Sí | APIs, `/test/body/echo` | `tests/api.test.ts`, `tests/lab.test.ts` |
| Cuerpos de texto/HTML/XML/CSV | Sí | `/test/body/echo`, `/test/response/*` | `tests/lab.test.ts` |
| Cuerpos URL-encoded y multipart | Sí | `/test/body/echo` los refleja; no se persisten archivos | — |
| Cuerpos binarios | Sí | Eco base64, `/test/response/binary`, descargas | `tests/lab.test.ts` |
| Content-Type correcto/incorrecto | Sí | APIs 415, `/test/body/wrong-content-type` | `tests/api.test.ts`, `tests/lab.test.ts` |
| JSON inválido | Sí | APIs 400, `/test/body/invalid-json` | `tests/api.test.ts`, `tests/lab.test.ts` |
| Autenticación Basic | Sí | `/test/auth/basic` | `tests/lab.test.ts` |
| Bearer token | Sí | APIs + `/test/auth/bearer` | `tests/api.test.ts`, `tests/lab.test.ts` |
| API key | Sí | `X-API-Key` en APIs y laboratorio | `tests/api.test.ts`, `tests/lab.test.ts` |
| Credenciales ausentes/incorrectas/expiradas | Sí | `/test/auth/*`, identidad | `tests/lab.test.ts`, `tests/api.test.ts` |
| Esquema incorrecto | Sí | `/test/auth/scheme` | — |
| Redirecciones 301/302/303/307/308 | Sí | `/test/redirect/{code}` | `tests/lab.test.ts` |
| Redirección relativa/absoluta | Sí | `absolute=1` | `tests/lab.test.ts` |
| Cadena, bucle y destino inexistente | Sí | `/test/redirect/chain`, `/loop`, `/missing` | `tests/lab.test.ts` |
| Timeout | Sí (cliente) | `/test/timeout`; el cliente aborta | `tests/lab.test.ts` |
| Aborto de solicitud | Sí | `AbortSignal.timeout` en pruebas | `tests/lab.test.ts` |
| Corte de conexión | Sí | `/test/close` | `tests/lab.test.ts` |
| Respuesta interrumpida | Sí | `/test/stream/interrupted` | `tests/lab.test.ts` |
| Respuesta incompleta | Sí | `/test/stream/incomplete` | `tests/lab.test.ts` |
| Errores HTTP 4xx/5xx | Sí | APIs, `/test/error/{code}` | `tests/api.test.ts`, `tests/lab.test.ts` |
| Errores de conexión | Sí | `/test/close`, `/test/raw/malformed` | `tests/lab.test.ts` |
| Cookies y sesiones | Sí | `/test/cookies/*`, sesiones de identidad | `tests/lab.test.ts`, `tests/api.test.ts` |
| Compresión gzip/deflate/Brotli | Sí | `/test/compress`, negociación | `tests/lab.test.ts` |
| Streaming de texto/binario | Sí | `/test/stream/text`, `/binary` | `tests/lab.test.ts` |
| SSE | Sí | `/test/stream/sse` | `tests/lab.test.ts` |
| WebSocket | No | No implementado | — |
| Descargas grandes | Sí | `/test/download` (hasta límite configurado) | `tests/lab.test.ts` |
| Uploads | Parcial | Eco de multipart/binario; no almacenamiento de archivos | — |
| Rangos y Content-Range | Sí | `/test/download` + `Range`; 206/416 | `tests/lab.test.ts` |
| Trailers | Parcial | HTTP/1.1; HTTP/2 no verificado de forma específica | `tests/lab.test.ts` |
| ETag / If-None-Match / 304 | Sí | Laboratorio y recursos de negocio | `tests/lab.test.ts`, `tests/api.test.ts` |
| Last-Modified / If-Modified-Since | Sí | `/test/cache/last-modified` | `tests/lab.test.ts` |
| Cache-Control | Sí | `/test/cache/control`, recursos | `tests/lab.test.ts` |
| If-Match / 412 | Sí | Recursos de negocio | `tests/api.test.ts` |
| Paginación página/offset | Sí | `page`, `per_page`, `offset` | `tests/api.test.ts` |
| Ordenamiento y selección de campos | Sí | `sort`, `order`, `fields` | `tests/api.test.ts` |
| Filtros combinados y búsqueda | Sí | Filtros tipados, rangos, `q` | `tests/api.test.ts` |
| Respuestas vacías | Sí | `/test/response/empty`, `/no-content`, 204 | `tests/lab.test.ts` |
| Respuestas grandes | Sí | `/test/response/large`, `/test/download` | `tests/lab.test.ts` |
| Concurrencia | Sí | `/test/concurrency`, `/test/counter`; escrituras SQLite serializadas | `tests/lab.test.ts` |
| Idempotencia | Sí | `/test/idempotency` | `tests/lab.test.ts` |
| Rate limiting + Retry-After | Sí | `/test/rate-limit`, `/test/error/429` | `tests/lab.test.ts` |
| HTTPS | Sí | `HTTPS_PORT`, certificado local | `tests/protocols.test.ts` |
| Certificados locales | Sí | Autogenerados con OpenSSL; SAN localhost/127.0.0.1 | `tests/protocols.test.ts` |
| HTTP/2 | Sí | Servidor TLS independiente, ALPN h2 | `tests/protocols.test.ts` |
| Proxy HTTP | Sí (local) | `PROXY_ENABLED`; peticiones absolutas y CONNECT; destinos locales | `tests/protocols.test.ts` |
| Micro frontend estático | Sí | `/ui/`; overview, Request Lab, catálogo, i18n y tema | `tests/ui.test.ts`, `tests/frontend.test.mjs` |
| HTTP/3 / QUIC | No | Fuera del alcance | — |
| DNS personalizado | No | Fuera del alcance | — |
| Respuestas HTTP malformadas | Sí (HTTP/1.1) | `/test/raw/*` | `tests/lab.test.ts` |

## Escenarios de negocio

| Escenario | Estado | Evidencia |
|---|---|---|
| 401 autenticación | Sí | `/api/v1/identity/users` sin token |
| 403 permisos | Sí | POST de usuario con token viewer |
| 404 recurso | Sí | Cualquier recurso inexistente |
| 409 conflicto | Sí | Emails duplicados, checkout sin stock, reservas duplicadas |
| 412 precondición | Sí | `If-Match` obsoleto en recursos |
| 413 payload | Sí | `MAX_BODY_BYTES` |
| 415 Content-Type | Sí | Cuerpos JSON con tipo incorrecto |
| 422 validación | Sí | Campos desconocidos, tipos y límites |
| 429 límite | Sí | Laboratorio; las APIs no aplican rate limit global |
| 500/503 controlados | Sí | `/test/error/500`, `/test/error/503` |
| Rollback transaccional | Sí | Checkout, cancelación, devolución, pagos, facturas |
| Datos NULL | Sí | Perfiles, fechas, referencias opcionales |
| Unicode y textos largos | Sí | Nombres, descripciones, bios |
| Relaciones 1:1, 1:N, M:N | Sí | Perfiles, stats, autores-libros, roles-permisos, etiquetas |
| Agregaciones y JOIN | Sí | Stats de proyectos/tiendas/cursos/finanzas |
| Reset por dominio / total | Sí | `/_control/reset/:domain`, `/_control/reset` |
| Datos adicionales | Sí | `/_control/seed` (`users`, `tasks`, `products`, `books`, `students`, `employees`, `transactions`) |

## Verificación

```text
npm test       48 pruebas, 48 pasan
npm run typecheck   sin errores
npm run build       compila y copia schema.sql
```

Última ejecución verificada: 2026-11-18.
