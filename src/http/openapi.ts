/**
 * @file OpenAPI 3.0 generator and Swagger UI page.
 *
 * The specification is derived from router metadata, so paths cannot drift
 * from implementation. Spanish and English are generated from the same route
 * graph; generic CRUD English summaries come from the resource helper, custom
 * routes use the translation catalogue in `openapi-i18n.ts`.
 */
import type { Router } from './router.js';
import type { Config } from '../core/config.js';
import {
  INFO_DESCRIPTION,
  TAG_DESCRIPTIONS_EN,
  translateDescription,
  translateSummary,
  type ApiLanguage,
} from './openapi-i18n.js';

type OpenApiObject = Record<string, unknown>;

function localizeResponses(responses: Record<string, unknown>, lang: ApiLanguage): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(responses).map(([status, response]) => {
      if (!response || typeof response !== 'object' || !('description' in response)) return [status, response];
      const description = (response as { description?: unknown }).description;
      return [
        status,
        typeof description === 'string'
          ? { ...response, description: translateDescription(description, lang) }
          : response,
      ];
    }),
  );
}

function localizeParameters(parameters: unknown[], lang: ApiLanguage): unknown[] {
  return parameters.map((parameter) => {
    if (!parameter || typeof parameter !== 'object' || !('description' in parameter)) return parameter;
    const description = (parameter as { description?: unknown }).description;
    return typeof description === 'string'
      ? { ...parameter, description: translateDescription(description, lang) }
      : parameter;
  });
}

const TAG_DESCRIPTIONS: Record<string, string> = {
  'Identity · Auth': 'Autenticación, sesiones, tokens y recuperación simulada.',
  'Identity · Users': 'Usuarios y perfiles.',
  'Identity · Profiles': 'Perfiles uno-a-uno con usuarios.',
  'Identity · Preferences': 'Preferencias por usuario.',
  'Identity · RBAC': 'Roles, permisos y asignaciones.',
  'Identity · Groups': 'Grupos y membresías.',
  'Identity · Addresses': 'Direcciones de usuario.',
  'Identity · Sessions': 'Sesiones emitidas.',
  'Identity · Tokens': 'Tokens opacos.',
  'Identity · API Keys': 'Claves de API.',
  'Projects · Projects': 'Proyectos y participantes.',
  'Projects · Tasks': 'Tareas, subtareas, comentarios y etiquetas.',
  'Projects · Teams': 'Equipos y miembros.',
  'Projects · Activity': 'Historial de actividad.',
  'Projects · Reports': 'Agregaciones de proyectos.',
  'Shop · Catalog': 'Productos, variantes, marcas y categorías.',
  'Shop · Customers': 'Clientes y direcciones.',
  'Shop · Carts': 'Carritos y líneas.',
  'Shop · Orders': 'Pedidos y checkout transaccional.',
  'Shop · Inventory': 'Almacenes y stock.',
  'Shop · Payments': 'Métodos de pago.',
  'Shop · Refunds': 'Reembolsos.',
  'Shop · Shipping': 'Transportistas y envíos.',
  'Shop · Discounts': 'Cupones y descuentos.',
  'Shop · Reviews': 'Reseñas de productos.',
  'Library · Catalog': 'Libros, autores, editoriales y géneros.',
  'Library · Copies': 'Ejemplares y disponibilidad.',
  'Library · Readers': 'Lectores.',
  'Library · Loans': 'Préstamos, devoluciones y renovaciones.',
  'Library · Reservations': 'Reservas.',
  'Library · Fines': 'Multas.',
  'Library · Reports': 'Estadísticas de biblioteca.',
  'Education · People': 'Estudiantes y profesores.',
  'Education · Courses': 'Cursos, asignaturas y secciones.',
  'Education · Sections': 'Secciones y aforo.',
  'Education · Enrollment': 'Matrículas.',
  'Education · Grades': 'Evaluaciones y calificaciones.',
  'Education · Attendance': 'Asistencia.',
  'Education · Materials': 'Materiales educativos.',
  'Education · Reports': 'Historial y estadísticas.',
  'HR · Organization': 'Departamentos y puestos.',
  'HR · Employees': 'Empleados y contratos.',
  'HR · Payroll': 'Nóminas.',
  'HR · Vacations': 'Vacaciones y saldos.',
  'HR · Attendance': 'Asistencia laboral.',
  'HR · Reports': 'Reportes de plantilla y nómina.',
  'Finance · Suppliers': 'Proveedores.',
  'Finance · Accounts': 'Cuentas contables.',
  'Finance · Transactions': 'Movimientos contables.',
  'Finance · Invoices': 'Facturas y cobros.',
  'Finance · Expenses': 'Gastos.',
  'Finance · Payments': 'Pagos.',
  'Finance · Budgets': 'Presupuestos.',
  'Finance · Reports': 'Balances y agregados.',
  Control: 'Estadísticas, reseteo, modo de datos y datos adicionales.',
  'HTTP Lab': 'Laboratorio de transporte HTTP independiente.',
  General: 'Información del servicio.',
};

