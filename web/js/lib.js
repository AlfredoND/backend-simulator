/**
 * @file Pure browser helpers for URL building, formatting, headers and bodies.
 * These functions have no DOM dependency so they can be unit tested in Node.
 */

/** Trims and validates a base URL, adding http:// only when no scheme exists. */
export function normalizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

/** Resolves a relative request path while preserving absolute http(s) URLs. */
export function buildRequestUrl(baseUrl, requestPath) {
  const path = String(requestPath ?? '').trim();
  if (/^https?:\/\//i.test(path)) return path;
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return path;
  return `${base}/${path.replace(/^\/+/, '')}`;
}

/** Formats a byte count for compact response metadata. */
export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** Formats elapsed milliseconds as ms or seconds. */
export function formatDuration(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

/** Formats backend uptime in seconds, minutes, hours or days. */
export function formatUptime(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m`;
  if (value < 86_400) return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
  return `${Math.floor(value / 86_400)}d ${Math.floor((value % 86_400) / 3600)}h`;
}

/** Maps an HTTP status to a UI tone: success, redirect, warning, error. */
export function statusTone(status) {
  const value = Number(status);
  if (value >= 200 && value < 300) return 'success';
  if (value >= 300 && value < 400) return 'redirect';
  if (value >= 400 && value < 500) return 'warning';
  if (value >= 500) return 'error';
  return 'neutral';
}

/** Maps a control API status to a localized data-mode error message key. */
export function modeErrorKey(status) {
  const value = Number(status);
  if (value === 401) return 'mode.errorUnauthorized';
  if (value === 409) return 'mode.errorConflict';
  return 'mode.errorStatus';
}

/** Decides whether a response body should be decoded as text. */
export function isTextContentType(contentType) {
  const type = String(contentType ?? '').toLowerCase();
  return (
    type.includes('json') ||
    type.includes('text/') ||
    type.includes('xml') ||
    type.includes('javascript') ||
    type.includes('x-www-form-urlencoded') ||
    type.includes('svg') ||
    type === ''
  );
}

/** Pretty-prints valid JSON and leaves other payloads untouched. */
export function prettyPayload(text, contentType = '') {
  const raw = String(text ?? '');
  if (!raw) return '';
  if (contentType.toLowerCase().includes('json') || /^\s*[[{]/.test(raw)) {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }
  return raw;
}

/** Caps rendered response bodies to keep the browser responsive. */
export function truncateText(text, maxLength = 200_000) {
  const value = String(text ?? '');
  if (value.length <= maxLength) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, maxLength)}\n\n… (${value.length - maxLength} more characters)`,
    truncated: true,
  };
}

/** Decodes textual responses or returns a hexadecimal preview for binary data. */
export function decodeResponseBody(buffer, contentType) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer ?? 0);
  if (isTextContentType(contentType)) {
    return {
      text: new TextDecoder().decode(bytes),
      binary: false,
      preview: null,
    };
  }
  const sample = bytes.slice(0, 64);
  const hex = Array.from(sample, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
  return {
    text: '',
    binary: true,
    preview: `${hex}${bytes.length > sample.length ? ' …' : ''}`,
  };
}

/** Converts Headers/object input into sorted name/value rows. */
export function headersToRows(headers) {
  if (!headers) return [];
  const entries = typeof headers.entries === 'function' ? [...headers.entries()] : Object.entries(headers);
  return entries
    .map(([name, value]) => ({ name: String(name), value: String(value) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Converts editable header rows into a plain header object. */
export function headerRowsToObject(rows) {
  const headers = {};
  for (const row of rows) {
    const name = String(row.name ?? '').trim();
    const value = String(row.value ?? '').trim();
    if (!name) continue;
    headers[name] = value;
  }
  return headers;
}

/** Validates an absolute HTTP(S) URL. */
export function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Locale-aware integer formatting for dashboard metrics. */
export function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : '—';
}

/** Capitalizes an internal domain id for display. */
export function compactDomainName(name) {
  return String(name).replace(/^\w/, (letter) => letter.toUpperCase());
}
