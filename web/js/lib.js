export function normalizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

export function buildRequestUrl(baseUrl, requestPath) {
  const path = String(requestPath ?? '').trim();
  if (/^https?:\/\//i.test(path)) return path;
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return path;
  return `${base}/${path.replace(/^\/+/, '')}`;
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function formatUptime(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m`;
  if (value < 86_400) return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
  return `${Math.floor(value / 86_400)}d ${Math.floor((value % 86_400) / 3600)}h`;
}

export function statusTone(status) {
  const value = Number(status);
  if (value >= 200 && value < 300) return 'success';
  if (value >= 300 && value < 400) return 'redirect';
  if (value >= 400 && value < 500) return 'warning';
  if (value >= 500) return 'error';
  return 'neutral';
}

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

export function prettyPayload(text, contentType = '') {
  const raw = String(text ?? '');
  if (!raw) return '';
  if (contentType.toLowerCase().includes('json') || /^[\s]*[\[{]/.test(raw)) {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }
  return raw;
}

export function truncateText(text, maxLength = 200_000) {
  const value = String(text ?? '');
  if (value.length <= maxLength) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, maxLength)}\n\n… (${value.length - maxLength} more characters)`,
    truncated: true,
  };
}

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

export function headersToRows(headers) {
  if (!headers) return [];
  const entries = typeof headers.entries === 'function'
    ? [...headers.entries()]
    : Object.entries(headers);
  return entries
    .map(([name, value]) => ({ name: String(name), value: String(value) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

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

export function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : '—';
}

export function compactDomainName(name) {
  return String(name).replace(/^\w/, (letter) => letter.toUpperCase());
}
