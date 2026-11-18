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

export const badRequest = (msg: string, details?: unknown) =>
  new HttpError(400, 'BAD_REQUEST', msg, { details });
export const unauthorized = (msg = 'Autenticación requerida', headers?: Record<string, string>) =>
  new HttpError(401, 'UNAUTHORIZED', msg, { headers });
export const forbidden = (msg = 'Permisos insuficientes') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Recurso no encontrado') => new HttpError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string, details?: unknown) =>
  new HttpError(409, 'CONFLICT', msg, { details });
export const preconditionFailed = (msg: string) => new HttpError(412, 'PRECONDITION_FAILED', msg);
export const payloadTooLarge = (msg = 'Payload demasiado grande') =>
  new HttpError(413, 'PAYLOAD_TOO_LARGE', msg);
export const unsupportedMedia = (msg = 'Content-Type no soportado') =>
  new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', msg);
export const validationError = (details: unknown, msg = 'Datos inválidos') =>
  new HttpError(422, 'VALIDATION_ERROR', msg, { details });
export const tooManyRequests = (retryAfter: number, msg = 'Demasiadas solicitudes') =>
  new HttpError(429, 'TOO_MANY_REQUESTS', msg, {
    headers: { 'Retry-After': String(retryAfter) },
  });
