/**
 * @file HTTP error contract shared by APIs, the control plane and the lab.
 *
 * Every thrown `HttpError` becomes a structured JSON envelope with a stable
 * code, optional details/headers and the request id. Unknown errors are logged
 * and exposed only as a generic 500.
 */
/** Typed transport-safe error understood by the central error renderer. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.headers = options.headers;
  }
}

/** 400 helpers. */
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', msg, { details });
/** 401 helper with optional challenge headers. */
export const unauthorized = (msg = 'Autenticación requerida', headers?: Record<string, string>) =>
  new HttpError(401, 'UNAUTHORIZED', msg, { headers });
/** 403 permission helper. */
export const forbidden = (msg = 'Permisos insuficientes') => new HttpError(403, 'FORBIDDEN', msg);

/** 404 resource helper. */
export const notFound = (msg = 'Recurso no encontrado') => new HttpError(404, 'NOT_FOUND', msg);

/** 409 helper for uniqueness, state and referential conflicts. */
export const conflict = (msg: string, details?: unknown) => new HttpError(409, 'CONFLICT', msg, { details });

/** 412 helper for failed If-Match preconditions. */
export const preconditionFailed = (msg: string) => new HttpError(412, 'PRECONDITION_FAILED', msg);

/** 413 helper for configured request limits. */
export const payloadTooLarge = (msg = 'Payload demasiado grande') => new HttpError(413, 'PAYLOAD_TOO_LARGE', msg);

/** 415 helper for unsupported request media types. */
export const unsupportedMedia = (msg = 'Content-Type no soportado') =>
  new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', msg);

/** 422 helper carrying field-level validation details. */
export const validationError = (details: unknown, msg = 'Datos inválidos') =>
  new HttpError(422, 'VALIDATION_ERROR', msg, { details });

/** 429 helper that always exposes Retry-After. */
export const tooManyRequests = (retryAfter: number, msg = 'Demasiadas solicitudes') =>
  new HttpError(429, 'TOO_MANY_REQUESTS', msg, {
    headers: { 'Retry-After': String(retryAfter) },
  });
