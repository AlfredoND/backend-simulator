# Autorización global y escenarios

Idiomas: **Español** | [English](auth-and-scenarios.en.md)

Este documento describe la política de acceso transversal, los usuarios y grupos de simulación, los escenarios de error globales y la especificación OpenAPI bilingüe.

## Política global

`AUTH_REQUIRED=true` es el valor por defecto. Toda ruta bajo `/api/v1` exige un Bearer token o una API key válidos, salvo las rutas públicas de autenticación:

- `POST /api/v1/identity/auth/login`
- `POST /api/v1/identity/auth/refresh`
- `POST /api/v1/identity/auth/forgot-password`
- `POST /api/v1/identity/auth/reset-password`
- `GET /api/v1/identity/auth/verify`

Las rutas de sesión autenticada (`logout`, `me`, `change-password`) exigen identidad, pero no un permiso de dominio adicional.

### Permisos por dominio

| Prefijo | Lectura (`GET`/`HEAD`) | Escritura (`POST`/`PUT`/`PATCH`/`DELETE`) |
|---|---|---|
| `/api/v1/identity` | `identity:read` | `identity:write` |
| `/api/v1/projects` | `projects:read` | `projects:write` |
| `/api/v1/shop` | `shop:read` | `shop:write` |
| `/api/v1/library` | `library:read` | `library:write` |
| `/api/v1/education` | `education:read` | `education:write` |
| `/api/v1/hr` | `hr:read` | `hr:write` |
| `/api/v1/finance` | `finance:read` | `finance:write` |

Las rutas de `/test`, `/ui`, `/docs`, `/openapi*.json`, `/health` y `/_control/stats|domains|config|mode` siguen siendo públicas. Las operaciones destructivas de control (`reset`, `seed`, `freeze`, `restore`, `unfreeze`) exigen `X-Control-Token`.

```bash
# 401 sin credenciales
curl -i http://localhost:4000/api/v1/shop/products

# 200 con token de administrador
curl -i -H 'Authorization: Bearer local-admin-token' \
  http://localhost:4000/api/v1/shop/products?per_page=1
```

## Usuarios de simulación

Además del administrador y el viewer, el seed incluye cuentas con roles acotados. Todas usan `Password123!` salvo el administrador.

| Correo | Rol directo | Uso |
|---|---|---|
| `admin@simulator.local` | admin | Acceso total (`Admin123!`) |
| `viewer@simulator.local` | viewer | Solo lectura (`Viewer123!`) |
| `developer@simulator.local` | developer | Proyectos e identidad de lectura |
| `manager@simulator.local` | manager | Escritura en varios dominios |
| `auditor@simulator.local` | auditor | Lectura de finanzas y RRHH |
| `support@simulator.local` | support | Identidad y soporte |
| `viewer2@simulator.local` | viewer | Segundo usuario de solo lectura |
| `groupviewer@simulator.local` | **ninguno** | Permisos obtenidos exclusivamente de un grupo |

```bash
curl -s -X POST http://localhost:4000/api/v1/identity/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"groupviewer@simulator.local","password":"Password123!"}'
```

El seed crea 80 usuarios y 12 grupos. Los grupos pueden conceder roles completos:

| Grupo | Rol concedido |
|---|---|
| Ingeniería | developer |
| Diseño de producto | viewer |
| Operaciones | manager |
| Atención al cliente | support |
| Dirección | manager |
| Calidad | auditor |
| Investigación | developer |
| Seguridad | auditor |
| Observadores | viewer (`groupviewer` pertenece aquí) |
| Auditores | auditor |
| Soporte | support |
| Gestión | manager |

Los permisos efectivos son la unión de roles directos y roles de grupo. Se consultan en:

```bash
curl -H 'Authorization: Bearer local-admin-token' \
  http://localhost:4000/api/v1/identity/users/8/permissions
```

### Gestionar roles de grupo