function labOperations(): Array<{
  method: string;
  path: string;
  summary: string;
  tags: string[];
  parameters?: Array<Record<string, unknown>>;
  security?: Array<Record<string, string[]>>;
  responses?: Record<string, unknown>;
}> {
  const commonErrors = {
    '400': { $ref: '#/components/responses/BadRequest' },
    '500': { $ref: '#/components/responses/InternalError' },
  };
  return [
    ...['get', 'post', 'put', 'patch', 'delete'].map((method) => ({
      method,
      path: '/test/echo',
      summary: 'Refleja método, URL, query, headers, cookies y cuerpo de la solicitud',
      tags: ['HTTP Lab'],
      responses: { '200': { description: 'Eco de la solicitud' }, ...commonErrors },
    })),
    {
      method: 'get',
      path: '/test/methods/{method}',
      summary: 'Comprueba el método recibido',
      tags: ['HTTP Lab'],
      parameters: [{ name: 'method', in: 'path', required: true, schema: { type: 'string' } }],
    },
    {
      method: 'get',
      path: '/test/status/{code}',
      summary: 'Devuelve el código HTTP solicitado',
      tags: ['HTTP Lab'],
      parameters: [
        { name: 'code', in: 'path', required: true, schema: { type: 'integer', minimum: 200, maximum: 599 } },
      ],
    },
    {
      method: 'get',
      path: '/test/headers/required',
      summary: 'Exige headers y devuelve 400 con los ausentes',
      tags: ['HTTP Lab'],
      parameters: [{ name: 'names', in: 'query', schema: { type: 'string' } }],
    },
    {
      method: 'get',
      path: '/test/compress',
      summary: 'Comprime la respuesta con gzip, deflate o Brotli',
      tags: ['HTTP Lab'],
      parameters: [
        { name: 'algo', in: 'query', schema: { type: 'string', enum: ['auto', 'gzip', 'deflate', 'br', 'identity'] } },
        { name: 'size', in: 'query', schema: { type: 'integer', minimum: 0 } },
      ],
    },
    {
      method: 'get',
      path: '/test/redirect/{code}',
      summary: 'Redirección local con el código indicado',
      tags: ['HTTP Lab'],
      parameters: [
        { name: 'code', in: 'path', required: true, schema: { type: 'integer', enum: [301, 302, 303, 307, 308] } },
        { name: 'to', in: 'query', schema: { type: 'string' } },
        { name: 'absolute', in: 'query', schema: { type: 'boolean' } },
      ],
    },
    {
      method: 'get',
      path: '/test/auth/basic',
      summary: 'Basic Auth',
      tags: ['HTTP Lab'],
      security: [{ basicAuth: [] }],
    },
    {
      method: 'get',
      path: '/test/auth/bearer',
      summary: 'Bearer token',
      tags: ['HTTP Lab'],
      security: [{ bearerAuth: [] }],
    },
    {
      method: 'get',
      path: '/test/auth/api-key',
      summary: 'API key en X-API-Key',
      tags: ['HTTP Lab'],
      security: [{ apiKeyAuth: [] }],
    },
    { method: 'get', path: '/test/cookies/set', summary: 'Crea una cookie con atributos', tags: ['HTTP Lab'] },
    { method: 'get', path: '/test/cookies/echo', summary: 'Devuelve las cookies recibidas', tags: ['HTTP Lab'] },
    {
      method: 'get',
      path: '/test/cache/etag',
      summary: 'ETag y 304 con If-None-Match',
      tags: ['HTTP Lab'],
      parameters: [{ name: 'If-None-Match', in: 'header', schema: { type: 'string' } }],
    },
    {
      method: 'get',
      path: '/test/cache/last-modified',
      summary: 'Last-Modified y 304 con If-Modified-Since',
      tags: ['HTTP Lab'],
    },
    {
      method: 'get',
      path: '/test/stream/text',
      summary: 'Stream de texto por chunks',
      tags: ['HTTP Lab'],
      parameters: [
        { name: 'chunks', in: 'query', schema: { type: 'integer' } },
        { name: 'delay', in: 'query', schema: { type: 'integer' } },
        { name: 'size', in: 'query', schema: { type: 'integer' } },
      ],
    },
    {
      method: 'get',
      path: '/test/download',
      summary: 'Descarga binaria con soporte Range',
      tags: ['HTTP Lab'],
      parameters: [
        { name: 'size', in: 'query', schema: { type: 'integer' } },
        { name: 'Range', in: 'header', schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'Descarga completa' },
        '206': { description: 'Contenido parcial' },
        '416': { description: 'Rango no satisfacible' },
      },
    },
    { method: 'get', path: '/test/error/{code}', summary: 'Genera un error HTTP estructurado', tags: ['HTTP Lab'] },
    { method: 'get', path: '/test/rate-limit', summary: 'Rate limit en memoria con Retry-After', tags: ['HTTP Lab'] },
    {
      method: 'post',
      path: '/test/idempotency',
      summary: 'Idempotencia mediante Idempotency-Key',
      tags: ['HTTP Lab'],
      parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }],
    },
  ];
}