```bash
# Listar
curl -H 'Authorization: Bearer local-admin-token' \
  http://localhost:4000/api/v1/identity/groups/9/roles

# Conceder developer al grupo 9
curl -X POST http://localhost:4000/api/v1/identity/groups/9/roles \
  -H 'Authorization: Bearer local-admin-token' \
  -H 'Content-Type: application/json' \
  -d '{"role":"developer"}'

# Retirar
curl -X DELETE http://localhost:4000/api/v1/identity/groups/9/roles/3 \
  -H 'Authorization: Bearer local-admin-token'
```

`groupviewer` pasa a tener `projects:write` al conceder developer y lo pierde al retirarlo. Los cambios de grupo se reflejan en el siguiente request, sin volver a iniciar sesión.

## Escenarios globales 429/500/503

La cabecera `X-Simulate-Error` o el parámetro `simulate_error` inyectan el escenario antes del router, después de la autorización. Funciona en todos los dominios:

```bash
for domain in identity projects shop library education hr finance; do
  curl -s -o /dev/null -w "$domain:%{http_code}\n" \
    -H 'Authorization: Bearer local-admin-token' \
    -H 'X-Simulate-Error: 500' \
    "http://localhost:4000/api/v1/$domain"
done
```

Códigos admitidos: `429`, `500`, `503`. Cualquier otro devuelve 422.

- `429`: `Retry-After: 1` y `SIMULATED_RATE_LIMIT`.
- `500`: `SIMULATED_INTERNAL_ERROR`.
- `503`: `Retry-After: 5` y `SERVICE_UNAVAILABLE`.

La inyección se puede desactivar con `FAULT_INJECTION_ENABLED=false`; en ese caso la cabecera devuelve `403 FAULT_INJECTION_DISABLED`.

### Rate limit real configurable

Además de la simulación puntual, existe un rate limit global en memoria:

```dotenv
API_RATE_LIMIT_MAX=60
API_RATE_LIMIT_WINDOW_MS=60000
```

- Se aplica a todas las rutas `/api/v1`.
- La clave es el usuario autenticado o la IP.
- Respuestas incluyen `X-RateLimit-Limit`, `X-RateLimit-Remaining` y `X-RateLimit-Reset`.
- Al exceder el límite: `429 TOO_MANY_REQUESTS` con `Retry-After`.
- El estado es por proceso y se reinicia al arrancar. `API_RATE_LIMIT_MAX=0` lo desactiva.

## OpenAPI bilingüe

| Recurso | Español | English |
|---|---|---|
| Especificación | `GET /openapi.json` | `GET /openapi.en.json` |
| Alias | `GET /openapi.json` | `GET /openapi.json?lang=en` |
| Swagger UI | `/docs` | `/docs?lang=en` |
| Metadatos raíz | `openapi` | `openapi_en`, `docs_en` |

La especificación inglesa traduce resúmenes, descripciones, parámetros, respuestas, tags, servidores y ejemplos. Los nombres técnicos de paths, operaciones y esquemas no cambian. La cobertura de traducciones se valida en pruebas.

## Decisiones técnicas

- La autorización global se evalúa **antes** de la inyección de errores y del router; así un 401/403 no se enmascara como 500.
- `AUTH_REQUIRED=false` conserva las guardas internas de identidad y sirve para probar APIs de negocio sin credenciales.
- Los roles de grupo se resuelven en cada request (consulta SQL), lo que permite probar cambios de política sin reemitir tokens.
- El rate limiter y los contadores de simulación viven en memoria: es un entorno de pruebas, no un gateway distribuido.
- La especificación inglesa reutiliza la misma definición de rutas; no hay contratos duplicados.

## Pruebas

- `tests/auth-policy.test.ts`: 401/403 globales, permisos de solo lectura, grupos y cambios de rol.
- `tests/resilience.test.ts`: 429/500/503 en los siete dominios, query/header, 422 y rate limit real.
- `tests/openapi.test.ts`: paridad de paths, resúmenes/parámetros/tags en inglés, cobertura de traducciones y `/docs` bilingüe.