/** Builds the localized OpenAPI document for a concrete request origin. */
export function buildOpenApi(
  router: Router,
  config: Config,
  serverUrl: string,
  lang: ApiLanguage = 'es',
): OpenApiObject {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags = new Set<string>();

  for (const route of router.routes) {
    const openApiPath = route.path.replace(/:([^/]+)/g, '{$1}');
    const method = route.method.toLowerCase();
    if (method === 'head') continue;
    const doc = route.doc;
    const tag = doc.tag ?? 'General';
    tags.add(tag);
    const pathParams: Array<Record<string, unknown>> = [];
    for (const match of openApiPath.matchAll(/\{([^}]+)\}/g)) {
      if (!doc.parameters?.some((p) => p.name === match[1] && p.in === 'path')) {
        pathParams.push({
          name: match[1],
          in: 'path',
          required: true,
          schema: { type: match[1].toLowerCase().includes('id') ? 'integer' : 'string' },
        });
      }
    }
    const parameters = localizeParameters([...pathParams, ...(doc.parameters ?? [])], lang);
    const needsBody = ['post', 'put', 'patch'].includes(method);
    const operation: OpenApiObject = {
      summary:
        lang === 'en'
          ? translateSummary(doc.summary, doc.summaryEn, lang) || `${route.method} ${route.path}`
          : (doc.summary ?? `${route.method} ${route.path}`),
      tags: [tag],
      operationId: `${method}_${route.path}`.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
      ...(parameters.length ? { parameters } : {}),
      ...(doc.security ? { security: doc.security } : {}),
      requestBody:
        doc.requestBody ??
        (needsBody
          ? {
              required: false,
              content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
            }
          : undefined),
      responses: localizeResponses(
        {
          ...(doc.responses ?? { '200': { description: 'Operación exitosa' } }),
          '500': { $ref: '#/components/responses/InternalError' },
        },
        lang,
      ),
    };
    if (operation.requestBody === undefined) delete operation.requestBody;
    let pathEntry = paths[openApiPath];
    if (!pathEntry) {
      pathEntry = {};
      paths[openApiPath] = pathEntry;
    }
    pathEntry[method] = operation;
  }

  for (const op of labOperations()) {
    tags.add('HTTP Lab');
    const parameters = op.parameters ?? [];
    const operation: OpenApiObject = {
      summary: lang === 'en' ? translateSummary(op.summary, undefined, lang) : op.summary,
      tags: op.tags,
      operationId: `${op.method}_${op.path}`.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
      ...(parameters.length ? { parameters: localizeParameters(parameters, lang) } : {}),
      ...(op.security ? { security: op.security } : {}),
      responses: localizeResponses(
        {
          ...(op.responses ?? { '200': { description: 'Respuesta simulada' } }),
          '500': { $ref: '#/components/responses/InternalError' },
        },
        lang,
      ),
    };
    let pathEntry = paths[op.path];
    if (!pathEntry) {
      pathEntry = {};
      paths[op.path] = pathEntry;
    }
    pathEntry[op.method] = operation;
  }

  const servers = [
    { url: serverUrl, description: 'HTTP/1.1' },
    ...(config.httpsEnabled
      ? [
          {
            url: `https://localhost:${config.httpsPort}`,
            description: translateDescription('HTTPS (certificado local)', lang),
          },
        ]
      : []),
    ...(config.http2Enabled
      ? [{ url: `https://localhost:${config.http2Port}`, description: translateDescription('HTTP/2 sobre TLS', lang) }]
      : []),
  ];

  return {
    openapi: '3.0.3',
    info: {
      title: 'Backend Simulator',
      version: '1.0.0',
      description: INFO_DESCRIPTION[lang],
    },
    servers,
    tags: [...tags].sort().map((name) => ({
      name,
      description: lang === 'en' ? (TAG_DESCRIPTIONS_EN[name] ?? name) : (TAG_DESCRIPTIONS[name] ?? name),
    })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        basicAuth: { type: 'http', scheme: 'basic' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        controlToken: { type: 'apiKey', in: 'header', name: 'X-Control-Token' },
      },
      schemas: {
        Error: {
          type: 'object',
          example: {
            error: {
              code: 'VALIDATION_ERROR',
              message: translateDescription('Datos inválidos', lang),
              details: [{ field: 'email', message: translateDescription('email inválido', lang) }],
              request_id: '4d1d…',
            },
          },
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: {},
                request_id: { type: 'string' },
              },
              required: ['code', 'message'],
            },
          },
        },
        PaginationMeta: {
          type: 'object',
          example: { page: 1, per_page: 25, offset: 0, total: 60, total_pages: 3, has_next: true, has_prev: false },
          properties: {
            page: { type: 'integer' },
            per_page: { type: 'integer' },
            offset: { type: 'integer' },
            total: { type: 'integer' },
            total_pages: { type: 'integer' },
            has_next: { type: 'boolean' },
            has_prev: { type: 'boolean' },
          },
        },
      },
      responses: {
        BadRequest: {
          description: translateDescription('Solicitud inválida', lang),
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Unauthorized: {
          description: translateDescription('No autenticado', lang),
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description: translateDescription('Sin permisos', lang),
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: translateDescription('No encontrado', lang),
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        ConflictError: {
          description: translateDescription('Conflicto', lang),
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        ValidationError: {
          description: translateDescription('Validación fallida', lang),
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        InternalError: {
          description: translateDescription('Error interno', lang),
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  };
}

/** Renders the Swagger UI page for the selected language and spec URL. */
export function docsHtml(lang: ApiLanguage = 'es'): string {
  const english = lang === 'en';
  const specUrl = english ? '/openapi.en.json' : '/openapi.json';
  const title = english ? 'API documentation' : 'Documentación de la API';
  const specLabel = english ? 'OpenAPI specification' : 'Especificación OpenAPI';
  const languageLabel = english ? 'Language' : 'Idioma';
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Backend Simulator · API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body{margin:0;background:#fafafa;font-family:system-ui,sans-serif}
    .fallback{padding:2rem}
    .docs-bar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 20px;background:#10211b;color:#dff3e8;font-size:13px}
    .docs-bar strong{margin-right:auto}
    .docs-bar a{color:#c6f26b;text-decoration:none}
    .docs-bar a[aria-current="page"]{font-weight:700;text-decoration:underline}
  </style>
</head>
<body>
  <nav class="docs-bar" aria-label="${title}">
    <strong>Backend Simulator</strong>
    <span>${title}</span>
    <span>${specLabel}: <a href="${specUrl}">${specUrl}</a></span>
    <span>${languageLabel}: <a href="/docs?lang=es" ${english ? '' : 'aria-current="page"'}>Español</a> · <a href="/docs?lang=en" ${english ? 'aria-current="page"' : ''}>English</a></span>
  </nav>
  <div id="swagger-ui"><div class="fallback"><h1>Backend Simulator</h1><p>${specLabel}: <a href="${specUrl}">${specUrl}</a></p></div></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    if (window.SwaggerUIBundle) {
      SwaggerUIBundle({ url: '${specUrl}', dom_id: '#swagger-ui', deepLinking: true, displayRequestDuration: true });
    }
  </script>
</body>
</html>`;
}
